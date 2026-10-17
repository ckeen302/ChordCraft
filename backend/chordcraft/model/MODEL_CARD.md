---
license: cc-by-nc-4.0
library_name: pytorch
pipeline_tag: text-generation
tags:
  - music
  - chord-progressions
  - symbolic-music
  - transformer
datasets:
  - ailsntua/Chordonomicon
---

# ChordCraft chord transformer (v1)

A small decoder-only transformer, written from scratch in PyTorch, that writes
chord progressions conditioned on **mode, mood, genre, and length**. It powers
the AI mode of [ChordCraft](https://github.com/ckeen302/ChordCraft), a
chord-progression studio (Next.js front end, FastAPI back end).

## Model

| | |
| --- | --- |
| Architecture | Decoder-only transformer: RMSNorm pre-norm blocks, causal multi-head attention with rotary position embeddings (RoPE), SwiGLU MLP, tied embeddings |
| Size | 14.3M parameters — d_model 384, 8 layers, 6 heads |
| Vocabulary | 344 tokens: control tokens (`mode:` `genre:` `mood:` `len:`) + 300 key-relative chord tokens (`{semitones above tonic}:{quality}`, 12 × 25 qualities) |
| Context | `<bos> mode genre mood len:N` + up to 16 chords + `<eos>` |
| Training | 3 epochs, 8,292 steps, batch 512, AdamW + warmup/cosine, fp16 on one Tesla T4 (72 min) |

Chord tokens are relative to the tonic, so one learned pattern covers all twelve
keys; output is spelled into any key afterwards.

## Data

[Chordonomicon](https://huggingface.co/datasets/ailsntua/Chordonomicon)
(CC BY-NC 4.0): ~680k songs of user-submitted chord charts. Preprocessing
(code in the ChordCraft repo, `backend/chordcraft/data`):

- 59 chord types mapped to 25 qualities (99.8% exact), power chords kept
- keys estimated per song (Krumhansl–Kessler profiles + tonic prior; 76% exact on a hand-verified set)
- one phrase per section, repeats merged, loops reduced to one cycle, max 16 chords
- weak mood labels: curated-pattern matching, then harmonic/genre rules
- 90/5/5 artist-disjoint splits; each identical phrase capped at 50 copies → 1.57M phrases

## Evaluation

Test perplexity **4.12** (artist-disjoint test split, 77k phrases, chord + EOS tokens).

1,800 generated progressions per system (9 moods × 200, half major / half minor, lengths 4 and 8):

| System | Valid | Mood control | Novelty | Distinct-2 | Ends on I/V |
| --- | --- | --- | --- | --- | --- |
| This model | 100% | 82.4% | 46.9% | 0.114 | 55.3% |
| This model, no mood token | 100% | 10.9% | 34.8% | 0.073 | 56.2% |
| Rule-based baseline | 100% | 63.2% | 81.0% | 0.090 | 51.2% |

*Mood control* uses the same weak labeler as training, so it measures whether
conditioning steers the output, not human-judged mood. Validity is 100% by
construction (masked decoding).

## Usage

Decoding in ChordCraft is constrained: exact requested length, no immediate
repeats, no immediately repeated blocks (ABAB…), optional diatonic-only /
no-diminished masks, nucleus sampling, best-of-4 by mean log-probability.

```python
from pathlib import Path
from chordcraft.model.hub import download, load_exported
from chordcraft.model.generate import sample
from chordcraft.theory.harmony import spell_degrees

model, tok = load_exported(download("ckeen302/chordcraft-chord-transformer"))
[s] = sample(model, tok, mode="minor", length=4, mood="epic")
print(spell_degrees("A Minor", s.degrees))   # e.g. ['Am', 'F', 'C', 'G']
```

## Limitations

- Mood labels are heuristic; "mood" reflects harmonic conventions, not listening tests.
- No rhythm or voicing — the app applies harmonic rhythm and voice leading.
- Learned from user-submitted charts, which contain errors and skew toward
  Western pop/rock/country.
- **Non-commercial:** trained on CC BY-NC 4.0 data, released under the same license.
