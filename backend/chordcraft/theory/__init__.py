"""ChordCraft theory engine — Python port of lib/theory (pinned by fixtures/theory.json)."""

from .analysis import ProgressionAnalysis, analyze_progression
from .chords import (
    NOTE_MAP,
    QUALITY_DISPLAY,
    QUALITY_INTERVALS,
    QUALITY_SUFFIX,
    ChordParseError,
    ParsedChord,
    detect_chord,
    parse_chord,
    parse_chord_strict,
    parse_chords,
)
from .keys import KEY_NAMES, KEYS
from .transpose import key_prefers_flats, transpose_key_name, transpose_progression
from .voicing import voice_lead_progression

__all__ = [
    "KEYS", "KEY_NAMES", "NOTE_MAP", "QUALITY_DISPLAY", "QUALITY_INTERVALS", "QUALITY_SUFFIX",
    "ChordParseError", "ParsedChord", "ProgressionAnalysis",
    "analyze_progression", "detect_chord", "key_prefers_flats", "parse_chord", "parse_chord_strict",
    "parse_chords", "transpose_key_name", "transpose_progression", "voice_lead_progression",
]
