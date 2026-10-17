"""Evaluate a trained ChordTransformer against the rule-engine baseline.

    uv run --extra ml python -m chordcraft.model.evaluate --ckpt runs/v1/best.pt --data data/processed

Metrics (per generator):
- test perplexity (model only) over chord + EOS tokens of the held-out split
- validity: every chord spells to a symbol the strict parser accepts
- diatonic ratio: share of chords inside the key
- mood control: generated phrase's weak mood label == requested mood
  (same labeler as the training data, so read it as "does conditioning steer
  the output", not as human-judged mood)
- novelty: share of generated phrases that never appear in the training set
- distinct-2: unique chord bigrams / total bigrams (diversity)
- tonic/dominant ending: phrase ends on I/i or V (cadential shape)
"""

from __future__ import annotations

import argparse
import json
import math
import random
from collections.abc import Callable
from pathlib import Path

import torch
from torch.utils.data import DataLoader

from chordcraft.data.moods import label_mood
from chordcraft.data.phrases import Degree
from chordcraft.theory import NOTE_MAP, parse_chord_strict
from chordcraft.theory.analysis import FAMILY
from chordcraft.theory.harmony import MOODS, generate_mood_progression, spell_degrees

from .dataset import Collator, PhraseDataset, open_split, split_file
from .generate import _MAJOR, _MINOR, load_model, sample
from .train import evaluate as eval_loss
from .train import pick_device

KEYS_FOR_MODE = {"major": "C Major", "minor": "A Minor"}
MOOD_MODE_MIX = 0.5  # half the samples in major, half in minor


def load_train_phrases(path: Path) -> set[tuple[str, tuple]]:
    seen = set()
    with open_split(path) as f:
        for line in f:
            r = json.loads(line)
            seen.add((r["mode"], tuple(tuple(d) for d in r["degrees"])))
    return seen


def phrase_metrics(samples: list[tuple[str, str, list[Degree]]], train_set: set) -> dict:
    """samples: (requested mood, mode, degrees)."""
    n = len(samples)
    valid = diatonic = chords = mood_hits = novel = cadential = 0
    bigrams, unique_bigrams = 0, set()
    for mood, mode, degrees in samples:
        key = KEYS_FOR_MODE[mode]
        try:
            for s in spell_degrees(key, degrees):
                parse_chord_strict(s)
            valid += 1
        except ValueError:
            pass
        table = _MINOR if mode == "minor" else _MAJOR
        for off, q in degrees:
            fam = FAMILY.get(q, "maj")
            chords += 1
            diatonic += off in table and (fam == "sus" or fam == table[off])
        mood_hits += label_mood(degrees, mode)[0] == mood
        novel += (mode, tuple(degrees)) not in train_set
        last_off, last_q = degrees[-1]
        cadential += last_off in (0, 7)
        for a, b in zip(degrees, degrees[1:], strict=False):
            bigrams += 1
            unique_bigrams.add((a, b))
    return {
        "samples": n,
        "validity": round(valid / n, 4),
        "diatonic_ratio": round(diatonic / max(chords, 1), 4),
        "mood_control": round(mood_hits / n, 4),
        "novelty": round(novel / n, 4),
        "distinct_2": round(len(unique_bigrams) / max(bigrams, 1), 4),
        "tonic_or_dominant_ending": round(cadential / n, 4),
    }


def rule_engine_sampler(rng: random.Random) -> Callable[[str, str, int], list[Degree]]:
    def gen(mood: str, mode: str, length: int) -> list[Degree]:
        key = KEYS_FOR_MODE[mode]
        tonic = NOTE_MAP[key.split()[0]] % 12
        r = generate_mood_progression(key, mood, length, rng=rng)
        out = []
        for s in r.symbols:
            c = parse_chord_strict(s)
            out.append(((NOTE_MAP[c.root] - tonic) % 12, c.quality))
        return out
    return gen


def run(ckpt: Path, data: Path, per_mood: int, lengths: list[int], seed: int) -> dict:
    device = pick_device()
    model, tok = load_model(ckpt, device)
    rng = random.Random(seed)
    gen = torch.Generator(device="cpu").manual_seed(seed)

    test = PhraseDataset(split_file(data, "test"), tok)
    test_loss = eval_loss(model, DataLoader(test, batch_size=1024, collate_fn=Collator(tok)), device, None, 10**9)

    train_set = load_train_phrases(split_file(data, "train"))
    rule = rule_engine_sampler(rng)
    results: dict[str, list] = {"model": [], "model_unconditioned": [], "rule_engine": []}
    for mood in MOODS:
        for i in range(per_mood):
            mode = "major" if i < per_mood * MOOD_MODE_MIX else "minor"
            length = lengths[i % len(lengths)]
            results["rule_engine"].append((mood, mode, rule(mood, mode, length)))
        for mode in ("major", "minor"):
            n = int(per_mood * (MOOD_MODE_MIX if mode == "major" else 1 - MOOD_MODE_MIX))
            for j, length in enumerate(lengths):
                k = n // len(lengths) + (j < n % len(lengths))
                if not k:
                    continue
                for label, cond in (("model", mood), ("model_unconditioned", "any")):
                    for s in sample(model, tok, mode=mode, length=length, mood=cond, num_samples=k,
                                    generator=gen if device.type == "cpu" else None):
                        results[label].append((mood, mode, s.degrees))

    report = {
        "checkpoint": str(ckpt),
        "test_loss": round(test_loss, 4),
        "test_perplexity": round(math.exp(test_loss), 3),
        "generators": {name: phrase_metrics(s, train_set) for name, s in results.items()},
        "per_mood_control": {
            name: {m: round(sum(label_mood(d, mo)[0] == m for mm, mo, d in s if mm == m)
                            / max(1, sum(mm == m for mm, _, _ in s)), 3) for m in MOODS}
            for name, s in results.items()
        },
        "examples": {
            m: [" ".join(spell_degrees(KEYS_FOR_MODE[mo], d)) for mm, mo, d in results["model"] if mm == m][:3]
            for m in MOODS
        },
    }
    return report


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", type=Path, required=True)
    ap.add_argument("--data", type=Path, required=True)
    ap.add_argument("--per-mood", type=int, default=200)
    ap.add_argument("--lengths", type=int, nargs="+", default=[4, 8])
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--out", type=Path, default=None)
    args = ap.parse_args()
    report = run(args.ckpt, args.data, args.per_mood, args.lengths, args.seed)
    text = json.dumps(report, indent=1, ensure_ascii=False)
    (args.out or args.ckpt.parent / "eval.json").write_text(text)
    print(text)


if __name__ == "__main__":
    main()
