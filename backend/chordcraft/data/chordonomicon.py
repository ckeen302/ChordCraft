"""Chordonomicon row parsing and chord normalisation.

Chordonomicon (ailsntua/Chordonomicon on the Hugging Face Hub, CC BY-NC 4.0)
writes sharps as ``s`` (``Csmin`` = C#m, ``A/Cs`` = A/C#), minor as ``min``,
power chords as ``no3d``, and marks song sections inline (``<verse_1>``).
Every chord is mapped to a (root pitch class, quality) pair in ChordCraft's
24-quality vocabulary. ``EXACT`` suffixes keep their meaning; the rare
``APPROX`` ones (< 0.5% of chords) collapse to the nearest catalogued quality.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from chordcraft.theory import NOTE_MAP

EXACT: dict[str, str] = {
    "": "maj", "min": "m", "7": "7", "min7": "m7", "no3d": "5", "maj7": "maj7",
    "add9": "add9", "sus4": "sus4", "sus2": "sus2", "add13": "6", "9": "9",
    "7sus4": "7sus4", "dim": "dim", "min9": "m9", "minadd13": "m6", "dim7": "dim7",
    "maj9": "maj9", "aug": "aug", "13": "13", "min11": "m11", "11": "11",
    "minmaj7": "mmaj7", "7b9": "7b9",
}

APPROX: dict[str, str] = {
    "add11": "maj", "7sus2": "7sus4", "minadd9": "m", "maj7sus2": "maj7", "augmaj7": "aug",
    "majs9": "maj7", "minadd11": "m", "maj13": "maj9", "maj911s": "maj9", "min13": "m11",
    "13b": "13", "maj7sus4": "maj7", "maj11": "maj9", "augmaj9": "aug", "majs911s": "maj9",
    "dimb7": "m7b5", "dim9": "m7b5", "13b9": "7b9", "minmaj9": "mmaj7", "11s": "7",
    "minb9": "m7", "maj1311s": "maj9", "11b9": "7b9", "dimadd13": "dim", "dim13b9": "dim7",
    "dimb9": "dim", "minmaj11": "mmaj7", "minmaj13": "mmaj7", "min1113b": "m11",
    "dimadd11": "dim", "dim11b9": "dim", "augmaj11": "aug", "dim11": "dim",
}

_SECTION_RE = re.compile(r"^<([a-z]+(?:_[a-z]+)*?)(?:_\d+)?>$")


@dataclass(frozen=True)
class NormChord:
    pc: int
    quality: str
    approx: bool = False


def parse_root(body: str) -> tuple[int, str] | None:
    """Split a chord body into (root pitch class, suffix). ``s`` is a sharp unless it starts "sus"."""
    if not body or body[0] not in "ABCDEFG":
        return None
    letter, rest = body[0], body[1:]
    if rest.startswith("s") and not rest.startswith("sus"):
        name, rest = letter + "#", rest[1:]
    elif rest.startswith("b"):
        name, rest = letter + "b", rest[1:]
    else:
        name = letter
    pc = NOTE_MAP.get(name)
    return None if pc is None else (pc % 12, rest)


def normalize_chord(token: str) -> NormChord | None:
    """Map one Chordonomicon chord token to (pc, quality); the slash bass is dropped."""
    parsed = parse_root(token.split("/")[0])
    if parsed is None:
        return None
    pc, suffix = parsed
    if suffix in EXACT:
        return NormChord(pc, EXACT[suffix])
    if suffix in APPROX:
        return NormChord(pc, APPROX[suffix], approx=True)
    return None


def parse_sections(chords_field: str) -> list[tuple[str, list[str]]]:
    """Split the ``chords`` column into (section name, chord tokens) runs."""
    sections: list[tuple[str, list[str]]] = []
    current, tokens = "untagged", []
    for tok in chords_field.split():
        m = _SECTION_RE.match(tok)
        if m:
            if tokens:
                sections.append((current, tokens))
            current, tokens = m.group(1), []
        elif not tok.startswith("<"):
            tokens.append(tok)
    if tokens:
        sections.append((current, tokens))
    return sections
