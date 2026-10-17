"""/v1/generate with the chord transformer, using a tiny randomly initialised checkpoint."""

import pytest

torch = pytest.importorskip("torch")

from fastapi.testclient import TestClient  # noqa: E402

import chordcraft.api.main as api  # noqa: E402
from chordcraft.api.model_engine import ModelEngine  # noqa: E402
from chordcraft.data.tokenizer import ChordTokenizer  # noqa: E402
from chordcraft.model.generate import loop_completions  # noqa: E402
from chordcraft.model.transformer import ChordTransformer, ModelConfig  # noqa: E402
from chordcraft.theory import parse_chord_strict  # noqa: E402

client = TestClient(api.app)


@pytest.fixture
def tiny_checkpoint(tmp_path):
    tok = ChordTokenizer()
    torch.manual_seed(0)
    cfg = ModelConfig(vocab_size=len(tok), d_model=32, n_layers=1, n_heads=2, dropout=0.0)
    path = tmp_path / "tiny.pt"
    torch.save({"model": ChordTransformer(cfg).state_dict(), "model_config": cfg.to_dict(),
                "vocab": tok.itos, "train_config": {}, "step": 0, "val_loss": 0.0}, path)
    return path


@pytest.fixture
def with_engine(monkeypatch):
    def use(path):
        monkeypatch.setattr(api, "engine", ModelEngine(path))
    return use


def test_auto_uses_model_when_loaded(tiny_checkpoint, with_engine):
    with_engine(tiny_checkpoint)
    assert client.get("/health").json() == {"status": "ok", "model": True}
    body = client.post("/v1/generate", json={"key": "G Major", "mood": "jazz", "length": 8, "seed": 5}).json()
    assert body["engine"] == "model" and body["patternName"] == "AI · chord transformer"
    assert len(body["chords"]) == len(body["romans"]) == 8
    symbols = [c["symbol"] for c in body["chords"]]
    for s in symbols:
        parse_chord_strict(s)
    assert all(a != b for a, b in zip(symbols, symbols[1:], strict=False))
    assert all(c["beats"] > 0 for c in body["chords"])


def test_model_generation_is_seeded(tiny_checkpoint, with_engine):
    with_engine(tiny_checkpoint)
    req = {"key": "C Minor", "mood": "epic", "length": 6, "seed": 11, "engine": "model"}
    assert client.post("/v1/generate", json=req).json() == client.post("/v1/generate", json=req).json()


def test_exclude_diminished_with_model(tiny_checkpoint, with_engine):
    with_engine(tiny_checkpoint)
    for seed in range(10):
        body = client.post("/v1/generate", json={"key": "C Major", "mood": "tense", "length": 8, "seed": seed,
                                                 "excludeDiminished": True, "engine": "model"}).json()
        assert not any(c["quality"] in ("dim", "dim7", "m7b5") for c in body["chords"])


def test_missing_checkpoint_falls_back_or_503(tmp_path, with_engine):
    with_engine(tmp_path / "nope.pt")
    assert client.get("/health").json()["model"] is False
    assert client.post("/v1/generate", json={"seed": 1}).json()["engine"] == "rules"
    r = client.post("/v1/generate", json={"seed": 1, "engine": "model"})
    assert r.status_code == 503 and "checkpoint not found" in r.json()["detail"]
    assert client.get("/v1/meta").json()["model"]["available"] is False


def test_loop_completions():
    a, b, c = 10, 11, 12
    assert loop_completions([[a, b, a]]) == [(0, b)]           # A B A → block B (ABAB)
    assert (0, c) in loop_completions([[a, b, c, a, b]])       # A B C A B → block C (ABCABC)
    assert loop_completions([[a, b, c]]) == []
    assert loop_completions([[a, b]]) == []
