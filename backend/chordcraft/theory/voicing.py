"""Smooth voice leading — port of lib/theory/voicing.ts.

Keeps each chord's bass anchor, places upper voices in the octave nearest the
previous chord's voices (C4–B5 window), and keeps every chord tone.
"""

from __future__ import annotations

from dataclasses import replace

from .chords import ParsedChord

UPPER_LO = 60  # C4
UPPER_HI = 83  # B5


def _nearest_octave(pc: int, target: int) -> int:
    best, best_d = -1, float("inf")
    n = UPPER_LO + (pc - UPPER_LO) % 12
    while n <= UPPER_HI:
        d = abs(n - target)
        if d < best_d:
            best, best_d = n, d
        n += 12
    return best


def voice_lead_progression(chords: list[ParsedChord]) -> list[ParsedChord]:
    prev_upper: list[int] | None = None
    out: list[ParsedChord] = []

    for ch in chords:
        if len(ch.notes) < 2:
            out.append(ch)
            continue

        bass = ch.notes[0]
        bass_pc = bass % 12
        pcs = list(dict.fromkeys(n % 12 for n in ch.notes[1:]))

        if prev_upper is None:
            upper = []
            for pc in pcs:
                n = bass + (pc - bass_pc) % 12
                if n <= bass:
                    n += 12
                upper.append(n)
            upper.sort()
        else:
            targets = []
            for pc in pcs:
                best_n, best_d = _nearest_octave(pc, prev_upper[0]), float("inf")
                for p in prev_upper:
                    cand = _nearest_octave(pc, p)
                    d = abs(cand - p)
                    if d < best_d:
                        best_n, best_d = cand, d
                targets.append(best_n)
            used: set[int] = set()
            upper = []
            for v in targets:
                while v in used and v + 12 <= UPPER_HI:
                    v += 12
                while v in used and v - 12 >= UPPER_LO:
                    v -= 12
                used.add(v)
                upper.append(v)
            upper.sort()

        prev_upper = upper
        out.append(replace(ch, notes=[bass, *upper]))

    return out
