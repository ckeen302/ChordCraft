"""Train the ChordTransformer.

Local (Apple MPS / CPU, small smoke run):
    uv run --extra ml python -m chordcraft.model.train --data data/processed --out runs/smoke \\
        --limit 50000 --epochs 1 --d-model 128 --n-layers 2 --n-heads 4

Full run on a Modal GPU: see backend/modal_train.py.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import time
from dataclasses import asdict, dataclass
from pathlib import Path

import torch
import torch.nn.functional as F
from torch.utils.data import DataLoader

from chordcraft.data.tokenizer import ChordTokenizer

from .dataset import Collator, PhraseDataset, split_file
from .transformer import ChordTransformer, ModelConfig


@dataclass
class TrainConfig:
    data: str
    out: str
    epochs: float = 3.0
    batch_size: int = 512
    lr: float = 1e-3
    min_lr_ratio: float = 0.1
    warmup_steps: int = 500
    weight_decay: float = 0.1
    grad_clip: float = 1.0
    cond_dropout: float = 0.3
    mood_balance: float = 0.5
    eval_every: int = 500
    eval_batches: int = 50
    limit: int | None = None
    seed: int = 1337
    d_model: int = 384
    n_layers: int = 8
    n_heads: int = 6
    dropout: float = 0.1


def pick_device() -> torch.device:
    if torch.cuda.is_available():
        return torch.device("cuda")
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def masked_loss(model, batch, device, amp_dtype):
    x, y = batch["input"].to(device), batch["target"].to(device)
    mask, pad_mask = batch["loss_mask"].to(device), batch["pad_mask"].to(device)
    with torch.autocast(device.type, dtype=amp_dtype, enabled=amp_dtype is not None):
        logits = model(x, pad_mask)
    loss = F.cross_entropy(logits.float().reshape(-1, logits.size(-1)), y.reshape(-1), reduction="none")
    mask = mask.reshape(-1).float()
    return (loss * mask).sum() / mask.sum(), mask.sum()


@torch.no_grad()
def evaluate(model, loader, device, amp_dtype, max_batches: int) -> float:
    model.eval()
    total, count = 0.0, 0.0
    for i, batch in enumerate(loader):
        if i >= max_batches:
            break
        loss, n = masked_loss(model, batch, device, amp_dtype)
        total += loss.item() * n.item()
        count += n.item()
    model.train()
    return total / max(count, 1)


def lr_at(step: int, total: int, cfg: TrainConfig) -> float:
    if step < cfg.warmup_steps:
        return cfg.lr * (step + 1) / cfg.warmup_steps
    progress = (step - cfg.warmup_steps) / max(1, total - cfg.warmup_steps)
    return cfg.lr * (cfg.min_lr_ratio + (1 - cfg.min_lr_ratio) * 0.5 * (1 + math.cos(math.pi * min(1.0, progress))))


def train(cfg: TrainConfig) -> dict:
    torch.manual_seed(cfg.seed)
    device = pick_device()
    # T4-class GPUs lack fast bf16; fp16 needs loss scaling. MPS/CPU train in fp32.
    amp_dtype = None
    if device.type == "cuda":
        amp_dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    scaler = torch.amp.GradScaler("cuda", enabled=amp_dtype == torch.float16)

    tok = ChordTokenizer()
    data = Path(cfg.data)
    ChordTokenizer.check_compatible(data / "vocab.json")
    t0 = time.time()
    train_ds = PhraseDataset(split_file(data, "train"), tok, cfg.limit)
    val_ds = PhraseDataset(split_file(data, "val"), tok, cfg.limit and max(2000, cfg.limit // 18))
    print(f"loaded {len(train_ds):,} train / {len(val_ds):,} val phrases in {time.time() - t0:.0f}s on {device}")

    train_loader = DataLoader(
        train_ds, batch_size=cfg.batch_size, sampler=train_ds.balanced_sampler(cfg.mood_balance),
        collate_fn=Collator(tok, cfg.cond_dropout, cfg.seed), drop_last=True,
    )
    val_loader = DataLoader(val_ds, batch_size=cfg.batch_size, shuffle=False, collate_fn=Collator(tok))

    mcfg = ModelConfig(vocab_size=len(tok), d_model=cfg.d_model, n_layers=cfg.n_layers,
                       n_heads=cfg.n_heads, dropout=cfg.dropout)
    model = ChordTransformer(mcfg).to(device)
    decay = [p for p in model.parameters() if p.dim() >= 2]
    no_decay = [p for p in model.parameters() if p.dim() < 2]
    opt = torch.optim.AdamW(
        [{"params": decay, "weight_decay": cfg.weight_decay}, {"params": no_decay, "weight_decay": 0.0}],
        lr=cfg.lr, betas=(0.9, 0.95), fused=device.type == "cuda",
    )
    total_steps = int(cfg.epochs * len(train_loader))
    print(f"model {model.num_params() / 1e6:.2f}M params · {total_steps:,} steps · batch {cfg.batch_size}")

    out = Path(cfg.out)
    out.mkdir(parents=True, exist_ok=True)
    tok.save(out / "vocab.json")
    log = open(out / "metrics.jsonl", "a")  # noqa: SIM115 — kept open for the whole run
    wandb_run = None
    if os.getenv("WANDB_API_KEY"):
        import wandb  # optional dependency

        wandb_run = wandb.init(project="chordcraft", config={**asdict(cfg), **mcfg.to_dict()})

    best_val, step, started = float("inf"), 0, time.time()
    model.train()
    while step < total_steps:
        for batch in train_loader:
            if step >= total_steps:
                break
            for g in opt.param_groups:
                g["lr"] = lr_at(step, total_steps, cfg)
            loss, _ = masked_loss(model, batch, device, amp_dtype)
            opt.zero_grad(set_to_none=True)
            scaler.scale(loss).backward()
            scaler.unscale_(opt)
            torch.nn.utils.clip_grad_norm_(model.parameters(), cfg.grad_clip)
            scaler.step(opt)
            scaler.update()
            step += 1

            if step % cfg.eval_every == 0 or step == total_steps:
                val = evaluate(model, val_loader, device, amp_dtype, cfg.eval_batches)
                rec = {"step": step, "train_loss": round(loss.item(), 4), "val_loss": round(val, 4),
                       "val_ppl": round(math.exp(val), 3), "lr": opt.param_groups[0]["lr"],
                       "elapsed_s": round(time.time() - started, 1)}
                print(json.dumps(rec), flush=True)
                log.write(json.dumps(rec) + "\n")
                log.flush()
                if wandb_run:
                    wandb_run.log(rec, step=step)
                if val < best_val:
                    best_val = val
                    torch.save({"model": model.state_dict(), "model_config": mcfg.to_dict(),
                                "train_config": asdict(cfg), "step": step, "val_loss": val,
                                "vocab": tok.itos}, out / "best.pt")

    log.close()
    full_val = evaluate(model, val_loader, device, amp_dtype, max_batches=10**9)
    summary = {"best_val_loss": round(best_val, 4), "best_val_ppl": round(math.exp(best_val), 3),
               "final_full_val_loss": round(full_val, 4), "steps": step, "params": model.num_params(),
               "minutes": round((time.time() - started) / 60, 2), "device": str(device)}
    (out / "summary.json").write_text(json.dumps(summary, indent=1))
    if wandb_run:
        wandb_run.summary.update(summary)
        wandb_run.finish()
    print(json.dumps(summary))
    return summary


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    for f in TrainConfig.__dataclass_fields__.values():
        flag = "--" + f.name.replace("_", "-")
        if f.name in ("data", "out"):
            ap.add_argument(flag, required=True)
        else:
            # Every tunable is numeric; `limit` (default None) is an int.
            kind = float if isinstance(f.default, float) else int
            ap.add_argument(flag, type=kind, default=f.default)
    train(TrainConfig(**vars(ap.parse_args())))


if __name__ == "__main__":
    main()
