import json
import sqlite3

import pytest

from chordcraft.songs import db
from chordcraft.songs.hooktheory import Unusable, app_key, convert, one_cycle, parse_page, rel_numerals, slug
from chordcraft.songs.songbpm import key_agreement, tempo_agrees
from chordcraft.theory import parse_chord_strict


def chord(root, beat, duration, type_=5, **kw):
    return {"root": root, "type": type_, "beat": beat, "duration": duration, "isRest": False,
            "inversion": 0, "applied": 0, "borrowed": None, "adds": [], "omits": [], "alterations": [],
            "suspensions": [], "substitutions": [], "pedal": None, "alternate": "", **kw}


def section(chords, tonic="C", scale="major", bpm=100, meters=None, end=None):
    return {"keys": [{"beat": 1, "tonic": tonic, "scale": scale}], "tempos": [{"beat": 1, "bpm": bpm}],
            "meters": meters or [{"beat": 1, "numBeats": 4, "beatUnit": 1}],
            "endBeat": end or 1 + sum(c["duration"] for c in chords), "chords": chords}


# ── TheoryTab conversion ────────────────────────────────────────────────────


def test_converts_degrees_qualities_inversions_and_durations():
    data = section([
        {"isRest": True, "beat": 1, "duration": 4, "root": 1, "type": 5},   # leading rest is trimmed
        chord(6, 5, 2, type_=7),                                           # vi7
        chord(3, 7, 2, type_=7, inversion=1),                              # iii65
        chord(4, 9, 4, type_=7),                                           # IV7
        chord(1, 13, 4),
        chord(5, 17, 2, suspensions=[4]),
        chord(5, 19, 2),
    ])
    s = convert({"name": "Chorus", "rel": "vi7 iii65 IV7 I Vsus4 V"}, data)
    assert s.key == "C Major" and s.bpm == 100 and s.time_signature == "4/4"
    assert s.chords == [("Am7", 2), ("Em7/G", 2), ("Fmaj7", 4), ("C", 4), ("Gsus4", 2), ("G", 2)]
    for sym, _ in s.chords:
        parse_chord_strict(sym)


def test_borrowed_and_applied_chords():
    data = section([
        chord(1, 1, 4), chord(7, 5, 4, borrowed="minor"),       # bVII from the parallel minor
        chord(4, 9, 4, borrowed="minor"),                          # iv
        chord(6, 13, 4, type_=7, applied=5),                       # V7/vi
    ], tonic="G")
    s = convert({"name": "Chorus", "rel": "I bVII iv V7/vi"}, data)
    assert [c for c, _ in s.chords] == ["G", "F", "Cm", "B7"]


def test_flat_keys_spell_with_flats_and_modes_map_to_app_keys():
    data = section([chord(1, 1, 4), chord(4, 5, 4), chord(5, 9, 4, type_=7, borrowed="harmonicMinor")],
                   tonic="F", scale="minor")
    s = convert({"name": "Verse", "rel": "i iv V7"}, data)
    assert s.key == "F Minor" and [c for c, _ in s.chords] == ["Fm", "Bbm", "C7"]
    assert app_key("D", "mixolydian") == "D Major"
    assert app_key("E", "dorian") == "E Minor"
    assert app_key("C#", "major") == "Db Major"


def test_compound_meter_counts_dotted_quarter_pulses():
    data = section([chord(1, 1, 6), chord(3, 7, 6), chord(4, 13, 12)], tonic="A", scale="minor", bpm=82,
                   meters=[{"beat": 1, "numBeats": 6, "beatUnit": 3}])
    s = convert({"name": "Verse", "rel": "i III iv"}, data)
    assert s.time_signature == "6/8"
    assert s.chords == [("Am", 2), ("C", 2), ("Dm", 4)]


def test_compound_ballads_entered_in_eighths_become_n8():
    data = section([chord(6, 1, 6), chord(4, 7, 6), chord(1, 13, 6), chord(5, 19, 6)], tonic="Ab", bpm=190,
                   meters=[{"beat": 1, "numBeats": 6, "beatUnit": 1}])
    s = convert({"name": "Chorus", "rel": "vi IV I V"}, data)
    assert (s.time_signature, s.bpm) == ("6/8", 63.3)
    assert s.chords == [("Fm", 2), ("Db", 2), ("Ab", 2), ("Eb", 2)]


def test_refuses_what_it_cannot_spell_exactly():
    rest_inside = section([chord(1, 1, 4), {"isRest": True, "beat": 5, "duration": 4}, chord(5, 9, 4)])
    with pytest.raises(Unusable, match="rest"):
        convert({"name": "Verse", "rel": "I V"}, rest_inside)
    seven_sus2 = section([chord(1, 1, 4), chord(2, 5, 4, type_=7, suspensions=[2])])
    with pytest.raises(Unusable, match="intervals"):
        convert({"name": "Verse", "rel": "I ii7sus2"}, seven_sus2)


def test_numerals_must_match_theorytabs_own_reading():
    data = section([chord(1, 1, 4), chord(5, 5, 4)])
    with pytest.raises(Unusable, match="disagree"):
        convert({"name": "Verse", "rel": "I IV"}, data)


def test_repeated_loops_are_stored_once():
    loop = [("C", 2), ("G", 2), ("Am", 2), ("F", 2)]
    assert one_cycle(loop * 3) == loop
    assert one_cycle(loop + [("C", 4)]) == loop + [("C", 4)]


def test_rel_numerals():
    assert rel_numerals("vi7 iii65 IV7 V7/vi bVII ivsus4") == ["vi", "iii", "IV", "APPLIED", "bVII", "iv"]


def test_parse_page_reads_embedded_sections():
    html = ('..\\"song\\":{\\"title\\":\\"Let It Be\\",\\"artist\\":\\"The Beatles\\",\\"x\\":1},'
            '\\"sections\\":[{\\"wikiHash\\":\\"a\\",\\"name\\":\\"Verse\\",\\"hash\\":\\"h1\\",\\"rel\\":\\"I V\\"}],'
            '\\"youTubeID\\":\\"CGj85pVzRJs\\"..')
    tab = parse_page("https://www.hooktheory.com/theorytab/view/the-beatles/let-it-be", html)
    assert tab and tab.title == "Let It Be" and tab.youtube_id == "CGj85pVzRJs"
    assert tab.sections[0]["hash"] == "h1"
    assert slug("Don't Stop Believin'") == "dont-stop-believin"


# ── cross-check ─────────────────────────────────────────────────────────────


def test_tempo_and_key_agreement():
    assert tempo_agrees(73, 144, compound=False)       # half time
    assert tempo_agrees(121, 119, compound=False)
    assert not tempo_agrees(72, 108, compound=False)
    assert tempo_agrees(63, 190, compound=True)
    assert key_agreement(0, False, (0, "major")) == "exact"
    assert key_agreement(9, True, (0, "major")) == "relative"
    assert key_agreement(0, False, None) == "unavailable"
    assert key_agreement(0, False, (7, "major")) == "differs"


# ── store ───────────────────────────────────────────────────────────────────


def make(id_="let-it-be", title="Let It Be", **kw):
    base = dict(id=id_, title=title, artist="The Beatles", year=1970, key="C Major", mode="major", bpm=73,
                timeSignature="4/4", section="Chorus",
                sourceUrl="https://www.hooktheory.com/theorytab/view/the-beatles/let-it-be", youtubeId="CGj85pVzRJs",
                tempoCheckUrl="https://songbpm.com/@the-beatles/let-it-be", tempoCheckBpm=144, keyCheck="exact",
                chords=[db.SongChord("Am7", 2), db.SongChord("C", 4)])
    return db.Song(**{**base, **kw})


@pytest.fixture
def conn(tmp_path):
    with db.open_db(tmp_path / "s.sqlite") as c:
        yield c


def test_upsert_search_and_export(conn, tmp_path):
    db.upsert(conn, make())
    db.upsert(conn, make(chords=[db.SongChord("F", 4), db.SongChord("C", 4)]))  # re-ingest replaces
    db.upsert(conn, make(id_="yesterday", title="Yesterday", year=1965))
    total, found = db.query(conn, "let")
    assert total == 1 and [c.symbol for c in found[0].chords] == ["F", "C"]
    assert [s.id for s in db.all_songs(conn)] == ["yesterday", "let-it-be"]
    out = tmp_path / "songs.json"
    assert db.export_json(conn, out) == 2
    data = json.loads(out.read_text())
    assert data[1]["chords"] == [{"symbol": "F", "beats": 4}, {"symbol": "C", "beats": 4}]
    assert data[1]["bpm"] == 73 and isinstance(data[1]["bpm"], int)


def test_schema_rejects_bad_rows(conn):
    with pytest.raises(sqlite3.IntegrityError):
        db.upsert(conn, make(sourceUrl="https://example.com/x"))
    with pytest.raises(sqlite3.IntegrityError):
        db.upsert(conn, make(id_="z", title="Z", chords=[db.SongChord("C", 0)]))


def test_api_serves_songs(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from chordcraft.api.main import app

    path = tmp_path / "api.sqlite"
    with db.open_db(path) as c:
        db.upsert(c, make())
        c.commit()
    monkeypatch.setenv("SONGS_DB", str(path))
    client = TestClient(app)
    page = client.get("/v1/songs", params={"q": "beatles"}).json()
    assert page["total"] == 1 and page["items"][0]["chords"][0] == {"symbol": "Am7", "beats": 2}
    assert client.get("/v1/songs/let-it-be").json()["bpm"] == 73
    assert client.get("/v1/songs/nope").status_code == 404
