import pytest

torch = pytest.importorskip("torch")

import gzip  # noqa: E402
import json  # noqa: E402

from chordcraft.data.tokenizer import N_CONTROL, ChordTokenizer  # noqa: E402
from chordcraft.model.dataset import Collator, PhraseDataset  # noqa: E402
from chordcraft.model.generate import _MAJOR, DIM_FAMILY, sample  # noqa: E402
from chordcraft.model.train import TrainConfig, train  # noqa: E402
from chordcraft.model.transformer import ChordTransformer, ModelConfig, apply_rope, rope_tables  # noqa: E402

TOK = ChordTokenizer()


def tiny_model(**kw) -> ChordTransformer:
    torch.manual_seed(0)
    return ChordTransformer(ModelConfig(vocab_size=len(TOK), d_model=64, n_layers=2, n_heads=4, dropout=0.0, **kw))


def test_forward_shape_and_weight_tying():
    m = tiny_model()
    ids = torch.randint(0, len(TOK), (3, 12))
    assert m(ids).shape == (3, 12, len(TOK))
    assert m.head.weight.data_ptr() == m.embed.weight.data_ptr()


def test_attention_is_causal():
    m = tiny_model().eval()
    a = torch.randint(0, len(TOK), (1, 10))
    b = a.clone()
    b[0, 7:] = (b[0, 7:] + 5) % len(TOK)
    assert torch.allclose(m(a)[0, :7], m(b)[0, :7], atol=1e-5)
    assert not torch.allclose(m(a)[0, 7:], m(b)[0, 7:])


def test_rope_preserves_norms_and_encodes_relative_position():
    cos, sin = rope_tables(16, 32, 10_000.0)
    x = torch.randn(1, 1, 8, 16)
    assert torch.allclose(apply_rope(x, cos, sin).norm(dim=-1), x.norm(dim=-1), atol=1e-5)
    q, k = torch.randn(16), torch.randn(16)
    def score(pq, pk):
        qs = apply_rope(q.expand(1, 1, 32, 16).clone(), cos, sin)[0, 0, pq]
        ks = apply_rope(k.expand(1, 1, 32, 16).clone(), cos, sin)[0, 0, pk]
        return (qs @ ks).item()
    assert score(5, 2) == pytest.approx(score(9, 6), abs=1e-4)


def test_padding_mask_does_not_change_real_positions():
    m = tiny_model().eval()
    ids = torch.tensor([TOK.encode([(0, "maj"), (7, "maj")], "major")])
    padded = torch.cat([ids, torch.full((1, 4), TOK.pad_id)], dim=1)
    out = m(padded, padded != TOK.pad_id)
    assert torch.allclose(m(ids)[0], out[0, : ids.shape[1]], atol=1e-5)


def test_collator_masks_controls_and_padding():
    import numpy as np
    rows = [TOK.encode([(0, "maj"), (5, "maj"), (7, "maj")], "major"), TOK.encode([(0, "m"), (8, "maj")], "minor")]
    width = max(map(len, rows))
    batch = [np.array(r + [TOK.pad_id] * (width - len(r)), dtype=np.int16) for r in rows]
    b = Collator(TOK)(batch)
    # Targets: 3 chords + EOS for row 0, 2 chords + EOS for row 1; controls never scored.
    assert b["loss_mask"].sum(1).tolist() == [4, 3]
    assert not b["loss_mask"][:, : N_CONTROL - 1].any()


def test_conditioning_dropout_replaces_genre_and_mood():
    import numpy as np
    row = np.array(TOK.encode([(0, "maj"), (7, "maj")], "major", "rock", "epic"), dtype=np.int16)
    b = Collator(TOK, cond_dropout=1.0)([row])
    assert TOK.itos[b["input"][0, 2]] == "genre:any" and TOK.itos[b["input"][0, 3]] == "mood:any"


@pytest.mark.parametrize("length", [2, 4, 8, 16])
def test_sampling_respects_length_and_no_repeats(length):
    g = torch.Generator().manual_seed(1)
    for s in sample(tiny_model(), TOK, mode="major", length=length, num_samples=8, generator=g):
        assert len(s.degrees) == length
        assert all(a != b for a, b in zip(s.degrees, s.degrees[1:], strict=False))


def test_sampling_constraints():
    g = torch.Generator().manual_seed(2)
    out = sample(tiny_model(), TOK, mode="major", length=8, num_samples=16,
                 exclude_diminished=True, diatonic_only=True, generator=g)
    for s in out:
        for off, q in s.degrees:
            assert q not in DIM_FAMILY
            assert off in _MAJOR


def test_tiny_training_run_learns(tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    phrases = [[[0, "maj"], [7, "maj"], [9, "m"], [5, "maj"]], [[0, "m"], [8, "maj"], [3, "maj"], [10, "maj"]]]
    for split, n in (("train", 400), ("val", 40)):
        with gzip.open(data / f"{split}.jsonl.gz", "wt") as f:
            for i in range(n):
                p = phrases[i % 2]
                f.write(json.dumps({"degrees": p, "mode": "major" if i % 2 == 0 else "minor",
                                    "genre": "pop", "mood": "uplifting" if i % 2 == 0 else "epic"}) + "\n")
    TOK.save(data / "vocab.json")
    summary = train(TrainConfig(data=str(data), out=str(tmp_path / "run"), epochs=30, batch_size=32,
                                warmup_steps=10, eval_every=50, lr=3e-3, d_model=64, n_layers=2, n_heads=4,
                                dropout=0.0, cond_dropout=0.0))
    assert summary["best_val_loss"] < 0.2
    assert (tmp_path / "run" / "best.pt").exists()
    ds = PhraseDataset(data / "train.jsonl.gz", TOK)
    assert len(ds) == 400 and ds.mood_counts()["epic"] == 200
