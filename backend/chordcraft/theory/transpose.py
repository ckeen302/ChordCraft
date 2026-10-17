"""Transposition — port of lib/theory/transpose.ts."""

from __future__ import annotations

import re
from dataclasses import replace

from .chords import NOTE_MAP, ParsedChord
from .keys import KEYS

SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]

_KEY_RE = re.compile(r"^([A-G][#b]?) (Major|Minor)$")


def key_prefers_flats(key_name: str) -> bool:
    pool = KEYS.get(key_name, [])
    has_flat = any(re.match(r"^[A-G]b", s) or "b" in s[1:] for s in pool)
    return has_flat and not any("#" in s for s in pool)


def transpose_key_name(key_name: str, semitones: int) -> str:
    m = _KEY_RE.match(key_name)
    if not m or m.group(1) not in NOTE_MAP:
        return key_name
    pc = (NOTE_MAP[m.group(1)] + semitones) % 12
    for name in KEYS:
        mm = _KEY_RE.match(name)
        if mm and mm.group(2) == m.group(2) and NOTE_MAP[mm.group(1)] % 12 == pc:
            return name
    return key_name


def transpose_progression(chords: list[ParsedChord], semitones: int, prefer_flats: bool) -> list[ParsedChord]:
    names = FLAT_NAMES if prefer_flats else SHARP_NAMES

    def rename(note_name: str) -> str:
        midi = NOTE_MAP.get(note_name)
        return note_name if midi is None else names[(midi + semitones) % 12]

    out = []
    for ch in chords:
        if not ch.notes or ch.root not in NOTE_MAP:
            out.append(ch)
            continue
        parts = ch.symbol.split("/")
        body, bass = parts[0], (parts[1] if len(parts) > 1 else None)
        root_match = re.match(r"^[A-G][#b]?", body)
        suffix = body[len(root_match.group(0)) :] if root_match else ""
        new_root = rename(ch.root)
        new_bass = rename(bass.strip()) if bass is not None else None
        out.append(
            replace(
                ch,
                root=new_root,
                symbol=new_root + suffix + (f"/{new_bass}" if new_bass else ""),
                notes=[n + semitones for n in ch.notes],
                displayQuality=(
                    re.sub(r"/.*$", lambda _, repl=f"/{new_bass}": repl, ch.displayQuality, count=1)
                    if new_bass
                    else ch.displayQuality
                ),
            )
        )
    return out
