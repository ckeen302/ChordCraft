"""Tokenised phrase dataset, mood-balanced sampling, and batch collation."""

from __future__ import annotations

import gzip
import json
from collections import Counter
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import Dataset, WeightedRandomSampler

from chordcraft.data.tokenizer import ANY, N_CONTROL, ChordTokenizer
from chordcraft.theory.harmony import MOODS

GENRE_POS, MOOD_POS = 2, 3  # positions of the genre / mood control tokens


def split_file(data: Path, split: str) -> Path:
    """``{split}.jsonl.gz``, or ``{split}.jsonl`` where a host (e.g. Kaggle) auto-decompressed it."""
    for name in (f"{split}.jsonl.gz", f"{split}.jsonl"):
        if (data / name).exists():
            return data / name
    raise FileNotFoundError(f"no {split}.jsonl[.gz] in {data}")


def open_split(path: Path):
    return gzip.open(path, "rt", encoding="utf-8") if path.suffix == ".gz" else open(path, encoding="utf-8")


class PhraseDataset(Dataset):
    """Pre-tokenised phrases stored as one padded int16 matrix (compact for ~1.5M rows)."""

    def __init__(self, path: Path, tok: ChordTokenizer, limit: int | None = None) -> None:
        rows, moods = [], []
        with open_split(path) as f:
            for i, line in enumerate(f):
                if limit and i >= limit:
                    break
                r = json.loads(line)
                rows.append(tok.encode([tuple(d) for d in r["degrees"]], r["mode"], r["genre"], r["mood"]))
                moods.append(r["mood"])
        width = max(len(r) for r in rows)
        self.ids = np.full((len(rows), width), tok.pad_id, dtype=np.int16)
        for i, r in enumerate(rows):
            self.ids[i, : len(r)] = r
        self.moods = moods
        self.pad_id = tok.pad_id

    def __len__(self) -> int:
        return len(self.ids)

    def __getitem__(self, i: int) -> np.ndarray:
        return self.ids[i]

    def mood_counts(self) -> Counter:
        return Counter(self.moods)

    def balanced_sampler(self, alpha: float, num_samples: int | None = None) -> WeightedRandomSampler:
        """Sample moods ∝ freq^(1-alpha): alpha=0 → natural mix, alpha=1 → uniform over moods."""
        counts = self.mood_counts()
        weights = torch.tensor([counts[m] ** -alpha for m in self.moods], dtype=torch.double)
        return WeightedRandomSampler(weights, num_samples or len(self), replacement=True)


class Collator:
    """Stack, trim padding, apply conditioning dropout, and build next-token targets.

    Loss is computed only on chord tokens and EOS — control tokens are inputs.
    """

    def __init__(self, tok: ChordTokenizer, cond_dropout: float = 0.0, seed: int = 0) -> None:
        self.tok = tok
        self.cond_dropout = cond_dropout
        self.any_genre = tok.stoi[f"genre:{ANY}"]
        self.any_mood = tok.stoi[f"mood:{ANY}"]
        self.rng = np.random.default_rng(seed)

    def __call__(self, batch: list[np.ndarray]) -> dict[str, torch.Tensor]:
        ids = np.stack(batch).astype(np.int64)
        pad = self.tok.pad_id
        width = int((ids != pad).sum(1).max())
        ids = ids[:, :width]
        if self.cond_dropout:
            n = len(ids)
            ids[self.rng.random(n) < self.cond_dropout, GENRE_POS] = self.any_genre
            ids[self.rng.random(n) < self.cond_dropout, MOOD_POS] = self.any_mood
        x = torch.from_numpy(ids[:, :-1].copy())
        y = torch.from_numpy(ids[:, 1:].copy())
        positions = torch.arange(y.shape[1])
        loss_mask = (y != pad) & (positions >= N_CONTROL - 1)
        return {"input": x, "target": y, "loss_mask": loss_mask, "pad_mask": x != pad}


MOOD_IDS = MOODS  # re-exported for evaluation scripts
