import json
import sqlite3

import pytest
from fastapi.testclient import TestClient

from chordcraft.api.main import app
from chordcraft.presets import db
from chordcraft.presets.__main__ import export
from chordcraft.presets.ingest import AUTO_NOTE, WATERMARK, ingest
from chordcraft.presets.parse import Parsed, Rejected, parse_post, split_title


def make(id_, artist="Playboi Carti", context='"Sky" — melody', vst="Spectrasonics Omnisphere",
         preset="Triangle Toon", url="https://www.reddit.com/r/findthepreset/comments/abc/"):
    return db.Preset(id=id_, artist=artist, context=context, vst=vst, preset=preset, notes="n",
                     status="community", sourceUrl=url, sourceLabel="r/findthepreset thread")


@pytest.fixture
def conn(tmp_path):
    with db.open_db(tmp_path / "p.sqlite") as c:
        yield c


# ── store ───────────────────────────────────────────────────────────────────


def test_insert_dedupes_by_id_and_song(conn):
    assert db.insert(conn, make("a"))
    assert not db.insert(conn, make("a", context='"Other" — x'))  # same id
    assert not db.insert(conn, make("b", context='"SKY" — pad'))  # same artist + song
    assert db.insert(conn, make("c", context='"Magnolia" — melody'))
    assert db.unique_id(conn, "a") == "a-2"


def test_schema_rejects_bad_rows(conn):
    with pytest.raises(sqlite3.IntegrityError):
        db.insert(conn, make("x", url="http://insecure.example/"))
    with pytest.raises(sqlite3.IntegrityError):
        db.insert(conn, make("y", preset=""))


def test_full_text_search_filters_and_paging(conn):
    db.insert(conn, make("sky"))
    db.insert(conn, make("m1", artist="Madonna", context='"Vogue" — piano', vst="Korg M1", preset="Piano 16'",
                         url="https://www.youtube.com/watch?v=TVmZarPUc-Q"))
    db.insert(conn, make("magnolia", context='"Magnolia" — melody', vst="NI FM8", preset="Adam The Psycho"))
    assert [p.id for p in db.query(conn, q="tri").items] == ["sky"]  # prefix match on the preset
    assert [p.id for p in db.query(conn, q="carti fm8").items] == ["magnolia"]  # every word must match
    assert db.query(conn, q='"(').total == 3  # punctuation-only search is no filter, not an FTS syntax error
    assert [p.id for p in db.query(conn, source="YouTube").items] == ["m1"]
    assert [p.id for p in db.query(conn, vst="NI FM8").items] == ["magnolia"]
    page = db.query(conn, limit=2, offset=0)
    assert page.total == 3 and [p.artist for p in page.items] == ["Madonna", "Playboi Carti"]
    assert db.vst_counts(conn)[0][1] == 1


def test_fts_index_follows_updates_and_deletes(conn):
    db.insert(conn, make("sky"))
    conn.execute("UPDATE presets SET preset = 'Broken Square Lead' WHERE id = 'sky'")
    assert db.query(conn, q="triangle").total == 0 and db.query(conn, q="broken").total == 1
    conn.execute("DELETE FROM presets WHERE id = 'sky'")
    assert db.query(conn, q="broken").total == 0


def test_export_writes_snapshot(conn, tmp_path):
    db.insert(conn, make("sky"))
    out = tmp_path / "presets.json"
    assert export(conn, out) == 1
    data = json.loads(out.read_text())
    assert data["count"] == 1 and data["presets"][0]["sourceUrl"].startswith("https://")
    assert data["vsts"] == [{"vst": "Spectrasonics Omnisphere", "count": 1}]


# ── parser (cases taken from real solved threads) ───────────────────────────


@pytest.mark.parametrize(("title", "text", "vst", "preset"), [
    ("Playboi Carti - Old Money", "Serum - Pads - PD Quasar :)", "Xfer Serum", "PD Quasar (Pads)"),
    ("Pi'erre Bourne - TLOP5 SFX", "Hive - XS 8-Bit Fire", "u-he Hive", "XS 8-Bit Fire"),
    ("Ken Carson - Butterfly", "Nexus 3 - Reggaeton - PL Bella", "reFX Nexus", "PL Bella (Reggaeton)"),
    ("Drake - Marvin's Room", "Synthetic Woods, under Soft Pads in Xpand!2", "AIR Xpand!2", None),
    ("Playboi Carti - Shoota", "Dune 3 >>>> Keys >>>> EP Low Body MK", "Synapse DUNE 3", "EP Low Body MK (Keys)"),
    ("Yeat - Callin më", "VST: Spitfire LABS\nPreset: Soft Piano", "Spitfire LABS", "Soft Piano"),
])
def test_parses_solved_posts(title, text, vst, preset):
    result = parse_post(title, text)
    assert isinstance(result, Parsed), result
    assert result.vst == vst
    if preset:
        assert result.preset == preset


@pytest.mark.parametrize(("title", "text", "reason"), [
    ("Some beat I heard", "Omnisphere - Triangle Toon", "title"),
    ("Carti - Sky", "[removed]", "no post text"),
    ("Carti - Sky", "maybe Omnisphere - Triangle Toon?", "hedged"),
    ("Carti - Sky", "it's a custom sound lol", "no known synth"),
    ("Carti - Sky", "Omnisphere - Main Lead", "no known synth"),
])
def test_rejects_unclear_posts(title, text, reason):
    result = parse_post(title, text)
    assert isinstance(result, Rejected) and reason in result.reason


def test_split_title_strips_noise():
    assert split_title("Playboi Carti - Vamp Anthem - Preset Found") == ("Playboi Carti", "Vamp Anthem")
    assert split_title("Juice WRLD - Bad Boy (prod. Pierre Bourne)") == ("Juice WRLD", "Bad Boy")


# ── ingest ──────────────────────────────────────────────────────────────────


def fake_archive(posts):
    def fetch(url):
        after = int(url.split("after=")[1].split("&")[0])
        return {"data": [p for p in posts if p["created_utc"] > after][:100]}
    return fetch


def test_ingest_adds_queues_and_moves_watermark(conn):
    db.insert(conn, make("existing", context='"Magnolia" — x'))
    posts = [
        {"id": "p1", "title": "Ken Carson - Yale", "selftext": "Purity - Lead Synth - Ducking",
         "created_utc": 110, "link_flair_text": "PRESET FOUND"},
        {"id": "p2", "title": "Carti - Sky", "selftext": "maybe omnisphere?", "created_utc": 120,
         "link_flair_text": "PRESET FOUND"},
        {"id": "p3", "title": "Playboi Carti - Magnolia", "selftext": "FM8 - Adam The Psycho",
         "created_utc": 130, "link_flair_text": "PRESET FOUND"},
        {"id": "p4", "title": "Who made this?", "selftext": "", "created_utc": 140, "link_flair_text": "REQUEST"},
    ]
    report = ingest(conn, fetch=fake_archive(posts), since=100)
    assert report.added == ["ken-carson-yale"] and report.duplicates == 1 and report.queued == 1
    added = db.get(conn, "ken-carson-yale")
    assert added.notes == AUTO_NOTE and added.sourceUrl.endswith("/comments/p1/")
    assert db.get_meta(conn, WATERMARK) == "140"
    assert ingest(conn, fetch=fake_archive(posts)).seen == 0  # nothing new past the watermark


def test_ingest_dry_run_changes_nothing(conn):
    posts = [{"id": "p1", "title": "Ken Carson - Yale", "selftext": "Purity - Lead Synth - Ducking",
              "created_utc": 110, "link_flair_text": "PRESET FOUND"}]
    ingest(conn, fetch=fake_archive(posts), since=100, dry_run=True)
    assert db.query(conn).total == 0 and db.get_meta(conn, WATERMARK) is None


# ── API (served from the committed database) ────────────────────────────────

client = TestClient(app)


def test_api_lists_and_searches():
    body = client.get("/v1/presets", params={"q": "windows ding"}).json()
    assert body["total"] >= 1 and body["items"][0]["preset"] == "Future Bell"
    page = client.get("/v1/presets", params={"limit": 5, "offset": 5}).json()
    assert page["total"] > 800 and len(page["items"]) == 5 and page["offset"] == 5


def test_api_filters_facets_and_errors():
    yt = client.get("/v1/presets", params={"source": "YouTube", "limit": 200}).json()
    assert yt["total"] > 0 and all("youtube.com" in p["sourceUrl"] for p in yt["items"])
    facets = client.get("/v1/presets/facets").json()
    assert facets["vsts"][0]["count"] >= facets["vsts"][-1]["count"]
    assert sum(facets["sources"].values()) == facets["total"]
    assert client.get("/v1/presets/windows-7-ding").json()["vst"] == "Korg Triton"
    assert client.get("/v1/presets/does-not-exist").status_code == 404
    assert client.get("/v1/presets", params={"limit": 500}).status_code == 422
    assert client.get("/v1/presets", params={"source": "MySpace"}).status_code == 422


def test_api_connection_is_read_only():
    conn = db.connect_readonly()
    with pytest.raises(sqlite3.OperationalError):
        conn.execute("DELETE FROM presets")
    conn.close()
