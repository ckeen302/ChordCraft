import gzip
import json
from pathlib import Path

import pytest

from chordcraft.data.build import build, split_for
from chordcraft.data.chordonomicon import APPROX, EXACT, NormChord, normalize_chord, parse_root, parse_sections
from chordcraft.data.keyfind import estimate_key
from chordcraft.data.moods import PATTERN_INDEX, label_mood
from chordcraft.data.phrases import extract_phrase, loop_period, merge_repeats, to_degrees
from chordcraft.data.tokenizer import ChordTokenizer
from chordcraft.theory import NOTE_MAP, QUALITY_INTERVALS, parse_chord
from chordcraft.theory.harmony import MOODS, spell_degrees

ROOT = Path(__file__).parents[2]


# ── Chordonomicon normalisation ────────────────────────────────────────────────

@pytest.mark.parametrize("token, pc, quality", [
    ("C", 0, "maj"), ("Amin", 9, "m"), ("Csmin", 1, "m"), ("Fs7", 6, "7"), ("Bb", 10, "maj"),
    ("Csus4", 0, "sus4"), ("Cssus4", 1, "sus4"), ("Gsus2", 7, "sus2"), ("Eno3d", 4, "5"),
    ("A/Cs", 9, "maj"), ("Dadd13", 2, "6"), ("Ebmaj7", 3, "maj7"), ("Bdim7", 11, "dim7"),
])
def test_normalize_chord(token, pc, quality):
    c = normalize_chord(token)
    assert c is not None and (c.pc, c.quality) == (pc, quality)


def test_unknown_and_malformed_tokens_are_dropped():
    assert normalize_chord("Cweird") is None
    assert normalize_chord("Hmin") is None
    assert parse_root("") is None


def test_every_mapped_quality_exists_in_the_engine():
    for q in [*EXACT.values(), *APPROX.values()]:
        assert q in QUALITY_INTERVALS


def test_approx_flag():
    assert normalize_chord("Cmaj13").approx and not normalize_chord("Cmaj9").approx


def test_parse_sections():
    s = parse_sections("<intro_1> C G <verse_1> Amin F <chorus_2> C <intro_riff> D")
    assert s == [("intro", ["C", "G"]), ("verse", ["Amin", "F"]), ("chorus", ["C"]), ("intro_riff", ["D"])]
    assert parse_sections("C G") == [("untagged", ["C", "G"])]


# ── Phrases ───────────────────────────────────────────────────────────────────

def test_merge_and_loop_reduction():
    seq = [(0, "maj"), (0, "maj"), (7, "maj"), (9, "m"), (5, "maj")] * 3
    assert loop_period(merge_repeats(seq)) == 4
    assert extract_phrase(seq) == [(0, "maj"), (7, "maj"), (9, "m"), (5, "maj")]


def test_partial_final_cycle_still_counts_as_a_loop():
    a, b, c = (0, "m"), (8, "maj"), (10, "maj")
    assert extract_phrase([a, b, c, a, b, c, a, b]) == [a, b, c]


def test_through_composed_sections_are_clipped():
    seq = [(i % 12, "maj") for i in range(20)]
    assert len(extract_phrase(seq)) == 16


def test_vamps_are_rejected():
    assert extract_phrase([(0, "maj")] * 8) is None
    assert extract_phrase([(0, "m"), (0, "m")]) is None


def test_to_degrees_is_key_relative():
    chords = [NormChord(9, "m"), NormChord(5, "maj"), NormChord(0, "maj"), NormChord(7, "maj")]
    assert to_degrees(chords, tonic=9) == [(0, "m"), (8, "maj"), (3, "maj"), (10, "maj")]


# ── Key estimation ────────────────────────────────────────────────────────────

def test_key_estimation_beats_70_percent_on_verified_songs():
    songs = json.loads((ROOT / "fixtures" / "popular-songs.json").read_text())
    hits = 0
    for s in songs:
        chords = [parse_chord(c["symbol"]) for c in s["chords"]]
        est = estimate_key([NormChord(NOTE_MAP[c.root] % 12, c.quality) for c in chords])
        tonic, mode = s["key"].split()
        hits += (est.tonic, est.mode) == (NOTE_MAP[tonic] % 12, mode.lower())
    assert hits / len(songs) >= 0.70, f"{hits}/{len(songs)}"


def test_obvious_keys():
    def est(*symbols):
        cs = [parse_chord(s) for s in symbols]
        k = estimate_key([NormChord(NOTE_MAP[c.root] % 12, c.quality) for c in cs])
        return k.tonic, k.mode
    assert est("C", "F", "G7", "C") == (0, "major")
    assert est("Am", "Dm", "E7", "Am") == (9, "minor")
    assert estimate_key([]) is None


# ── Mood labels ───────────────────────────────────────────────────────────────

def test_curated_patterns_get_pattern_labels():
    assert label_mood([(0, "maj"), (7, "maj"), (9, "m"), (5, "maj")], "major") == ("uplifting", "pattern")
    assert label_mood([(0, "m"), (10, "maj"), (8, "maj"), (7, "maj")], "minor") == ("melancholic", "pattern")
    assert label_mood([(0, "m"), (1, "maj")], "minor")[0] in ("tense", "aggressive")
    assert len(PATTERN_INDEX) > 50


def test_rule_labels():
    assert label_mood([(0, "5"), (3, "5"), (5, "5")], "minor") == ("aggressive", "rule")
    assert label_mood([(2, "m7"), (7, "9"), (0, "maj7"), (4, "m7"), (9, "7")], "major")[0] == "jazz"
    assert label_mood([(0, "maj"), (3, "dim7"), (2, "m"), (7, "maj")], "major")[0] == "tense"
    for phrase, mode in [([(0, "maj"), (5, "maj"), (2, "m"), (9, "m"), (4, "m")], "major")]:
        assert label_mood(phrase, mode)[0] in MOODS


# ── Tokenizer ────────────────────────────────────────────────────────────────

def test_tokenizer_round_trip_and_layout():
    tok = ChordTokenizer()
    phrase = [(0, "m"), (8, "maj"), (3, "maj"), (10, "maj")]
    ids = tok.encode(phrase, "minor", "rock", "epic")
    assert [tok.itos[i] for i in ids] == [
        "<bos>", "mode:minor", "genre:rock", "mood:epic", "0:m", "8:maj", "3:maj", "10:maj", "<eos>"]
    assert tok.decode_chords(ids) == phrase
    assert len(tok) == 4 + 2 + 13 + 10 + 12 * len(QUALITY_INTERVALS)


def test_unknown_conditioning_falls_back_to_any():
    tok = ChordTokenizer()
    ids = tok.control_ids("major", genre="polka", mood="sleepy")
    assert [tok.itos[i] for i in ids[2:]] == ["genre:any", "mood:any"]


def test_vocab_file_compatibility(tmp_path):
    tok = ChordTokenizer()
    tok.save(tmp_path / "vocab.json")
    ChordTokenizer.check_compatible(tmp_path / "vocab.json")
    (tmp_path / "bad.json").write_text(json.dumps({"version": 0, "tokens": ["x"]}))
    with pytest.raises(ValueError):
        ChordTokenizer.check_compatible(tmp_path / "bad.json")


def test_spell_degrees():
    assert spell_degrees("A Minor", [(0, "m"), (8, "maj"), (3, "maj"), (10, "maj")]) == ["Am", "F", "C", "G"]
    assert spell_degrees("Eb Major", [(0, "maj7"), (9, "m7"), (2, "m7"), (7, "7")]) == ["Ebmaj7", "Cm7", "Fm7", "Bb7"]


# ── End-to-end build on a tiny CSV ───────────────────────────────────────────

def test_build_end_to_end(tmp_path):
    raw = tmp_path / "mini.csv"
    raw.write_text(
        "id,chords,release_date,genres,decade,rock_genre,artist_id,main_genre,spotify_song_id,spotify_artist_id\n"
        "1,<verse_1> C G Amin F C G Amin F <chorus_1> F G C C <verse_2> C G Amin F,,,,,artist_1,pop,,\n"
        "2,<verse_1> Amin G F E Amin G F E,,,,,artist_2,rock,,\n"
        "3,<verse_1> Eno3d Gno3d Ano3d Eno3d,,,,,artist_3,metal,,\n"
        "4,<verse_1> C,,,,,artist_4,pop,,\n"
    )
    stats = build(raw, tmp_path / "out", dup_cap=50, limit=None)
    assert stats["songs"] == {"read": 4, "used": 3, "skipped": 1}
    records = []
    for split in ("train", "val", "test"):
        with gzip.open(tmp_path / "out" / f"{split}.jsonl.gz", "rt") as f:
            records += [json.loads(line) for line in f]
    by_song = {}
    for r in records:
        by_song.setdefault(r["id"], []).append(r)
    assert len(by_song["1"]) == 2  # verse_2 duplicates verse_1
    assert by_song["1"][0]["degrees"] == [[0, "maj"], [7, "maj"], [9, "m"], [5, "maj"]]
    assert by_song["2"][0]["mode"] == "minor" and by_song["2"][0]["mood"] == "melancholic"
    assert by_song["3"][0]["mood"] == "aggressive"
    ChordTokenizer.check_compatible(tmp_path / "out" / "vocab.json")


def test_split_is_stable_per_artist():
    assert split_for("artist_42") == split_for("artist_42")
    counts = {"train": 0, "val": 0, "test": 0}
    for i in range(5000):
        counts[split_for(f"artist_{i}")] += 1
    assert 0.85 < counts["train"] / 5000 < 0.95
