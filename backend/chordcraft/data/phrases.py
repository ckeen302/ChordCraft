"""Turn song sections into key-relative chord phrases.

A phrase is a section's chords as (degree, quality) pairs — degree = semitones
above the estimated tonic — with repeated chords merged. Sections that loop a
short progression (the norm in popular music) are reduced to one cycle, so the
model learns "the progression", not "the progression x8". Longer through-
composed sections are clipped to MAX_LEN chords.
"""

from __future__ import annotations

from collections.abc import Sequence

from .chordonomicon import NormChord

Degree = tuple[int, str]  # (semitones above tonic, quality)

MIN_LEN = 2
MAX_LEN = 16


def to_degrees(chords: Sequence[NormChord], tonic: int) -> list[Degree]:
    return [((c.pc - tonic) % 12, c.quality) for c in chords]


def merge_repeats(seq: Sequence[Degree]) -> list[Degree]:
    out: list[Degree] = []
    for d in seq:
        if not out or out[-1] != d:
            out.append(d)
    return out


def loop_period(seq: Sequence[Degree], max_period: int = MAX_LEN) -> int | None:
    """Smallest p such that ``seq`` is ``seq[:p]`` repeated (>= 2 full cycles, partial tail allowed)."""
    n = len(seq)
    for p in range(1, min(max_period, n // 2) + 1):
        if all(seq[i] == seq[i % p] for i in range(n)):
            return p
    return None


def extract_phrase(seq: Sequence[Degree]) -> list[Degree] | None:
    merged = merge_repeats(seq)
    period = loop_period(merged)
    phrase = merged[:period] if period else merged[:MAX_LEN]
    # A one-chord vamp (or a loop that merges down to one chord) isn't a progression.
    if len(phrase) < MIN_LEN or len({d for d in phrase}) < MIN_LEN:
        return None
    return phrase
