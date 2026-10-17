"""Key estimation from chord content (the dataset has no key annotations).

Krumhansl–Kessler key profiles correlated against a pitch-class histogram of
the chord tones, plus a tonic prior: songs overwhelmingly start or end on the
tonic chord and spend the most time there, which resolves the classic
relative-major/minor confusion that profiles alone leave open. Accuracy is
measured against the TheoryTab-sourced songs in fixtures/popular-songs.json
(54% on 685 songs; each is one real section, which often doesn't start on the
tonic, and modal songs count against their nearest major/minor key).
"""

from __future__ import annotations

import math
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass

from chordcraft.theory import QUALITY_INTERVALS
from chordcraft.theory.analysis import FAMILY

from .chordonomicon import NormChord

KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

TONIC_WEIGHT = 0.5  # how much the tonic-chord prior counts against the profile fit


@dataclass(frozen=True)
class KeyEstimate:
    tonic: int  # pitch class 0-11
    mode: str  # "major" | "minor"
    score: float
    margin: float  # best score minus runner-up — a confidence proxy


def _pearson(x: Sequence[float], y: Sequence[float]) -> float:
    mx, my = sum(x) / len(x), sum(y) / len(y)
    num = sum((a - mx) * (b - my) for a, b in zip(x, y, strict=True))
    den = math.sqrt(sum((a - mx) ** 2 for a in x) * sum((b - my) ** 2 for b in y))
    return num / den if den else 0.0


def _triad_family(quality: str) -> str:
    return FAMILY.get(quality, "maj")


def estimate_key(chords: Sequence[NormChord], beats: Sequence[float] | None = None) -> KeyEstimate | None:
    if not chords:
        return None
    weights = beats or [1.0] * len(chords)
    hist = [0.0] * 12
    for c, w in zip(chords, weights, strict=True):
        for i in QUALITY_INTERVALS[c.quality]:
            hist[(c.pc + i) % 12] += w
        hist[c.pc] += w  # the root carries extra harmonic weight
    if not any(hist):
        return None

    # Tonic-chord prior: share of time on the candidate tonic triad, plus edges.
    time_on: Counter[tuple[int, str]] = Counter()
    for c, w in zip(chords, weights, strict=True):
        time_on[(c.pc, _triad_family(c.quality))] += w
    total = sum(weights)
    first = (chords[0].pc, _triad_family(chords[0].quality))
    last = (chords[-1].pc, _triad_family(chords[-1].quality))

    scored = []
    for tonic in range(12):
        rotated = hist[tonic:] + hist[:tonic]
        for mode, profile, fam in (("major", KK_MAJOR, "maj"), ("minor", KK_MINOR, "min")):
            tonic_chord = (tonic, fam)
            prior = time_on[tonic_chord] / total + 0.5 * (first == tonic_chord) + 0.5 * (last == tonic_chord)
            scored.append((_pearson(rotated, profile) + TONIC_WEIGHT * prior, tonic, mode))
    scored.sort(reverse=True)
    best, runner = scored[0], scored[1]
    return KeyEstimate(tonic=best[1], mode=best[2], score=best[0], margin=best[0] - runner[0])
