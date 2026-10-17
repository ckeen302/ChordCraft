"""Diatonic chord sets for all 24 keys — port of lib/theory/keys.ts."""

KEYS: dict[str, list[str]] = {
    # Major keys
    "C Major": ["C", "Dm", "Em", "F", "G", "Am", "Bdim"],
    "G Major": ["G", "Am", "Bm", "C", "D", "Em", "F#dim"],
    "D Major": ["D", "Em", "F#m", "G", "A", "Bm", "C#dim"],
    "A Major": ["A", "Bm", "C#m", "D", "E", "F#m", "G#dim"],
    "E Major": ["E", "F#m", "G#m", "A", "B", "C#m", "D#dim"],
    "B Major": ["B", "C#m", "D#m", "E", "F#", "G#m", "A#dim"],
    "F# Major": ["F#", "G#m", "A#m", "B", "C#", "D#m", "E#dim"],
    "F Major": ["F", "Gm", "Am", "Bb", "C", "Dm", "Edim"],
    "Bb Major": ["Bb", "Cm", "Dm", "Eb", "F", "Gm", "Adim"],
    "Eb Major": ["Eb", "Fm", "Gm", "Ab", "Bb", "Cm", "Ddim"],
    "Ab Major": ["Ab", "Bbm", "Cm", "Db", "Eb", "Fm", "Gdim"],
    "Db Major": ["Db", "Ebm", "Fm", "Gb", "Ab", "Bbm", "Cdim"],
    # Minor keys
    "A Minor": ["Am", "Bdim", "C", "Dm", "Em", "F", "G"],
    "E Minor": ["Em", "F#dim", "G", "Am", "Bm", "C", "D"],
    "B Minor": ["Bm", "C#dim", "D", "Em", "F#m", "G", "A"],
    "F# Minor": ["F#m", "G#dim", "A", "Bm", "C#m", "D", "E"],
    "C# Minor": ["C#m", "D#dim", "E", "F#m", "G#m", "A", "B"],
    "G# Minor": ["G#m", "A#dim", "B", "C#m", "D#m", "E", "F#"],
    "D Minor": ["Dm", "Edim", "F", "Gm", "Am", "Bb", "C"],
    "G Minor": ["Gm", "Adim", "Bb", "Cm", "Dm", "Eb", "F"],
    "C Minor": ["Cm", "Ddim", "Eb", "Fm", "Gm", "Ab", "Bb"],
    "F Minor": ["Fm", "Gdim", "Ab", "Bbm", "Cm", "Db", "Eb"],
    "Bb Minor": ["Bbm", "Cdim", "Db", "Ebm", "Fm", "Gb", "Ab"],
    "Eb Minor": ["Ebm", "Fdim", "Gb", "Abm", "Bbm", "Cb", "Db"],
}

KEY_NAMES: list[str] = list(KEYS)
