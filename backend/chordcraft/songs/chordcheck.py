"""Cross-check a TheoryTab progression against the notes of a Songsterr transcription.

Songsterr tabs are full multitrack transcriptions (rhythm guitar, bass, keys …) played back
in sync with the record. Every note is a string + fret on a track with a known tuning and
capo, so the tab gives the actual pitches sounding at every beat of the song: a second,
independent source for the harmony, without trusting anyone's chord names.

The check slides the TheoryTab progression along the tab's harmony timeline (in any of the
pulse readings the two sources might use: half/double time, dotted pulses) and accepts the
first place where every chord of a beat or longer fits the notes under it (shorter passing chords are finer
than tabs notate and aren't scored):

- most of the sounding weight (notes × duration) is chord tones, and the root is among them,
- the chord's third is heard and isn't outweighed by the opposite third (major vs minor),
- a seventh chord's seventh isn't outweighed by the other seventh (maj7 vs 7); when the tab
  doesn't voice a seventh at all, the chord is confirmed as its triad,
- it changes on time: each half, and its first and last beat, fit it at least as well as its
  neighbours,
- the bass, where the tab has a bass track, plays a chord tone.

It's tried in the tab's own key first; tabs are occasionally transcribed from a cover in
another key, so a match in another key still confirms the progression but not the key.
"""

from __future__ import annotations

import functools
import re
from dataclasses import dataclass
from fractions import Fraction

from . import songsterr
from .hooktheory import PC
from .songsterr import _json

HARMONY = re.compile(r"guitar|piano|keyboard|organ|rhodes|wurl|clav|synth|string|ukulele|banjo|mandolin|bass|pad|"
                     r"harpsichord|accordion|celesta|marimba|vibraphone", re.I)
NOT_HARMONY = re.compile(r"vocal|voice|vox|lead|solo|melody|drum|percussion|choir|sax|trumpet|flute|whistle|"
                         r"harmonica|trombone|clarinet", re.I)
STEP = Fraction(1, 2)          # timeline resolution, quarters
CHORD_TONE_SHARE = 0.6         # of the sounding weight under a chord
ROOT_SHARE = 0.1               # the root's minimum share of it
MAX_TRACKS = 6

QUALITY_TONES = {  # suffix → semitones above the root (the chord's defining tones)
    "": (0, 4, 7), "m": (0, 3, 7), "dim": (0, 3, 6), "aug": (0, 4, 8), "7": (0, 4, 7, 10),
    "maj7": (0, 4, 7, 11), "m7": (0, 3, 7, 10), "dim7": (0, 3, 6, 9), "m7b5": (0, 3, 6, 10),
    "mmaj7": (0, 3, 7, 11), "sus2": (0, 2, 7), "sus4": (0, 5, 7), "7sus4": (0, 5, 7, 10),
    "6": (0, 4, 7, 9), "m6": (0, 3, 7, 9), "add9": (0, 4, 7, 2), "9": (0, 4, 7, 10, 2),
    "m9": (0, 3, 7, 10, 2), "maj9": (0, 4, 7, 11, 2), "11": (0, 4, 7, 10, 2, 5), "m11": (0, 3, 7, 10, 2, 5),
    "7b9": (0, 4, 7, 10, 1), "7#9": (0, 4, 7, 10, 3), "5": (0, 7),
}
_SYMBOL = re.compile(r"^([A-G][#b]?)([^/]*)(?:/([A-G][#b]?))?$")


@dataclass(frozen=True)
class Target:
    root: int
    tones: frozenset[int]          # pitch classes
    third: int | None              # pitch class of the chord's third (None for sus/power)
    seventh: int | None
    quarters: float


@dataclass
class Verdict:
    status: str                    # confirmed | contradicted | unchecked
    url: str | None = None
    detail: str = ""
    key_agrees: bool | None = None
    window: tuple[int, int] | None = None   # when only part of the progression is confirmed


def targets(chords: list[tuple[str, float]], time_signature: str) -> list[Target]:
    n, d = map(int, time_signature.split("/"))
    per_pulse = 1.5 if d == 8 and n % 3 == 0 else 1.0
    out = []
    for symbol, beats in chords:
        m = _SYMBOL.match(symbol)
        assert m and m.group(2) in QUALITY_TONES, symbol
        root, ivs = PC[m.group(1)], QUALITY_TONES[m.group(2)]
        third = next((i for i in ivs if i in (3, 4)), None)
        seventh = None if m.group(2) in ("dim7", "6", "m6") else next((i for i in ivs if i in (10, 11)), None)
        tones = {(root + i) % 12 for i in ivs} | ({PC[m.group(3)]} if m.group(3) else set())
        out.append(Target(root, frozenset(tones), None if third is None else (root + third) % 12,
                          None if seventh is None else (root + seventh) % 12, beats * per_pulse))
    return out


# ── the tab's harmony timeline ──────────────────────────────────────────────


def _quarters(beat: dict) -> Fraction:
    num, den = beat.get("duration", [1, 4])
    q = Fraction(4 * num, den)
    if t := beat.get("tuplet"):
        q *= Fraction(1 << (t.bit_length() - 1), t) if t > 1 else 1
    return q


def track_notes(part: dict) -> list[tuple[Fraction, Fraction, int]]:
    """(start, length, MIDI pitch) for every sounding note, in quarters from the top."""
    tuning, capo = part.get("tuning") or [], part.get("capo") or 0
    out, pos, sig = [], Fraction(0), (4, 4)
    for m in part.get("measures", []):
        if m.get("signature"):
            sig = tuple(m["signature"])
        for voice in m.get("voices") or []:
            at = pos
            for beat in voice.get("beats", []):
                q = _quarters(beat)
                if not beat.get("rest"):
                    for note in beat.get("notes", []):
                        if note.get("rest") or note.get("dead") or "fret" not in note:
                            continue
                        s = note.get("string", 0)
                        if s < len(tuning):
                            out.append((at, q, tuning[s] + capo + note["fret"]))
                at += q
        pos += Fraction(4 * sig[0], sig[1])
    return out


@dataclass
class Timeline:
    """Running totals per STEP slot of each pitch class: harmony tracks, and the bass alone."""
    harmony: list[list[float]]   # [pitch class][slot + 1]
    bass: list[list[float]]
    has_bass: bool

    def __len__(self) -> int:
        return len(self.harmony[0]) - 1


def timeline(parts: list[tuple[dict, bool]]) -> Timeline:
    tracks = [(track_notes(part), is_bass) for part, is_bass in parts]
    slots = max((int((a + q) / STEP) + 1 for ns, _ in tracks for a, q, _ in ns), default=0)
    harmony = [[0.0] * slots for _ in range(12)]
    bass = [[0.0] * slots for _ in range(12)]
    for ns, is_bass in tracks:
        for at, q, pitch in ns:
            first = int(at / STEP)
            last = max(int((at + q) / STEP), first + 1)
            for i in range(first, min(last, slots)):
                harmony[pitch % 12][i] += 0.5 if is_bass else 1.0
                if is_bass:
                    bass[pitch % 12][i] += 1.0
    def running(rows: list[list[float]]) -> list[list[float]]:
        out = []
        for row in rows:
            acc, total = [0.0], 0.0
            for x in row:
                total += x
                acc.append(total)
            out.append(acc)
        return out
    return Timeline(running(harmony), running(bass), any(b for ns, b in tracks if ns))


def fits(t: Target, shift: int, harm: dict[int, float], bass: dict[int, float], has_bass: bool) -> bool | None:
    """Does this chord (transposed by ``shift``) fit the notes? None when the notes can't tell
    (silence, or no third sounding for a chord that has one)."""
    total = sum(harm.values())
    if total == 0:
        return None
    tones = {(p + shift) % 12 for p in t.tones}
    if sum(w for p, w in harm.items() if p in tones) < CHORD_TONE_SHARE * total:
        return False
    root = (t.root + shift) % 12
    if harm.get(root, 0) < ROOT_SHARE * total:
        return False  # relatives share two notes (G vs Em): the root itself has to sound
    if t.third is not None:
        third = (t.third + shift) % 12
        other = (root + (4 if (third - root) % 12 == 3 else 3)) % 12
        if harm.get(other, 0) > harm.get(third, 0):
            return False
        if not harm.get(third):
            return None  # power chords / bass alone: major vs minor can't be told here
    if t.seventh is not None:
        seventh = (t.seventh + shift) % 12
        other = (root + (11 if (seventh - root) % 12 == 10 else 10)) % 12
        if harm.get(other, 0) > harm.get(seventh, 0):
            return False
    if has_bass and bass:
        low = max(bass, key=bass.__getitem__)
        if low not in tones:
            return False
    return True


def _span(tl: Timeline, start: int, slots: int) -> tuple[dict[int, float], dict[int, float]]:
    lo, hi = max(start, 0), min(start + slots, len(tl))
    if hi <= lo:
        return {}, {}
    harm = {p: w for p in range(12) if (w := tl.harmony[p][hi] - tl.harmony[p][lo]) > 0}
    bass = {p: w for p in range(12) if (w := tl.bass[p][hi] - tl.bass[p][lo]) > 0}
    return harm, bass


def _share(t: Target, shift: int, harm: dict[int, float]) -> float | None:
    total = sum(harm.values())
    if not total:
        return None
    tones = {(p + shift) % 12 for p in t.tones}
    return sum(w for p, w in harm.items() if p in tones) / total


def _changes_on_time(prog: list[Target], i: int, shift: int, tl: Timeline, at: int, n: int) -> bool:
    """The chord changes where TheoryTab says: each half of its span, and its first and last
    beat (give or take half a beat, for pushed chords), fit it at least as well as the chords
    either side of it."""
    t = prog[i]
    neighbours = [prog[j] for j in (i - 1, i + 1)
                  if 0 <= j < len(prog) and prog[j].root != t.root and prog[j].quarters >= 1]
    beat = int(1 / STEP)
    spans = [(at, n // 2), (at + n - n // 2, n // 2)] if n >= 2 else [(at, n)]  # each half
    if n >= 2 * beat:
        spans += [(at + 1, beat), (at + n - 1 - beat, beat)]                    # first and last beat
    for start, size in spans:
        harm, _ = _span(tl, start, size)
        own = _share(t, shift, harm)
        if own is None:
            continue
        if own < 0.5:
            return False
        if any((_share(nb, shift, harm) or 0) > own + 0.05 for nb in neighbours):
            return False
    return True


def locate(prog: list[Target], tl: Timeline, compound: bool, shifts: list[int]) -> tuple[int, float, int] | None:
    """(shift, pulse ratio, start slot) of the first place the whole progression fits."""
    ratios = [1, 0.5, 2] + ([1.5, 0.75, 3] if compound else [])
    for shift in shifts:
        for k in ratios:
            lengths = [max(1, round(t.quarters * k / STEP)) for t in prog]
            for start in range(0, max(len(tl) - sum(lengths) + 1, 0)):
                at = start
                for i, (t, n) in enumerate(zip(prog, lengths, strict=True)):
                    if n * STEP < 1:  # passing chords under a beat are finer than tabs notate
                        at += n
                        continue
                    harm, bass = _span(tl, at, n)
                    verdict = fits(t, shift, harm, bass, tl.has_bass)
                    if verdict and not _changes_on_time(prog, i, shift, tl, at, n):
                        verdict = False
                    at += n
                    if not verdict:  # every chord must positively fit; "can't tell" isn't a pass
                        break
                else:
                    return shift, k, start
    return None


def _verdict(prog: list[Target], i: int, shift: int, tl: Timeline, at: int, n: int) -> bool | None:
    if n * STEP < 1:  # passing chords under a beat are finer than tabs notate
        return None
    harm, bass = _span(tl, at, n)
    verdict = fits(prog[i], shift, harm, bass, tl.has_bass)
    if verdict and not _changes_on_time(prog, i, shift, tl, at, n):
        return False
    return verdict


def best_window(prog: list[Target], tl: Timeline, compound: bool, shift: int, bar: float,
                min_beats: float) -> tuple[int, int] | None:
    """The longest stretch of the progression (chord indexes, inclusive) that fits the tab
    somewhere: starting on a bar line (±½ beat, for pushed chords), at least ``min_beats``
    TheoryTab beats and 3 chords long, every chord of a beat or more positively fitting."""
    starts_beat = [sum(t.quarters for t in prog[:i]) for i in range(len(prog))]
    best: tuple[float, int, int] | None = None
    for k in [1, 0.5, 2] + ([1.5, 0.75, 3] if compound else []):
        lengths = [max(1, round(t.quarters * k / STEP)) for t in prog]
        offsets = [sum(lengths[:i]) for i in range(len(prog))]
        for s0 in range(-offsets[-1], len(tl)):
            run_start, checkable = None, 0
            for i in range(len(prog) + 1):
                at = s0 + offsets[i] if i < len(prog) else None
                inside = i < len(prog) and at >= 0 and at + lengths[i] <= len(tl)
                short = i < len(prog) and lengths[i] * STEP < 1
                v = (True if short else _verdict(prog, i, shift, tl, at, lengths[i])) if inside else False
                if not v or i == len(prog):
                    if run_start is not None:
                        beats = starts_beat[i - 1] + prog[i - 1].quarters - starts_beat[run_start]
                        if (i - run_start >= 3 and beats >= min_beats and checkable
                                and (best is None or beats > best[0])):
                            best = (beats, run_start, i - 1)
                    run_start, checkable = None, 0
                    continue
                if run_start is None:
                    phase = (starts_beat[i] / bar) % 1
                    if min(phase, 1 - phase) * bar > 0.5:
                        continue
                    run_start = i
                if not short:
                    checkable += 1
    return (best[1], best[2]) if best else None


def _harmony_tracks(meta: dict) -> list[tuple[int, bool]]:
    out = []
    for i, t in enumerate(meta.get("tracks") or []):
        label = f"{t.get('instrument', '')} {t.get('name', '')}"
        if HARMONY.search(label) and not NOT_HARMONY.search(label):
            out.append((i, "bass" in t.get("instrument", "").lower()))
    return out[:MAX_TRACKS]


@functools.lru_cache(maxsize=64)
def load(url: str) -> Timeline | None:
    """The harmony timeline of a Songsterr tab (None when it has no usable tracks)."""
    m = songsterr.PAGE.match(url)
    meta = _json(f"https://www.songsterr.com/api/meta/{m.group(1)}") if m else None
    if not meta or not meta.get("image"):
        return None
    parts = []
    for track, is_bass in _harmony_tracks(meta):
        part = _json(f"{songsterr._PARTS}/{meta['songId']}/{meta['revisionId']}/{meta['image']}/{track}.json")
        if part and part.get("measures"):
            parts.append((part, is_bass))
    return timeline(parts) if parts else None


def check(title: str, artist: str, chords: list[tuple[str, float]], time_signature: str,
          url: str | None = None) -> Verdict:
    url = url or songsterr.search(title, artist)
    if not url:
        return Verdict("unchecked", detail="no Songsterr tab")
    tl = load(url)
    if tl is None or not len(tl):
        return Verdict("unchecked", url, "no rhythm, bass or keys tracks with notes")
    prog = targets(chords, time_signature)
    n, d = map(int, time_signature.split("/"))
    compound = d == 8 and n % 3 == 0
    if hit := locate(prog, tl, compound, [0]):
        return Verdict("confirmed", url, f"in the tab's key, from quarter {float(hit[2] * STEP):g}", key_agrees=True)
    bar = (n / 3 * 1.5) if compound else n * 4 / d          # quarters per bar
    total = sum(t.quarters for t in prog)
    if window := best_window(prog, tl, compound, 0, bar, min(total, max(2 * bar, total / 2))):
        return Verdict("confirmed", url, f"chords {window[0] + 1}-{window[1] + 1} in the tab's key",
                       key_agrees=True, window=window)
    if hit := locate(prog, tl, compound, list(range(1, 12))):
        return Verdict("confirmed", url, f"tab is {hit[0]} semitones up, from quarter {float(hit[2] * STEP):g}",
                       key_agrees=False)
    return Verdict("contradicted", url, "the tab's notes never fit this progression")
