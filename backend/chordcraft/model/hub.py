"""Export a training checkpoint to a Hugging Face Hub layout, and load it back.

Hub layout (what `ckeen302/chordcraft-chord-transformer` contains)::

    model.safetensors   weights (tied embedding stored once)
    config.json         ModelConfig + vocabulary version + training metadata
    vocab.json          tokenizer vocabulary (must match ChordTokenizer)
    README.md           model card

    uv run python -m chordcraft.model.hub export --ckpt runs/kaggle_v1/v1/best.pt \\
        --results results/chord-transformer-v1 --out dist/chord-transformer
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import torch
from safetensors.torch import load_file, save_file

from chordcraft.data.tokenizer import VOCAB_VERSION, ChordTokenizer

from .transformer import ChordTransformer, ModelConfig

CARD_TEMPLATE = Path(__file__).with_name("MODEL_CARD.md")


def export(ckpt_path: Path, out: Path, results: Path | None = None) -> Path:
    ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=True)
    tok = ChordTokenizer()
    if ckpt["vocab"] != tok.itos:
        raise ValueError("checkpoint vocabulary does not match the current tokenizer")
    out.mkdir(parents=True, exist_ok=True)
    state = {k: v.contiguous() for k, v in ckpt["model"].items() if k != "head.weight"}  # tied to embed
    save_file(state, out / "model.safetensors")
    config = {
        "model_type": "chordcraft-chord-transformer",
        "model_config": ckpt["model_config"],
        "vocab_version": VOCAB_VERSION,
        "train_steps": ckpt.get("step"),
        "val_loss": ckpt.get("val_loss"),
    }
    (out / "config.json").write_text(json.dumps(config, indent=1))
    tok.save(out / "vocab.json")
    shutil.copy(CARD_TEMPLATE, out / "README.md")
    if results:
        for name in ("eval.json", "summary.json", "metrics.jsonl"):
            if (results / name).exists():
                shutil.copy(results / name, out / name)
    return out


def load_exported(directory: Path, device: str | torch.device = "cpu") -> tuple[ChordTransformer, ChordTokenizer]:
    config = json.loads((directory / "config.json").read_text())
    ChordTokenizer.check_compatible(directory / "vocab.json")
    model = ChordTransformer(ModelConfig(**config["model_config"]))
    state = load_file(directory / "model.safetensors")
    state["head.weight"] = state["embed.weight"]
    model.load_state_dict(state)
    return model.to(device).eval(), ChordTokenizer()


def download(repo_id: str, revision: str | None = None) -> Path:
    from huggingface_hub import snapshot_download

    return Path(snapshot_download(repo_id, revision=revision,
                                  allow_patterns=["model.safetensors", "config.json", "vocab.json"]))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    ex = sub.add_parser("export")
    ex.add_argument("--ckpt", type=Path, required=True)
    ex.add_argument("--out", type=Path, required=True)
    ex.add_argument("--results", type=Path, default=None)
    args = ap.parse_args()
    print(export(args.ckpt, args.out, args.results))


if __name__ == "__main__":
    main()
