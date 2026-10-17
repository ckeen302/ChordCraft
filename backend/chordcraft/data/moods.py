"""Weak mood labels for key-relative phrases.

Chordonomicon has genres but no moods, so labels are inferred in two tiers:

1. ``pattern`` — the phrase is exactly one of the harmony engine's curated
   mood progressions (compared at triad-family level after merging repeats
   and reducing loops). High precision.
2. ``rule`` — harmonic features (power-chord, extension, and colour-chord
   density, borrowed/chromatic degrees, mode) plus the song's genre.

These are heuristics, not ground truth: the model is trained with mood-token
dropout so it also learns the unconditioned distribution, and evaluation
reports per-source counts so the label quality is visible.
"""

from __future__ import annotations

from collections.abc import Sequence

from chordcraft.theory.analysis import FAMILY
from chordcraft.theory.harmony import PROFILES

from .phrases import Degree, loop_period, merge_repeats

FamDegree = tuple[int, str]

DOMINANT = {"7", "9", "11", "13", "7b9", "7#9"}
EXTENDED = DOMINANT | {"maj7", "m7", "m9", "maj9", "m11", "6", "m6", "m7b5", "mmaj7", "7sus4"}
SHIMMER = {"maj7", "maj9", "add9", "sus2"}
TENSE = {"dim", "dim7", "aug", "mmaj7", "m7b5", "7b9", "7#9"}


def _fam(quality: str) -> str:
    return FAMILY.get(quality, "maj")


def _canonical(seq: Sequence[FamDegree]) -> tuple[FamDegree, ...]:
    merged = merge_repeats(seq)
    period = loop_period(merged)
    return tuple(merged[:period] if period else merged)


def _build_pattern_index() -> dict[tuple[str, tuple[FamDegree, ...]], str]:
    best: dict[tuple[str, tuple[FamDegree, ...]], tuple[int, str]] = {}
    for mood, profile in PROFILES.items():
        for mode, patterns in (("major", profile.major), ("minor", profile.minor)):
            for p in patterns:
                key = (mode, _canonical([(off, _fam(q)) for off, q in p.specs]))
                if key not in best or p.w > best[key][0]:
                    best[key] = (p.w, mood)
    return {k: mood for k, (_, mood) in best.items()}


PATTERN_INDEX = _build_pattern_index()


def label_mood(phrase: Sequence[Degree], mode: str, genre: str = "") -> tuple[str, str]:
    """Return (mood, source) where source is "pattern" or "rule"."""
    fam_seq = [(off, _fam(q)) for off, q in phrase]
    hit = PATTERN_INDEX.get((mode, _canonical(fam_seq)))
    if hit:
        return hit, "pattern"

    n = len(phrase)
    qualities = [q for _, q in phrase]
    share = lambda group: sum(q in group for q in qualities) / n  # noqa: E731
    degrees = set(fam_seq)
    minor = mode == "minor"

    if share({"5"}) >= 0.5 or (genre in ("metal", "punk") and (minor or share({"5"}) > 0)):
        return "aggressive", "rule"
    if share(TENSE) >= 0.25 or (1, "maj") in degrees:
        return "tense", "rule"
    if share(EXTENDED) >= 0.5 or (genre == "jazz" and share(EXTENDED) >= 0.25):
        return "jazz", "rule"
    if share(SHIMMER) >= 0.5 and share(DOMINANT) == 0:
        return "dreamy", "rule"
    if minor and (8, "maj") in degrees and (10, "maj") in degrees:
        return "epic", "rule"
    if not minor and (8, "maj") in degrees and (10, "maj") in degrees:
        return "epic", "rule"
    if not minor and (share({"6"}) > 0 or (4, "maj") in degrees and "7" in qualities):
        return "nostalgic", "rule"
    if not minor and ((2, "min") in degrees and (7, "maj") in degrees and share(EXTENDED) > 0):
        return "romantic", "rule"
    if genre == "soul" and share(EXTENDED) > 0:
        return "romantic", "rule"
    if minor or (not minor and (fam_seq[0] == (9, "min") or (5, "min") in degrees)):
        return "melancholic", "rule"
    return "uplifting", "rule"
