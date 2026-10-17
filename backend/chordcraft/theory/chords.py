"""Chord parsing and detection — Python port of lib/theory/chords.ts.

Behaviour is pinned to the TypeScript engine by fixtures/theory.json; change
both together and regenerate the fixtures with `npm run fixtures`.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

NOTE_MAP: dict[str, int] = {
    "C": 60, "B#": 60,
    "C#": 61, "Db": 61,
    "D": 62,
    "D#": 63, "Eb": 63,
    "E": 64, "Fb": 64,
    "F": 65, "E#": 65,
    "F#": 66, "Gb": 66,
    "G": 67,
    "G#": 68, "Ab": 68,
    "A": 69,
    "A#": 70, "Bb": 70,
    "B": 71, "Cb": 71,
}

QUALITY_INTERVALS: dict[str, list[int]] = {
    "maj": [0, 4, 7],
    "m": [0, 3, 7],
    "dim": [0, 3, 6],
    "aug": [0, 4, 8],
    "7": [0, 4, 7, 10],
    "maj7": [0, 4, 7, 11],
    "m7": [0, 3, 7, 10],
    "dim7": [0, 3, 6, 9],
    "sus2": [0, 2, 7],
    "sus4": [0, 5, 7],
    "6": [0, 4, 7, 9],
    "m6": [0, 3, 7, 9],
    "7sus4": [0, 5, 7, 10],
    "add9": [0, 4, 7, 14],
    "9": [0, 4, 7, 10, 14],
    "m9": [0, 3, 7, 10, 14],
    "mmaj7": [0, 3, 7, 11],
    "maj9": [0, 4, 7, 11, 14],
    "m7b5": [0, 3, 6, 10],
    "11": [0, 4, 7, 10, 14, 17],
    "m11": [0, 3, 7, 10, 14, 17],
    "13": [0, 4, 7, 10, 14, 21],
    "7b9": [0, 4, 7, 10, 13],
    "7#9": [0, 4, 7, 10, 15],
    "5": [0, 7, 12],  # power chord: root, fifth, octave (no third)
}

QUALITY_DISPLAY: dict[str, str] = {
    "maj": "", "m": "m", "dim": "°", "aug": "+",
    "7": "7", "maj7": "Δ7", "m7": "m7", "dim7": "°7",
    "sus2": "sus2", "sus4": "sus4", "6": "6", "m6": "m6",
    "7sus4": "7sus4", "add9": "add9", "9": "9", "m9": "m9", "mmaj7": "mΔ7",
    "maj9": "Δ9", "m7b5": "ø7", "11": "11", "m11": "m11", "13": "13",
    "7b9": "7♭9", "7#9": "7♯9", "5": "5",
}

QUALITY_SUFFIX: dict[str, str] = {
    "maj": "", "m": "m", "dim": "dim", "aug": "aug",
    "7": "7", "maj7": "maj7", "m7": "m7", "dim7": "dim7",
    "sus2": "sus2", "sus4": "sus4", "6": "6", "m6": "m6",
    "7sus4": "7sus4", "add9": "add9", "9": "9", "m9": "m9", "mmaj7": "mmaj7",
    "maj9": "maj9", "m7b5": "m7b5", "11": "11", "m11": "m11", "13": "13",
    "7b9": "7b9", "7#9": "7#9", "5": "5",
}

# Exact alternative spellings — accepted by strict parsing.
ALIASES: dict[str, str] = {
    "": "maj", "M": "maj", "major": "maj",
    "-": "m", "min": "m", "minor": "m",
    "+": "aug",
    "M7": "maj7", "Maj7": "maj7", "ma7": "maj7", "Δ": "maj7", "Δ7": "maj7",
    "min7": "m7", "-7": "m7",
    "dom7": "7",
    "sus": "sus4", "7sus": "7sus4",
    "°": "dim", "o": "dim", "°7": "dim7", "o7": "dim7",
    "mM7": "mmaj7", "minmaj7": "mmaj7", "m(maj7)": "mmaj7",
    "M9": "maj9", "Maj9": "maj9", "Δ9": "maj9",
    "ø": "m7b5", "ø7": "m7b5", "min7b5": "m7b5", "m7-5": "m7b5",
    "min11": "m11", "min9": "m9",
    "add2": "add9",
}

# Lenient fallbacks for uncatalogued suffixes. Order matters: specific
# prefixes first, every maj-prefixed rule before the bare "m" rule.
PREFIX_FALLBACKS: list[tuple[str, str]] = [
    ("mmaj", "mmaj7"), ("mM", "mmaj7"), ("minmaj", "mmaj7"), ("m(maj", "mmaj7"),
    ("maj13", "maj9"), ("maj11", "maj9"), ("maj9", "maj9"), ("M9", "maj9"),
    ("maj7", "maj7"), ("M7", "maj7"), ("Δ", "maj7"), ("maj", "maj"),
    ("m7b5", "m7b5"), ("ø", "m7b5"),
    ("m13", "m11"), ("m11", "m11"), ("min11", "m11"),
    ("m9", "m9"), ("min9", "m9"), ("m7", "m7"), ("min7", "m7"),
    ("m6", "m6"), ("min6", "m6"),
    ("dim7", "dim7"), ("°7", "dim7"), ("dim", "dim"), ("°", "dim"),
    ("aug", "aug"), ("+", "aug"),
    ("add9", "add9"), ("add2", "add9"),
    ("7sus", "7sus4"), ("sus2", "sus2"), ("sus", "sus4"),
    ("13", "13"), ("11", "11"), ("9", "9"),
    ("7b9", "7b9"), ("7#9", "7#9"), ("7", "7"), ("6", "6"),
    ("min", "m"), ("m", "m"),
]

PC_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


@dataclass
class ParsedChord:
    symbol: str
    root: str
    quality: str
    notes: list[int]
    displayQuality: str  # noqa: N815 — mirrors the TypeScript wire format
    beats: float | None = None

    def to_dict(self) -> dict:
        d = asdict(self)
        if d["beats"] is None:
            del d["beats"]
        return d


class ChordParseError(ValueError):
    pass


def _normalize_quality(suffix: str) -> tuple[str, bool]:
    if suffix in ALIASES:
        return ALIASES[suffix], True
    if suffix in QUALITY_INTERVALS:
        return suffix, True
    for prefix, quality in PREFIX_FALLBACKS:
        if suffix.startswith(prefix):
            return quality, False
    return "maj", False


def parse_chord(symbol: str, *, strict: bool = False) -> ParsedChord:
    """Parse a chord symbol. Lenient by default; ``strict`` rejects anything approximated."""
    s = symbol.strip()
    if not s:
        raise ChordParseError("Empty chord symbol")

    bass_midi: int | None = None
    slash = s.find("/")
    if slash > 0:
        bass_name = s[slash + 1 :].strip()
        normalized = bass_name[0].upper() + bass_name[1:] if bass_name else ""
        if normalized in NOTE_MAP:
            bass_midi = NOTE_MAP[normalized] - 12
        elif strict:
            raise ChordParseError(f'Unknown bass note in chord: "{symbol}"')
        s = s[:slash]

    idx = 1
    root = s[0].upper()
    if idx < len(s) and s[idx] in ("#", "b"):
        root += s[idx]
        idx += 1
    if root not in NOTE_MAP:
        raise ChordParseError(f'Unknown root note in chord: "{symbol}"')

    suffix = s[idx:]
    quality, exact = _normalize_quality(suffix)
    if strict and not exact:
        raise ChordParseError(f'Unrecognised chord quality "{suffix}" in chord: "{symbol}"')

    base = NOTE_MAP[root]
    notes = [base + i for i in QUALITY_INTERVALS[quality]]
    if bass_midi is not None and bass_midi not in notes:
        notes.insert(0, bass_midi)

    display = QUALITY_DISPLAY[quality] + (symbol[symbol.index("/") :] if bass_midi is not None else "")
    return ParsedChord(symbol=symbol, root=root, quality=quality, notes=notes, displayQuality=display)


def parse_chord_strict(symbol: str) -> ParsedChord:
    return parse_chord(symbol, strict=True)


def parse_chords(symbols: list[str]) -> list[ParsedChord]:
    """Parse several symbols, skipping any that fail."""
    out = []
    for sym in symbols:
        try:
            out.append(parse_chord(sym))
        except ChordParseError:
            continue
    return out


def detect_chord(notes: list[int]) -> ParsedChord:
    """Name an arbitrary set of MIDI notes (inverse of parse_chord)."""
    sorted_notes = sorted(set(notes))
    if not sorted_notes:
        return ParsedChord(symbol="Rest", root="—", quality="maj", notes=[], displayQuality="rest")

    pcs = list(dict.fromkeys(n % 12 for n in sorted_notes))
    for root_pc in pcs:
        rel = {(pc - root_pc) % 12 for pc in pcs}
        for quality, intervals in QUALITY_INTERVALS.items():
            shape = {i % 12 for i in intervals}
            if rel == shape:
                root = PC_NAMES[root_pc]
                return ParsedChord(
                    symbol=root + QUALITY_SUFFIX[quality],
                    root=root,
                    quality=quality,
                    notes=sorted_notes,
                    displayQuality=QUALITY_DISPLAY[quality],
                )

    root = PC_NAMES[sorted_notes[0] % 12]
    single = len(sorted_notes) == 1
    return ParsedChord(
        symbol=root if single else f"{root}*",
        root=root,
        quality="maj",
        notes=sorted_notes,
        displayQuality="note" if single else "custom",
    )
