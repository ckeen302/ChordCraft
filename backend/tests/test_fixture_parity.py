"""The Python theory engine must reproduce the TypeScript engine exactly.

fixtures/theory.json is generated from lib/theory by `npm run fixtures`.
"""

import json
from pathlib import Path

import pytest

from chordcraft.theory import (
    KEYS,
    NOTE_MAP,
    QUALITY_DISPLAY,
    QUALITY_INTERVALS,
    QUALITY_SUFFIX,
    ChordParseError,
    analyze_progression,
    detect_chord,
    key_prefers_flats,
    parse_chord,
    transpose_key_name,
    transpose_progression,
    voice_lead_progression,
)

FIXTURES = json.loads((Path(__file__).parents[2] / "fixtures" / "theory.json").read_text())


def outcome(symbol: str, strict: bool) -> dict:
    try:
        return {"ok": True, "chord": parse_chord(symbol, strict=strict).to_dict()}
    except ChordParseError as e:
        return {"ok": False, "error": str(e)}


def test_tables_match():
    t = FIXTURES["tables"]
    assert t["noteMap"] == NOTE_MAP
    assert t["qualityIntervals"] == QUALITY_INTERVALS
    assert t["qualityDisplay"] == QUALITY_DISPLAY
    assert t["qualitySuffix"] == QUALITY_SUFFIX
    assert t["keys"] == KEYS


@pytest.mark.parametrize("case", FIXTURES["parse"], ids=lambda c: repr(c["symbol"]))
def test_parse(case):
    assert outcome(case["symbol"], strict=False) == case["lenient"]
    assert outcome(case["symbol"], strict=True) == case["strict"]


@pytest.mark.parametrize("case", FIXTURES["detect"], ids=lambda c: str(c["notes"]))
def test_detect(case):
    assert detect_chord(case["notes"]).to_dict() == case["chord"]


@pytest.mark.parametrize("case", FIXTURES["voiceLead"], ids=lambda c: "-".join(c["symbols"]))
def test_voice_lead(case):
    voiced = voice_lead_progression([parse_chord(s) for s in case["symbols"]])
    assert [c.notes for c in voiced] == case["notes"]


def test_key_prefers_flats():
    for case in FIXTURES["keyPrefersFlats"]:
        assert key_prefers_flats(case["key"]) == case["flats"], case["key"]


def test_transpose_key_name():
    for case in FIXTURES["transposeKeyName"]:
        assert transpose_key_name(case["key"], case["semitones"]) == case["result"], case


@pytest.mark.parametrize(
    "case",
    FIXTURES["transposeProgression"],
    ids=lambda c: f"{'-'.join(c['symbols'])}@{c['semitones']}{'b' if c['preferFlats'] else '#'}",
)
def test_transpose_progression(case):
    chords = [parse_chord(s) for s in case["symbols"]]
    out = transpose_progression(chords, case["semitones"], case["preferFlats"])
    assert [c.to_dict() for c in out] == case["result"]


@pytest.mark.parametrize("case", FIXTURES["analyze"], ids=lambda c: f"{'-'.join(c['symbols'])}|{c['key']}")
def test_analyze(case):
    result = analyze_progression([parse_chord(s) for s in case["symbols"]], case["key"])
    assert result.to_dict() == case["result"]
