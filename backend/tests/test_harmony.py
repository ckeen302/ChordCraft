import random

import pytest

from chordcraft.theory import KEY_NAMES, parse_chord_strict
from chordcraft.theory.harmony import (
    MOODS,
    PROFILES,
    apply_secondary_dominants,
    generate_mood_progression,
    generate_smart,
)


@pytest.mark.parametrize("mood", MOODS)
def test_every_key_and_length_yields_strict_symbols(mood):
    rng = random.Random(7)
    lo, hi = PROFILES[mood].bpm
    for key in KEY_NAMES:
        for length in range(2, 13):
            r = generate_mood_progression(key, mood, length, exclude_diminished=length % 2 == 0, rng=rng)
            assert len(r.symbols) == len(r.romans) == len(r.beats) == length
            for s in r.symbols:
                parse_chord_strict(s)
            assert all(b > 0 for b in r.beats)
            assert lo <= r.bpm <= hi
            assert r.instrument in PROFILES[mood].instruments


def test_seeded_generation_is_reproducible():
    a = generate_smart("A Minor", "epic", 8, rng=random.Random(42))
    b = generate_smart("A Minor", "epic", 8, rng=random.Random(42))
    assert [c.symbol for c in a.chords] == [c.symbol for c in b.chords]
    assert a.bpm == b.bpm


def test_length_is_clamped():
    assert len(generate_mood_progression("C Major", "jazz", 1).symbols) == 2
    assert len(generate_mood_progression("C Major", "jazz", 99).symbols) == 16


def test_exclude_diminished():
    rng = random.Random(1)
    for _ in range(300):
        r = generate_mood_progression("C Major", "tense", 6, exclude_diminished=True, rng=rng)
        assert not any("dim" in s for s in r.symbols)


def test_unknown_inputs_raise():
    with pytest.raises(ValueError):
        generate_mood_progression("H Major", "jazz", 4)
    with pytest.raises(ValueError):
        generate_mood_progression("C Major", "polka", 4)


def test_secondary_dominant_targets_the_next_chord():
    rng = random.Random(3)
    for _ in range(100):
        out = apply_secondary_dominants(["C", "Am", "F", "G"], rng)
        assert out[0] == "C"
        changed = [i for i, (x, y) in enumerate(zip(out, ["C", "Am", "F", "G"], strict=True)) if x != y]
        assert len(changed) <= 1
        if changed:
            assert out[changed[0]].endswith("7")


def test_generate_smart_voice_leads_and_times():
    r = generate_smart("D Minor", "epic", 6, rng=random.Random(5))
    assert len(r.chords) == 6
    assert all(c.beats and c.beats > 0 for c in r.chords)
    for c in r.chords[1:]:
        assert all(60 <= n <= 83 for n in c.notes[1:])
