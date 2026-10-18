"""Mood harmony engine — port of lib/theory/harmony.ts + progressions.ts.

Curated, research-grounded progression pools per mood, cycled to length with
role-equivalent variation, style-coherent extensions, and mood tempo/timbre.
In the AI rebuild this is the baseline the trained chord model must beat and
the labeler for mood-tagged training data. Pass ``rng`` for reproducibility.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field, replace

from .chords import NOTE_MAP, QUALITY_SUFFIX, ParsedChord, parse_chords
from .keys import KEYS
from .voicing import voice_lead_progression

MOOD_LABELS: dict[str, str] = {
    "uplifting": "Uplifting",
    "melancholic": "Melancholic",
    "dreamy": "Dreamy",
    "romantic": "Romantic",
    "nostalgic": "Nostalgic",
    "tense": "Tense",
    "jazz": "Jazz",
    "epic": "Epic / Cinematic",
    "aggressive": "Aggressive",
}
MOODS = list(MOOD_LABELS)

Spec = tuple[int, str]  # (semitone offset from tonic, quality)


def M(off: int) -> Spec:  # noqa: N802
    return (off, "maj")


def m(off: int) -> Spec:
    return (off, "m")


def D7(off: int) -> Spec:  # noqa: N802
    return (off, "7")


def dim(off: int) -> Spec:
    return (off, "dim")


@dataclass
class Pattern:
    specs: list[Spec]
    w: int
    name: str
    beats: list[float] | None = None


@dataclass
class MoodProfile:
    major: list[Pattern]
    minor: list[Pattern]
    extend_prob: float
    extend: dict[str, list[str]]
    bpm: tuple[int, int]
    instruments: list[str]
    rhythm: list[float]
    roll_ms: int


P = Pattern

PROFILES: dict[str, MoodProfile] = {
    "uplifting": MoodProfile(
        major=[
            P([M(0), M(7), m(9), M(5)], 5, "Axis (I–V–vi–IV)"),
            P([M(5), M(7), m(9), M(0)], 3, "Hopscotch (IV–V–vi–I)"),
            P([M(0), M(5), M(7), M(5)], 2, "Rock & roll (I–IV–V–IV)"),
            P([M(0), M(10), M(5), M(0)], 2, "Mixolydian lift (I–bVII–IV–I)"),
            P([M(0), M(5), m(9), M(7)], 2, "Pop cycle (I–IV–vi–V)"),
            P([M(0), m(4), M(5), M(7)], 1, "Puff (I–iii–IV–V)"),
        ],
        minor=[
            P([m(0), M(3), M(10), M(8)], 3, "EDM euphoria (i–III–VII–VI)"),
            P([m(0), M(8), M(3), M(10)], 3, "Rising anthem (i–VI–III–VII)"),
            P([m(0), M(10), M(8), M(10)], 1, "Rock climb (i–VII–VI–VII)"),
        ],
        extend_prob=0.3,
        extend={"tonic": ["add9"], "maj": ["add9", "sus2"], "dom": ["7"]},
        bpm=(100, 140), instruments=["Piano", "Guitar"], rhythm=[4], roll_ms=15,
    ),
    "melancholic": MoodProfile(
        major=[
            P([m(9), M(5), M(0), M(7)], 4, "Sad-pop loop (vi–IV–I–V)"),
            P([M(0), M(7), m(9), M(5)], 2, "Axis, minor-weighted"),
            P([M(0), M(5), m(5), M(0)], 3, "The saddest move (I–IV–iv–I)"),
            P([M(0), M(4), m(9), M(5)], 1, "Mediant ache (I–III–vi–IV)"),
        ],
        minor=[
            P([m(0), M(10), M(8), M(7)], 4, "Andalusian (i–VII–VI–V)"),
            P([m(0), M(8), M(3), M(10)], 3, "Minor axis, slow"),
            P([m(0), m(5), M(8), M(7)], 2, "Lament (i–iv–VI–V)"),
            P([m(0), M(10), M(8), M(10)], 2, "Rock lament (i–VII–VI–VII)"),
            P([m(0), (0, "mmaj7"), (0, "m7"), (0, "m6")], 2, "Line cliché (i–i△7–i7–i6)"),
            P([m(0), m(5), m(7), m(0)], 2, "Trapped (i–iv–v–i)"),
        ],
        extend_prob=0.5,
        extend={"tonic": ["maj7"], "maj": ["maj7"], "min": ["m7", "m9"], "dom": ["7"]},
        bpm=(50, 80), instruments=["Piano", "Strings"], rhythm=[4], roll_ms=35,
    ),
    "dreamy": MoodProfile(
        major=[
            P([M(0), M(2), M(5), M(0)], 3, "Lydian float (I–II–IV–I)"),
            P([M(0), M(5), M(0), M(5)], 3, "Plagal drift (I–IV)", [8, 8, 8, 8]),
            P([M(0), M(5), m(9), M(5)], 2, "Shimmer cycle (I–IV–vi–IV)"),
            P([M(0), M(10), M(5), M(0)], 2, "Mixolydian haze (I–bVII–IV–I)"),
            P([M(0), m(4), M(5), M(0)], 1, "Gentle mediant (I–iii–IV–I)"),
        ],
        minor=[
            P([m(0), M(5), m(0), M(5)], 3, "Dorian float (i–IV)"),
            P([m(0), M(3), M(10), M(5)], 2, "Dark shimmer (i–III–VII–IV)"),
            P([m(0), M(3), M(8), M(3)], 2, "Cloud mediants (i–III–VI–III)"),
        ],
        extend_prob=0.75,
        extend={"tonic": ["maj7", "add9"], "maj": ["maj7", "sus2", "add9"], "min": ["m7", "m9"]},
        bpm=(55, 90), instruments=["Electric Piano", "Pad"], rhythm=[8], roll_ms=55,
    ),
    "romantic": MoodProfile(
        major=[
            P([M(0), m(9), m(2), M(7)], 4, "Standards turnaround (I–vi–ii–V)"),
            P([m(9), M(5), M(0), M(7)], 3, "Yearning loop (vi–IV–I–V)"),
            P([M(0), m(4), m(9), M(5)], 3, "Falling-in-love arc (I–iii–vi–IV)"),
            P([M(0), M(5), m(2), M(7)], 2, "Love-struck (I–IV–ii–V)"),
            P([M(5), M(7), m(4), m(9)], 2, "Royal road (IV–V–iii–vi)"),
            P([M(0), D7(4), m(9), M(5)], 2, "Dramatic mediant (I–III7–vi–IV)"),
            P([m(2), M(7), M(0), m(9)], 2, "Circle (ii–V–I–vi)"),
            P([M(0), M(7), m(9), m(4), M(5), M(0), M(5), M(7)], 3, "Pachelbel sequence",
              [2, 2, 2, 2, 2, 2, 2, 2]),
        ],
        minor=[
            P([m(0), m(5), M(10), M(3)], 3, "Minor circle (i–iv–VII–III)"),
            P([m(0), M(8), m(2), D7(7)], 2, "Torch song (i–VI–ii–V7)"),
        ],
        extend_prob=0.65,
        extend={"tonic": ["maj7", "6"], "maj": ["maj7"], "min": ["m7"], "dom": ["7", "9", "7sus4"]},
        bpm=(58, 96), instruments=["Piano", "Strings"], rhythm=[4], roll_ms=40,
    ),
    "nostalgic": MoodProfile(
        major=[
            P([M(0), m(9), M(5), M(7)], 5, "Doo-wop (I–vi–IV–V)"),
            P([M(0), m(9), m(2), M(7)], 3, "Blue Moon (I–vi–ii–V)"),
            P([M(0), M(5), m(5), M(0)], 2, "Sepia fade (I–IV–iv–I)"),
            P([M(0), D7(4), M(5), m(5)], 1, "Vintage mediant (I–III7–IV–iv)"),
            P([D7(9), D7(2), D7(7), M(0)], 2, "Ragtime circle (VI7–II7–V7–I)", [4, 4, 4, 4]),
        ],
        minor=[P([m(0), M(8), m(5), M(7)], 2, "Old-ballroom (i–VI–iv–V)")],
        extend_prob=0.6,
        extend={"tonic": ["6", "maj7"], "maj": ["6", "maj7"], "min": ["m6", "m7"], "dom": ["7"]},
        bpm=(65, 100), instruments=["Piano", "Electric Piano"], rhythm=[2], roll_ms=30,
    ),
    "tense": MoodProfile(
        major=[
            P([M(0), M(8), M(0), M(8)], 3, "Chromatic mediant creep (I–bVI)"),
            P([M(0), m(5), M(0), M(10)], 2, "Modal unease (I–iv–I–bVII)"),
            P([M(0), dim(11), M(0), dim(11)], 1, "Leading-tone stab (I–vii°)"),
        ],
        minor=[
            P([m(0), M(1), m(0), M(1)], 4, "Phrygian (i–bII)"),
            P([m(0), dim(2), D7(7), m(0)], 3, "Noir cadence (i–ii°–V7–i)"),
            P([m(0), m(5), dim(2), D7(7)], 2, "Creeping circle (i–iv–ii°–V7)"),
            P([(0, "mmaj7"), m(5), (0, "mmaj7"), M(1)], 2, "Hitchcock vamp (i△7)", [8, 4, 8, 4]),
            P([(11, "dim7"), (2, "dim7"), (11, "dim7"), (2, "dim7")], 1, "Psycho drift (°7–°7)"),
            P([m(0), (0, "aug"), m(0), M(1)], 1, "Augmented crawl"),
        ],
        extend_prob=0.4,
        extend={"min": ["m9"], "dom": ["7"], "maj": ["sus2"]},
        bpm=(55, 120), instruments=["Strings", "Pad"], rhythm=[4], roll_ms=10,
    ),
    "jazz": MoodProfile(
        major=[
            P([m(2), M(7), M(0), m(9)], 4, "ii–V–I–vi", [2, 2, 4, 4]),
            P([M(0), m(9), m(2), M(7)], 3, "Rhythm turnaround (I–vi–ii–V)"),
            P([m(4), m(9), m(2), M(7)], 3, "Ladder (iii–vi–ii–V)"),
            P([M(0), D7(9), m(2), D7(7)], 2, "Secondary dominant (I–VI7–ii–V7)"),
            P([m(2), D7(1), M(0), M(0)], 2, "Tritone sub (ii–bII7–I)"),
            P([M(0), m(5), D7(10), M(0)], 2, "Backdoor (I–iv–bVII7–I)"),
            P([D7(0), D7(5), D7(0), D7(7)], 2, "Jazz blues (I7–IV7–I7–V7)", [4, 4, 4, 4]),
        ],
        minor=[
            P([dim(2), D7(7), m(0), m(0)], 4, "Minor ii°–V–i", [2, 2, 4, 4]),
            P([m(0), m(5), M(10), M(3)], 3, "Autumn circle (i–iv–VII–III)"),
            P([m(0), M(8), dim(2), D7(7)], 2, "Torch turnaround (i–VI–ii°–V7)"),
        ],
        extend_prob=0.95,
        extend={"tonic": ["maj7", "6"], "maj": ["maj7"], "min": ["m7", "m9"], "dom": ["7", "9", "7sus4"]},
        bpm=(70, 135), instruments=["Electric Piano", "Piano"], rhythm=[2], roll_ms=25,
    ),
    "epic": MoodProfile(
        major=[
            P([M(8), M(10), M(0), M(0)], 3, "Mario cadence (bVI–bVII–I)"),
            P([M(0), M(10), M(8), M(10)], 2, "Power float (I–bVII–bVI–bVII)"),
            P([M(0), M(7), m(9), M(5)], 2, "Anthem axis"),
            P([M(0), M(8), M(0), M(10)], 1, "Trailer mediants (I–bVI–I–bVII)"),
        ],
        minor=[
            P([m(0), M(8), M(3), M(10)], 5, "Minor axis (i–VI–III–VII)"),
            P([m(0), m(7), M(10), M(5)], 3, "Dorian vamp (i–v–VII–IV)"),
            P([m(0), M(10), M(8), M(10)], 3, "Battle loop (i–VII–VI–VII)"),
            P([M(8), M(3), m(5), m(0)], 2, "Adventure (VI–III–iv–i)"),
            P([m(0), M(8), M(10), m(0)], 2, "March (i–VI–VII–i)"),
            P([m(0), m(5), M(8), M(10)], 2, "Siege (i–iv–VI–VII)"),
        ],
        extend_prob=0.2,
        extend={"maj": ["sus4", "add9"], "min": ["m7"], "dom": ["sus4"]},
        bpm=(95, 145), instruments=["Strings", "Brass"], rhythm=[4], roll_ms=20,
    ),
    "aggressive": MoodProfile(
        major=[
            P([M(0), M(10), M(5), M(0)], 3, "Rock slam (I–bVII–IV–I)"),
            P([M(0), M(3), M(5), M(0)], 2, "Hard mediant (I–bIII–IV–I)"),
            P([M(0), M(5), M(7), M(0)], 2, "Punk (I–IV–V–I)"),
        ],
        minor=[
            P([m(0), M(1), m(0), M(1)], 4, "Phrygian slam (i–bII)"),
            P([m(0), M(8), M(10), m(0)], 3, "Metal loop (i–VI–VII–i)"),
            P([m(0), M(10), M(8), M(1)], 2, "Phrygian descent (i–VII–VI–bII)"),
            P([m(0), M(10), m(0), M(10)], 2, "Drive (i–VII)"),
            P([m(0), m(5), m(0), M(7)], 1, "Minor punk (i–iv–i–V)"),
        ],
        extend_prob=0.05,
        extend={"dom": ["7"]},
        bpm=(140, 200), instruments=["Guitar", "Organ"], rhythm=[2], roll_ms=0,
    ),
}

SUBS_MAJOR: list[list[Spec]] = [[M(0), m(9), m(4)], [M(5), m(2)], [M(7), M(10)]]
SUBS_MINOR: list[list[Spec]] = [[m(0), M(8), M(3)], [m(5), M(8)], [M(7), M(10), D7(7)]]

SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
FLAT_DEGREE_OFFSETS = {1, 3, 6, 8, 10}
FLAT_MINOR_KEYS = {"F Major", "D Minor", "G Minor", "C Minor", "F Minor"}

ROMAN_MAJOR = {0: "I", 1: "bII", 2: "II", 3: "bIII", 4: "III", 5: "IV",
               6: "bV", 7: "V", 8: "bVI", 9: "VI", 10: "bVII", 11: "VII"}
ROMAN_MINOR = {0: "I", 1: "bII", 2: "II", 3: "III", 4: "#III", 5: "IV",
               6: "bV", 7: "V", 8: "VI", 9: "#VI", 10: "VII", 11: "#VII"}
ROMAN_TAIL = {"dim": "°", "dim7": "°7", "aug": "+", "7": "7", "maj7": "Δ7", "m7": "7", "m9": "9",
              "sus2": "sus2", "sus4": "sus4", "6": "6", "m6": "6", "add9": "add9", "9": "9",
              "7sus4": "7sus4", "mmaj7": "Δ7"}
MINORISH = {"m", "m7", "m6", "m9", "mmaj7", "dim", "dim7"}


def _speller(key: str):
    diatonic: dict[int, str] = {}
    for sym in KEYS.get(key, []):
        root = sym[:2] if len(sym) > 1 and sym[1] in "#b" else sym[0]
        if root in NOTE_MAP:
            diatonic[NOTE_MAP[root] % 12] = root
    flat_key = "b" in key or key in FLAT_MINOR_KEYS

    def spell(pc: int, off: int) -> str:
        if pc % 12 in diatonic:
            return diatonic[pc % 12]
        if off % 12 in FLAT_DEGREE_OFFSETS:
            return FLAT_NAMES[pc % 12]
        return (FLAT_NAMES if flat_key else SHARP_NAMES)[pc % 12]

    return spell


def spell_degrees(key: str, degrees: list[Spec]) -> list[str]:
    """Spell key-relative (semitone offset, quality) pairs as chord symbols in ``key``."""
    tonic = key.split(" ")[0]
    if tonic not in NOTE_MAP:
        raise ValueError(f'Unknown key: "{key}"')
    spell = _speller(key)
    return [spell(NOTE_MAP[tonic] + off, off) + QUALITY_SUFFIX[q] for off, q in degrees]


def _roman(spec: Spec, minor_key: bool) -> str:
    off, q = spec
    base = (ROMAN_MINOR if minor_key else ROMAN_MAJOR).get(off, "?")
    return (base.lower() if q in MINORISH else base) + ROMAN_TAIL.get(q, "")


def _weighted_pick(rng: random.Random, items: list[Pattern]) -> Pattern:
    return rng.choices(items, weights=[it.w for it in items], k=1)[0]


@dataclass
class MoodResult:
    symbols: list[str]
    romans: list[str]
    pattern_name: str
    bpm: int
    instrument: str
    beats: list[float]
    roll_ms: int
    mood: str = ""
    extra: dict = field(default_factory=dict)


def generate_mood_progression(
    key: str,
    mood: str,
    length: int,
    exclude_diminished: bool = False,
    rng: random.Random | None = None,
) -> MoodResult:
    rng = rng or random.Random()
    if mood not in PROFILES:
        raise ValueError(f'Unknown mood: "{mood}"')
    minor_key = "minor" in key.lower()
    tonic_name = key.split(" ")[0]
    if tonic_name not in NOTE_MAP:
        raise ValueError(f'Unknown key: "{key}"')
    tonic_pc = NOTE_MAP[tonic_name]

    profile = PROFILES[mood]
    safe_len = max(2, min(16, length))

    pool = profile.minor if minor_key else profile.major
    if exclude_diminished:
        no_dim = [p for p in pool if not any(q in ("dim", "dim7") for _, q in p.specs)]
        if no_dim:
            pool = no_dim
    pattern = _weighted_pick(rng, pool)

    # Cycle to length; vary repeat passes with role-equivalent substitutes
    # (never the first slot of a pass or the final chord, never adjacent repeats).
    subs = SUBS_MINOR if minor_key else SUBS_MAJOR
    n = len(pattern.specs)
    specs: list[Spec] = []
    for i in range(safe_len):
        base = pattern.specs[i % n]
        spec = base
        if i // n > 0 and i % n != 0 and i != safe_len - 1 and rng.random() < 0.25:
            family = next((f for f in subs if base in f), None)
            if family:
                prev = specs[i - 1] if i > 0 else None
                nxt = pattern.specs[(i + 1) % n]
                alts = [
                    s for s in family
                    if s != base
                    and not (exclude_diminished and s[1] in ("dim", "dim7"))
                    and not (prev and s[0] == prev[0])
                    and not (nxt and s[0] == nxt[0])
                ]
                if alts:
                    spec = rng.choice(alts)
        specs.append(spec)

    # Style-coherent extensions: one decision per distinct (off, q), reused.
    qualities_per_off: dict[int, set[str]] = {}
    for off, q in pattern.specs:
        qualities_per_off.setdefault(off, set()).add(q)
    locked = {off for off, qs in qualities_per_off.items() if len(qs) > 1}

    decided: dict[Spec, str] = {}
    for idx, (off, q0) in enumerate(specs):
        if off in locked:
            continue
        if (off, q0) in decided:
            specs[idx] = (off, decided[(off, q0)])
            continue
        q = q0
        if rng.random() < profile.extend_prob:
            ext = profile.extend
            is_dom = off == 7 and q0 == "maj"
            borrowed_dom = q0 == "maj" and ((not minor_key and off == 4) or (minor_key and off == 5))
            if borrowed_dom:
                q = "7" if rng.random() < 0.5 else q0
            elif is_dom and ext.get("dom"):
                q = rng.choice(ext["dom"])
            elif q0 == "maj" and off == 0 and ext.get("tonic"):
                q = rng.choice(ext["tonic"])
            elif q0 == "maj" and ext.get("maj"):
                q = rng.choice(ext["maj"])
            elif q0 == "m" and ext.get("min"):
                q = rng.choice(ext["min"])
            elif q0 == "dim" and mood in ("jazz", "tense"):
                q = "dim7"
        decided[(off, q0)] = q
        specs[idx] = (off, q)

    spell = _speller(key)
    symbols = [spell(tonic_pc + off, off) + QUALITY_SUFFIX[q] for off, q in specs]
    romans = [_roman(s, minor_key) for s in specs]
    rhythm = pattern.beats or profile.rhythm
    beats = [rhythm[i % len(rhythm)] for i in range(len(specs))]
    lo, hi = profile.bpm

    return MoodResult(
        symbols=symbols,
        romans=romans,
        pattern_name=pattern.name,
        bpm=round(lo + rng.random() * (hi - lo)),
        instrument=rng.choice(profile.instruments),
        beats=beats,
        roll_ms=profile.roll_ms,
        mood=mood,
    )


def apply_secondary_dominants(symbols: list[str], rng: random.Random | None = None) -> list[str]:
    """Swap one chord for the V7 of the chord after it (never the opening chord)."""
    rng = rng or random.Random()
    out = list(symbols)
    candidates = [i for i in range(2, len(out)) if "dim" not in out[i]]
    if not candidates:
        return out
    target = rng.choice(candidates)
    letter = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}.get(out[target][:1].upper())
    if letter is None:
        return out
    acc = out[target][1:2]
    pc = (letter + (1 if acc == "#" else -1 if acc == "b" else 0)) % 12
    out[target - 1] = f"{SHARP_NAMES[(pc + 7) % 12]}7"
    return out


@dataclass
class SmartResult:
    chords: list[ParsedChord]
    romans: list[str]
    pattern_name: str
    bpm: int
    instrument: str
    roll_ms: int
    mood: str


def generate_smart(
    key: str,
    mood: str,
    length: int,
    exclude_diminished: bool = False,
    chromatic_color: bool = False,
    rng: random.Random | None = None,
) -> SmartResult:
    """Mood progression → optional secondary dominant → parsed, timed, voice-led chords."""
    rng = rng or random.Random()
    r = generate_mood_progression(key, mood, length, exclude_diminished, rng)
    symbols = apply_secondary_dominants(r.symbols, rng) if chromatic_color else r.symbols
    parsed = [replace(c, beats=r.beats[i]) for i, c in enumerate(parse_chords(symbols))]
    romans = r.romans
    if symbols != r.symbols:
        # A secondary dominant replaced a chord, so the pattern's numerals no longer fit.
        from .analysis import analyze_progression

        romans = analyze_progression(parsed, key).romans
    return SmartResult(
        chords=voice_lead_progression(parsed),
        romans=romans,
        pattern_name=r.pattern_name,
        bpm=r.bpm,
        instrument=r.instrument,
        roll_ms=r.roll_ms,
        mood=mood,
    )
