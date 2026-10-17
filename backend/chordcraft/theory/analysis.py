"""Rule-based progression analysis — port of lib/theory/analysis.ts.

Roman numerals, the closing cadence, and named chromatic devices. Output text
matches the TypeScript engine word for word (pinned by the golden fixtures).
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .chords import NOTE_MAP, QUALITY_DISPLAY, ParsedChord
from .keys import KEYS

MAJOR_NUMERALS = ["I", "bII", "II", "bIII", "III", "IV", "#IV", "V", "bVI", "VI", "bVII", "VII"]
MINOR_NUMERALS = ["I", "bII", "II", "III", "#III", "IV", "#IV", "V", "VI", "#VI", "VII", "#VII"]

FAMILY: dict[str, str] = {
    "maj": "maj", "maj7": "maj", "6": "maj", "add9": "maj", "7": "maj", "9": "maj",
    "maj9": "maj", "11": "maj", "13": "maj", "7b9": "maj", "7#9": "maj",
    "m": "min", "m7": "min", "m6": "min", "m9": "min", "mmaj7": "min", "m11": "min",
    "dim": "dim", "dim7": "dim", "m7b5": "dim",
    "aug": "aug",
    "sus2": "sus", "sus4": "sus", "7sus4": "sus",
}

DOMINANT_QUALITIES = {"7", "9", "11", "13", "7b9", "7#9"}

_KEY_RE = re.compile(r"^([A-G][#b]?) (Major|Minor)$")


@dataclass
class ProgressionAnalysis:
    romans: list[str]
    summary: str

    def to_dict(self) -> dict:
        return {"romans": self.romans, "summary": self.summary}


def _fam(c: ParsedChord) -> str:
    return FAMILY.get(c.quality, "maj")


def _pc(c: ParsedChord) -> int:
    return NOTE_MAP[c.root] % 12


def _roman_for(chord: ParsedChord, tonic_pc: int, is_minor: bool) -> str:
    off = (_pc(chord) - tonic_pc) % 12
    base = (MINOR_NUMERALS if is_minor else MAJOR_NUMERALS)[off]
    fam = _fam(chord)
    if fam in ("min", "dim"):
        base = base.lower()
    suffix = QUALITY_DISPLAY.get(chord.quality, "")
    if fam == "min":
        suffix = re.sub(r"^m", "", suffix)
    return base + suffix


def _playable(c: ParsedChord) -> bool:
    return len(c.notes) > 0 and c.root in NOTE_MAP


def analyze_progression(
    chords: list[ParsedChord], key_name: str, pattern_name: str | None = None
) -> ProgressionAnalysis:
    key_match = _KEY_RE.match(key_name)
    playable = [c for c in chords if _playable(c)]
    if not key_match or len(playable) < 2:
        return ProgressionAnalysis(romans=[], summary="Add at least two chords to see an analysis.")

    tonic_pc = NOTE_MAP[key_match.group(1)] % 12
    is_minor = key_match.group(2) == "Minor"

    def off(c: ParsedChord) -> int:
        return (_pc(c) - tonic_pc) % 12

    def roman(c: ParsedChord) -> str:
        return _roman_for(c, tonic_pc, is_minor)

    romans = [roman(c) if _playable(c) else "—" for c in chords]

    pool = []
    for sym in KEYS.get(key_name, []):
        m = re.match(r"^([A-G][#b]?)(.*)$", sym)
        assert m
        fam = "dim" if m.group(2) == "dim" else "min" if m.group(2) == "m" else "maj"
        pool.append((NOTE_MAP[m.group(1)] % 12, fam))

    def is_diatonic(c: ParsedChord) -> bool:
        fam = _fam(c)
        if fam == "sus":
            return any(pc == _pc(c) for pc, _ in pool)
        return any(pc == _pc(c) and pf == fam for pc, pf in pool)

    sentences: list[str] = []
    playable_romans = [roman(c) for c in playable]
    sentences.append(
        f"{' – '.join(playable_romans)} — a {len(playable)}-chord "
        f"{'minor' if is_minor else 'major'}-key progression in {key_name}"
        + (f", built on the {pattern_name} family." if pattern_name else ".")
    )

    # ── Cadence: how the final pair lands ───────────────────────────────────
    last, prev = playable[-1], playable[-2]
    tonic_word = "i" if is_minor else "I"
    if off(last) == 0:
        if off(prev) == 7 and _fam(prev) not in ("min", "dim"):
            cadence = f"Closes with an authentic cadence (V→{tonic_word}) — the strongest possible resolution."
        elif off(prev) == 5 and _fam(prev) == "maj":
            cadence = 'Closes with a plagal ("amen") cadence — a soft, gospel-tinged landing.'
        elif off(prev) == 5 and _fam(prev) == "min" and not is_minor:
            cadence = "Closes iv→I — the minor-plagal cadence, bittersweet and cinematic."
        elif off(prev) == 10:
            cadence = "Closes bVII→" + tonic_word + " — a modal, backdoor-flavoured resolution."
        else:
            cadence = "Ends home on the tonic."
    elif off(last) == 7 and _fam(last) != "min":
        cadence = "Ends on V — a half cadence that leaves the loop hungry to start over."
    elif off(prev) == 7 and _fam(prev) != "min" and off(last) in (8, 9):
        cadence = (
            f"A deceptive cadence (V→{playable_romans[-1]}) — resolution promised, then sidestepped."
        )
    else:
        cadence = f"Ends away from home on {playable_romans[-1]} — open-ended, made to loop."
    sentences.append(cadence)

    # ── Colour: name the chromatic devices ───────────────────────────────────
    colour: list[str] = []
    covered: set[int] = set()

    if not is_minor:
        for i in range(len(playable) - 1):
            a, b = playable[i], playable[i + 1]
            if off(a) == 5 and off(b) == 5 and _fam(a) == "maj" and _fam(b) == "min":
                colour.append(f'The {a.symbol}→{b.symbol} move is the IV→iv fade — pop\'s "saddest move".')
                covered.add(i + 1)

    if is_minor:
        for i in range(len(playable) - 3):
            if all(off(playable[i + j]) == o for j, o in enumerate([0, 10, 8, 7])):
                colour.append("Features the Andalusian cadence (i–VII–VI–V) — flamenco's four-step descent.")
                break

    mentioned: set[str] = set()
    for i, c in enumerate(playable):
        if is_diatonic(c) or i in covered or c.symbol in mentioned:
            continue
        mentioned.add(c.symbol)
        o = off(c)
        fam = _fam(c)
        nxt = playable[(i + 1) % len(playable)]

        if c.quality in DOMINANT_QUALITIES and o != 7 and (_pc(c) - _pc(nxt)) % 12 == 7:
            colour.append(
                f"{c.symbol} is a secondary dominant (V7 of {nxt.symbol}) — a borrowed pull toward {nxt.symbol}."
            )
        elif o == 1:
            colour.append(f"{c.symbol} is the Phrygian bII — instant menace, one semitone above home.")
        elif is_minor and o == 7 and fam != "min":
            colour.append(f"{c.symbol} is the harmonic-minor V — the classical dominant pulling back to i.")
        elif not is_minor and o == 5 and fam == "min":
            colour.append(
                f'{c.symbol} is the borrowed iv — pop\'s "saddest move", on loan from {key_match.group(1)} minor.'
            )
        elif not is_minor and o == 10 and fam == "maj":
            colour.append(f"{c.symbol} is the Mixolydian bVII — a rock lift borrowed from the parallel minor.")
        elif not is_minor and o == 8 and fam == "maj":
            colour.append(f"{c.symbol} is a borrowed bVI — epic, trailer-sized colour from the parallel minor.")
        elif not is_minor and o == 3 and fam == "maj":
            colour.append(f"{c.symbol} is a chromatic-mediant bIII — a cinematic sidestep.")
        else:
            colour.append(f"{c.symbol} ({roman(c)}) sits outside the key — chromatic colour.")

    if colour:
        sentences.extend(colour)
    else:
        sentences.append(f"Every chord is diatonic to {key_name} — a clean, stable palette.")

    return ProgressionAnalysis(romans=romans, summary=" ".join(sentences))
