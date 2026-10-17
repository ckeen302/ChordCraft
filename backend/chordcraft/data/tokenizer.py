"""Key-relative chord tokenizer shared by data prep, training, and serving.

Sequence layout::

    <bos> mode:minor genre:rock mood:epic len:4  0:m 8:maj 3:maj 10:maj  <eos>

Chord tokens are ``{semitones above tonic}:{quality}`` — key-invariant, so one
"I–V–vi–IV" token pattern covers all twelve keys and generation in any key is
just spelling the degrees (``spell_degrees``). ``len:N`` tells the model how
many chords to write, so it can plan where the cadence lands. Genre and mood
can be ``any``, which training uses as conditioning dropout.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from pathlib import Path

from chordcraft.theory import QUALITY_INTERVALS
from chordcraft.theory.harmony import MOODS

from .phrases import MAX_LEN, MIN_LEN, Degree

SPECIALS = ["<pad>", "<bos>", "<eos>", "<unk>"]
MODES = ["major", "minor"]
GENRES = ["pop", "rock", "country", "alternative", "pop rock", "punk", "metal",
          "rap", "soul", "jazz", "reggae", "electronic"]
ANY = "any"
VOCAB_VERSION = 2
LENGTHS = range(MIN_LEN, MAX_LEN + 1)
N_CONTROL = 5  # <bos> mode genre mood len


class ChordTokenizer:
    def __init__(self) -> None:
        tokens = list(SPECIALS)
        tokens += [f"mode:{m}" for m in MODES]
        tokens += [f"genre:{g}" for g in [*GENRES, ANY]]
        tokens += [f"mood:{m}" for m in [*MOODS, ANY]]
        tokens += [f"len:{n}" for n in LENGTHS]
        self.first_chord_id = len(tokens)
        tokens += [f"{off}:{q}" for off in range(12) for q in QUALITY_INTERVALS]
        self.itos = tokens
        self.stoi = {t: i for i, t in enumerate(tokens)}
        self.pad_id, self.bos_id, self.eos_id, self.unk_id = (self.stoi[t] for t in SPECIALS)

    def __len__(self) -> int:
        return len(self.itos)

    @property
    def chord_ids(self) -> range:
        return range(self.first_chord_id, len(self.itos))

    def control_ids(self, mode: str, length: int, genre: str = ANY, mood: str = ANY) -> list[int]:
        genre = genre if genre in GENRES else ANY
        mood = mood if mood in MOODS else ANY
        length = max(MIN_LEN, min(MAX_LEN, length))
        return [self.bos_id, self.stoi[f"mode:{mode}"], self.stoi[f"genre:{genre}"],
                self.stoi[f"mood:{mood}"], self.stoi[f"len:{length}"]]

    def encode(self, phrase: Sequence[Degree], mode: str, genre: str = ANY, mood: str = ANY) -> list[int]:
        chords = [self.stoi.get(f"{off}:{q}", self.unk_id) for off, q in phrase]
        return [*self.control_ids(mode, len(phrase), genre, mood), *chords, self.eos_id]

    def decode_chords(self, ids: Sequence[int]) -> list[Degree]:
        out: list[Degree] = []
        for i in ids:
            if i == self.eos_id:
                break
            if i >= self.first_chord_id:
                off, q = self.itos[i].split(":", 1)
                out.append((int(off), q))
        return out

    def save(self, path: Path) -> None:
        path.write_text(json.dumps({"version": VOCAB_VERSION, "tokens": self.itos}, indent=1))

    @classmethod
    def check_compatible(cls, path: Path) -> None:
        saved = json.loads(path.read_text())
        if saved["tokens"] != cls().itos:
            raise ValueError(f"Vocabulary at {path} does not match this code (version {saved.get('version')})")
