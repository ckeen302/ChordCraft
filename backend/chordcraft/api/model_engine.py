"""Loads the trained chord transformer for the API and samples progressions from it.

Where the model comes from, in order:

1. ``CHORD_MODEL_PATH`` — a training checkpoint (``.pt``) or an exported
   Hub-layout directory (``model.safetensors`` + ``config.json``)
2. ``backend/models/chord-transformer-v1.pt`` if present (local development)
3. ``CHORD_MODEL_REPO`` — a Hugging Face Hub repo id, downloaded on first use
   (how the deployed Space gets its weights)

PyTorch is an optional extra, so the API keeps serving the rule engine when
torch or the model is missing — ``status()`` says why.
"""

from __future__ import annotations

import os
import threading
import time
from dataclasses import dataclass
from pathlib import Path

DEFAULT_PATH = Path(__file__).resolve().parents[2] / "models" / "chord-transformer-v1.pt"

# Decoding settings chosen on the v1 checkpoint: loop blocking removes repeated
# blocks entirely; best-of-4 by mean log-prob keeps outputs idiomatic.
TEMPERATURE = 0.9
TOP_P = 0.95
PRESENCE_PENALTY = 0.3
CANDIDATES = 4
DOWNLOAD_RETRY_S = 60  # a failed Hub download is retried, not cached forever


@dataclass
class ModelResult:
    degrees: list[tuple[int, str]]
    logprob: float


class ModelEngine:
    def __init__(self, path: Path | None = None, repo: str | None = None) -> None:
        self.path = Path(path or os.getenv("CHORD_MODEL_PATH") or DEFAULT_PATH)
        self.repo = repo if path else (repo or os.getenv("CHORD_MODEL_REPO"))
        self._model = None
        self._tok = None
        self._error: str | None = None
        self._retry_at: float | None = None
        self._lock = threading.Lock()

    def _settled(self) -> bool:
        if self._model is not None:
            return True
        return self._error is not None and (self._retry_at is None or time.monotonic() < self._retry_at)

    def _load(self) -> None:
        if self._settled():
            return
        with self._lock:
            if self._settled():
                return
            self._error, self._retry_at = None, None
            try:
                import torch  # noqa: F401 — optional dependency

                from chordcraft.model.generate import load_model
                from chordcraft.model.hub import download, load_exported
            except ImportError:
                self._error = "PyTorch is not installed (install the `ml` extra)"
                return
            try:
                if self.path.is_dir():
                    self._model, self._tok = load_exported(self.path, "cpu")
                elif self.path.exists():
                    self._model, self._tok = load_model(self.path, "cpu")
                elif self.repo:
                    try:
                        local = download(self.repo)
                    except Exception as e:  # network / Hub outage: retry later
                        self._error = f"could not download {self.repo}: {e}"
                        self._retry_at = time.monotonic() + DOWNLOAD_RETRY_S
                        return
                    self.path = local
                    self._model, self._tok = load_exported(self.path, "cpu")
                else:
                    self._error = f"checkpoint not found at {self.path}"
            except Exception as e:  # corrupt / incompatible checkpoint, download failure
                self._error = f"failed to load model: {e}"

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
