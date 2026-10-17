"""Constrained sampling from a trained ChordTransformer.

Decoding is masked so every output is valid by construction:

- only chord tokens (or EOS) can be sampled after the control prefix
- EOS is blocked until the requested length, then forced
- no chord may immediately repeat (the training data merges repeats)
- no block may immediately repeat (ABAB, ABCABC…): a chord that would
  complete such a loop is masked, while returns like I–IV–I stay legal
- optional presence penalty nudging toward chords not used yet
- optional classifier-free guidance: logits = uncond + w·(cond − uncond),
  where "uncond" swaps the mood token for ``mood:any`` (the model was trained
  with conditioning dropout, so it knows both); w > 1 sharpens the mood
- optional: no diminished-family chords; diatonic-only

The result is key-relative degrees; ``spell_degrees`` renders them in a key.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import torch

from chordcraft.data.phrases import Degree
from chordcraft.data.tokenizer import ChordTokenizer

from .transformer import ChordTransformer, ModelConfig

DIM_FAMILY = {"dim", "dim7", "m7b5"}
# Diatonic (offset, quality-family) sets per mode for the diatonic-only constraint.
_MAJOR = {0: "maj", 2: "min", 4: "min", 5: "maj", 7: "maj", 9: "min", 11: "dim"}
_MINOR = {0: "min", 2: "dim", 3: "maj", 5: "min", 7: "min", 8: "maj", 10: "maj"}


@dataclass
class Sample:
    degrees: list[Degree]
    logprob: float  # mean per-token log-probability under the model


def load_model(path: Path, device: str | torch.device = "cpu") -> tuple[ChordTransformer, ChordTokenizer]:
    ckpt = torch.load(path, map_location=device, weights_only=True)
    tok = ChordTokenizer()
    if ckpt["vocab"] != tok.itos:
        raise ValueError(f"{path} was trained with a different vocabulary")
    model = ChordTransformer(ModelConfig(**ckpt["model_config"]))
    model.load_state_dict(ckpt["model"])
    return model.to(device).eval(), tok


def _allowed_mask(tok: ChordTokenizer, mode: str, exclude_dim: bool, diatonic_only: bool,
                  device: torch.device) -> torch.Tensor:
    from chordcraft.theory.analysis import FAMILY

    diatonic = _MINOR if mode == "minor" else _MAJOR
    mask = torch.zeros(len(tok), dtype=torch.bool, device=device)
    for i in tok.chord_ids:
        off, q = tok.itos[i].split(":", 1)
        if exclude_dim and q in DIM_FAMILY:
            continue
        if diatonic_only:
            fam = FAMILY.get(q, "maj")
            want = diatonic.get(int(off))
            if want is None or (fam != "sus" and fam != want):
                continue
        mask[i] = True
    return mask


def loop_completions(rows: list[list[int]]) -> list[tuple[int, int]]:
    """(row, token) pairs where emitting ``token`` would end the row in a repeated block.

    For block size k the sequence + token ends with X X (|X| = k) exactly when
    the last k-1 chords already echo the k-1 chords before the previous block,
    and the token equals the chord k back.
    """
    out = []
    for r, g in enumerate(rows):
        for k in range(2, (len(g) + 1) // 2 + 1):
            if g[len(g) - (k - 1):] == g[len(g) - (2 * k - 1): len(g) - k]:
                out.append((r, g[-k]))
    return out


@torch.no_grad()
def sample(
    model: ChordTransformer,
    tok: ChordTokenizer,
    *,
    mode: str,
    length: int,
    mood: str = "any",
    genre: str = "any",
    num_samples: int = 1,
    temperature: float = 0.9,
    top_p: float = 0.95,
    exclude_diminished: bool = False,
    diatonic_only: bool = False,
    block_loops: bool = True,
    presence_penalty: float = 0.0,
    guidance: float = 1.0,
    generator: torch.Generator | None = None,
) -> list[Sample]:
    device = next(model.parameters()).device
    prefix = tok.control_ids(mode, length, genre, mood)
    length = int(tok.itos[prefix[-1]].split(":")[1])  # the tokenizer clamps to 2–16
    ids = torch.tensor([prefix] * num_samples, device=device)
    chord_ok = _allowed_mask(tok, mode, exclude_diminished, diatonic_only, device)
    total_lp = torch.zeros(num_samples, device=device)

    guided = guidance != 1.0 and mood != "any"
    any_mood = tok.stoi["mood:any"]

    for step in range(length + 1):
        if guided:
            uncond = ids.clone()
            uncond[:, 3] = any_mood
            both = model(torch.cat([ids, uncond]))[:, -1, :].float()
            cond_l, uncond_l = both[:num_samples], both[num_samples:]
            logits = uncond_l + guidance * (cond_l - uncond_l)
        else:
            logits = model(ids)[:, -1, :].float()
        allowed = torch.zeros_like(logits, dtype=torch.bool)
        if step == length:
            allowed[:, tok.eos_id] = True
        else:
            allowed[:] = chord_ok
            if step > 0:
                allowed.scatter_(1, ids[:, -1:], False)  # no immediate repeat
            if block_loops and step >= 3:
                for row, token in loop_completions(ids[:, len(prefix):].tolist()):
                    allowed[row, token] = False
            if presence_penalty and step > 0:
                used = torch.zeros_like(allowed).scatter_(1, ids[:, len(prefix):], True)
                logits = logits - presence_penalty * used.float()
        logits = logits.masked_fill(~allowed, float("-inf"))
        logp = torch.log_softmax(logits, dim=-1)
        probs = torch.softmax(logits / max(temperature, 1e-5), dim=-1)
        if top_p < 1.0:
            sorted_p, order = probs.sort(dim=-1, descending=True)
            cut = sorted_p.cumsum(-1) - sorted_p > top_p
            sorted_p = sorted_p.masked_fill(cut, 0.0)
            probs = torch.zeros_like(probs).scatter(1, order, sorted_p)
        nxt = torch.multinomial(probs / probs.sum(-1, keepdim=True), 1, generator=generator)
        total_lp += logp.gather(1, nxt).squeeze(1)
        ids = torch.cat([ids, nxt], dim=1)

    out = []
    for row, lp in zip(ids.tolist(), (total_lp / (length + 1)).tolist(), strict=True):
        out.append(Sample(degrees=tok.decode_chords(row[len(prefix):]), logprob=lp))
    return out
