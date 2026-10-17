"""Loads the trained chord transformer for the API and samples progressions from it.

The checkpoint path comes from ``CHORD_MODEL_PATH`` (default:
``backend/models/chord-transformer-v1.pt``). PyTorch is an optional extra, so
the API keeps serving the rule engine when torch or the checkpoint is missing —
``status()`` says why.
"""

from __future__ import annotations

import os
import threading
from dataclasses import dataclass
from pathlib import Path

DEFAULT_PATH = Path(__file__).resolve().parents[2] / "models" / "chord-transformer-v1.pt"

# Decoding settings chosen on the v1 checkpoint: loop blocking removes repeated
# blocks entirely; best-of-4 by mean log-prob keeps outputs idiomatic.
TEMPERATURE = 0.9
TOP_P = 0.95
PRESENCE_PENALTY = 0.3
CANDIDATES = 4


@dataclass
class ModelResult:
    degrees: list[tuple[int, str]]
    logprob: float


class ModelEngine:
    def __init__(self, path: Path | None = None) -> None:
        self.path = Path(path or os.getenv("CHORD_MODEL_PATH") or DEFAULT_PATH)
        self._model = None
        self._tok = None
        self._error: str | None = None
        self._lock = threading.Lock()

    def _load(self) -> None:
        if self._model is not None or self._error is not None:
            return
        with self._lock:
            if self._model is not None or self._error is not None:
                return
            try:
                import torch  # noqa: F401 — optional dependency

                from chordcraft.model.generate import load_model
            except ImportError:
                self._error = "PyTorch is not installed (install the `ml` extra)"
                return
            if not self.path.exists():
                self._error = f"checkpoint not found at {self.path}"
                return
            try:
                self._model, self._tok = load_model(self.path, "cpu")
            except Exception as e:  # corrupt / incompatible checkpoint
                self._error = f"failed to load checkpoint: {e}"

    def status(self) -> dict:
        self._load()
        return {"available": self._model is not None, "path": str(self.path), "error": self._error}

    @property
    def available(self) -> bool:
        self._load()
        return self._model is not None

    def generate(self, *, mode: str, length: int, mood: str, exclude_diminished: bool,
                 seed: int | None) -> ModelResult:
        self._load()
        if self._model is None:
            raise RuntimeError(self._error or "model unavailable")
        import torch

        from chordcraft.model.generate import sample

        gen = torch.Generator().manual_seed(seed if seed is not None else torch.seed())
        candidates = sample(
            self._model, self._tok, mode=mode, length=length, mood=mood, num_samples=CANDIDATES,
            temperature=TEMPERATURE, top_p=TOP_P, exclude_diminished=exclude_diminished,
            block_loops=True, presence_penalty=PRESENCE_PENALTY, generator=gen,
        )
        best = max(candidates, key=lambda s: s.logprob)
        return ModelResult(degrees=best.degrees, logprob=best.logprob)
