from fastapi.testclient import TestClient

from chordcraft.api.main import app
from chordcraft.theory import parse_chord_strict

client = TestClient(app)


def test_health():
    assert client.get("/health").json()["status"] == "ok"


def test_meta_lists_keys_moods_qualities():
    body = client.get("/v1/meta").json()
    assert len(body["keys"]) == 24
    assert "melancholic" in body["moods"]
    assert "maj9" in body["qualities"]


def test_parse_strict_and_lenient():
    body = client.post("/v1/parse", json={"symbols": ["Cmaj9", "Cmaj7#11"]}).json()
    assert body["results"][0]["ok"] and body["results"][0]["chord"]["quality"] == "maj9"
    assert not body["results"][1]["ok"] and "Unrecognised" in body["results"][1]["error"]
    lenient = client.post("/v1/parse", json={"symbols": ["Cmaj7#11"], "strict": False}).json()
    assert lenient["results"][0]["chord"]["quality"] == "maj7"


def test_parse_rejects_empty_and_oversized_requests():
    assert client.post("/v1/parse", json={"symbols": []}).status_code == 422
    assert client.post("/v1/parse", json={"symbols": ["C"] * 65}).status_code == 422


def test_analyze():
    body = client.post("/v1/analyze", json={"symbols": ["C", "Am", "F", "G7", "C"], "key": "C Major"}).json()
    assert body["romans"] == ["I", "vi", "IV", "V7", "I"]
    assert "authentic cadence" in body["summary"]


def test_analyze_rejects_unknown_key():
    assert client.post("/v1/analyze", json={"symbols": ["C", "G"], "key": "H Major"}).status_code == 422


def test_validate_scores_model_output():
    body = client.post(
        "/v1/validate", json={"symbols": ["C", "Am", "Fm", "G7", "Cxyz"], "key": "C Major"}
    ).json()
    assert body["valid"] is False
    flags = [(c["symbol"], c["ok"], c["diatonic"]) for c in body["chords"]]
    assert flags == [("C", True, True), ("Am", True, True), ("Fm", True, False), ("G7", True, True),
                     ("Cxyz", False, False)]
    assert body["chords"][2]["roman"] == "iv"
    assert body["diatonicRatio"] == 0.75


def test_generate_is_seeded_and_valid():
    req = {"key": "A Minor", "mood": "melancholic", "length": 8, "seed": 123, "engine": "rules"}
    a = client.post("/v1/generate", json=req).json()
    b = client.post("/v1/generate", json=req).json()
    assert a == b
    assert a["engine"] == "rules" and a["mood"] == "melancholic"
    assert len(a["chords"]) == 8 == len(a["romans"])
    for c in a["chords"]:
        parse_chord_strict(c["symbol"])
        assert c["beats"] > 0


def test_generate_random_mood_and_bounds():
    body = client.post("/v1/generate", json={"seed": 9, "engine": "rules"}).json()
    assert body["mood"] in client.get("/v1/meta").json()["moods"]
    assert client.post("/v1/generate", json={"length": 1}).status_code == 422
    assert client.post("/v1/generate", json={"mood": "polka"}).status_code == 422


def test_cors_allows_local_dev_origin():
    r = client.options(
        "/v1/generate",
        headers={"Origin": "http://localhost:3001", "Access-Control-Request-Method": "POST"},
    )
    assert r.headers.get("access-control-allow-origin") == "http://localhost:3001"
