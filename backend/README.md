# ChordCraft backend

FastAPI service for ChordCraft's theory engine and progression generation — the
home of the AI layer (chord transformer + LLM copilot) as it lands.

## Run

```bash
uv sync
uv run uvicorn chordcraft.api.main:app --reload   # http://localhost:8000/docs
```

Or with Docker (same image Hugging Face Spaces runs):

```bash
docker build -t chordcraft-api . && docker run -p 7860:7860 chordcraft-api
```

Set `ALLOWED_ORIGINS` (comma-separated) to allow deployed frontends; any
`http://localhost:<port>` origin is always allowed for development.

The chord transformer loads from `CHORD_MODEL_PATH` (default
`models/chord-transformer-v1.pt`, not committed) and needs the `ml` extra
(`uv sync --extra ml`). Without either, `/health` reports `"model": false` and
generation uses the rule engine. Model output goes through the same theory
pipeline as the rule engine (spelling, mood harmonic rhythm, voice leading,
roman numerals), sampled best-of-4 with loop blocking.

## Endpoints

| Method | Path           | Purpose |
| ------ | -------------- | ------- |
| GET    | `/health`      | Liveness |
| GET    | `/v1/meta`     | Keys, moods, chord qualities |
| POST   | `/v1/parse`    | Parse symbols (strict by default) |
| POST   | `/v1/analyze`  | Roman numerals + cadence/colour analysis |
| POST   | `/v1/validate` | Score generated chords: strict validity, romans, diatonic ratio |
| POST   | `/v1/generate` | Mood-driven progression. `engine`: `auto` (model if loaded, else rules), `model`, or `rules`; `seed` makes it reproducible |
| GET    | `/v1/presets`  | Preset Finder search: `q` (full-text, prefix match), `vst`, `source` (`Reddit`/`YouTube`/`Web`), `limit` ≤ 200, `offset` |
| GET    | `/v1/presets/facets` | Every VST with its count, plus counts per source |
| GET    | `/v1/presets/{id}` | One preset |
| GET    | `/v1/songs`    | Popular Songs search: `q` (title/artist, prefix match), `limit` ≤ 500, `offset` |
| GET    | `/v1/songs/{id}` | One song with its chords and sources |

## Popular Songs database

The Popular Songs tab is built from a SQLite database at `db/songs.sqlite`:

- `songs`: one progression per song with key, mode, tempo, meter, section, the
  Hooktheory TheoryTab URL it came from, and the songbpm.com tempo check
- `song_chords`: the chords in order, each with its duration in beats
- `songs_fts`: an FTS5 index over title and artist
- `rejected`: every candidate that didn't make it, with the reason

`chordcraft.songs.ingest` reads `db/songs-candidates.txt`, finds each song on
[TheoryTab](https://www.hooktheory.com/theorytab), and converts one section
(chorus first, then verse ...) from the analysis data its player loads
(`/v1/songs/public/<section>`) into absolute chord symbols with real
durations. Borrowed and secondary chords, inversions, suspensions and
compound meters are all handled. A section is refused when any chord has no
exact symbol the app's strict parser accepts, when it has a key/tempo change or
a rest mid-progression, or when the converter's roman numerals disagree with
TheoryTab's own. The song is then published only if songbpm.com's tempo agrees
within 4% (allowing half/double time). songbpm's key is Spotify's automatic
estimate, often a fifth off, so it is recorded (`key_check`) but never
grounds for rejection.

**Chords are confirmed by a second source** (`chordcraft/songs/chordcheck.py`).
[Songsterr](https://www.songsterr.com) tabs are multitrack transcriptions synced
to the record, with every note as string + fret on a track with known tuning
and capo. The checker turns the rhythm guitar, bass and keys tracks into the
pitches sounding at every half beat, then slides the TheoryTab progression along
them (allowing half/double time). Every chord of a beat or longer must fit the
notes under it:

- mostly chord tones, with the root sounding;
- the right third heard, and not outweighed by the opposite one;
- the right seventh where the tab voices one (otherwise it confirms the triad);
- a bass note in the chord;
- the chord changing where TheoryTab says: each half of it, and its first and
  last beat, fit it at least as well as its neighbours.

If only part of a section is confirmed (at least half of it and 2 bars, from a
bar line), only that part is published. If the tab is in another key,
songbpm has to confirm the key. On hand-planted errors (a wrong third, wrong
seventh, swapped relative chord, shifted chord change, another song's tab) the
check refuses or trims out the wrong chord. Release years come from
[MusicBrainz](https://musicbrainz.org) (the earliest single/album/EP).

```bash
SONGS_HTTP_CACHE=/tmp/songs-cache uv run python -m chordcraft.songs ingest db/songs-candidates.txt
uv run python -m chordcraft.songs stats
uv run python -m chordcraft.songs export ../lib/data/popular-songs.json
```

The site bundles the exported `lib/data/popular-songs.json`.

## Preset Finder database

The "what preset is that?" library is a SQLite database at `db/presets.sqlite`,
served read-only by the API:

- `presets` — published identifications, with an FTS5 index (kept in sync by
  triggers) for search, and a `song_key` unique column that dedupes "same artist,
  same song" across sources
- `review_queue` — solved threads the parser couldn't read confidently
- `meta` — the ingest watermark

New entries come from r/findthepreset. Reddit blocks unauthenticated API access,
so `chordcraft.presets.ingest` reads the [Arctic Shift](https://arctic-shift.photon-reddit.com)
archive instead. It fetches posts newer than the watermark, parses threads
flaired *PRESET FOUND* (`chordcraft/presets/parse.py`: title → artist/song,
post → synth + preset; anything hedged or ambiguous is queued instead), and
inserts the confident ones. On ~400 hand-labelled solved threads the parser
agrees with the human label about 90% of the time. Every automated batch lands
as a pull request for review.

```bash
uv run python -m chordcraft.presets stats
uv run python -m chordcraft.presets ingest --dry-run      # what would be added
uv run python -m chordcraft.presets ingest
uv run python -m chordcraft.presets export ../public/data/presets.json
```

The deployed site has no backend, so it reads `public/data/presets.json`, a
snapshot exported from the same database, and runs the same query in the
browser. Set `NEXT_PUBLIC_API_URL` to have it query this API instead.
`.github/workflows/presets-refresh.yml` runs the ingest + export every Monday
and opens a PR with the new entries.

## Theory engine parity

`chordcraft/theory` is a port of the TypeScript engine in `lib/theory`. Both are
pinned to `fixtures/theory.json` (generated by `npm run fixtures` at the repo
root): ~500 parse, detection, voice-leading, transposition, and analysis cases
that the Python tests must reproduce exactly.

## Training data

Source: [Chordonomicon](https://huggingface.co/datasets/ailsntua/Chordonomicon)
(~680k songs of user-submitted chord charts with section tags and genres,
**CC BY-NC 4.0** — non-commercial use with attribution; models trained on it
inherit that restriction).

```bash
hf download ailsntua/Chordonomicon chordonomicon_v2.csv --repo-type dataset --local-dir data/raw/chordonomicon
uv run python -m chordcraft.data.build --raw data/raw/chordonomicon/chordonomicon_v2.csv --out data/processed
```

| Stage | What happens |
| ----- | ------------ |
| Normalise | 59 dataset chord types → the engine's 25 qualities (exact for >99.5% of chords; rare altered chords collapse to the nearest quality; slash basses dropped). Power chords keep their own `5` quality. |
| Key | No key labels exist, so keys are estimated per song: Krumhansl–Kessler profiles + a tonic-chord prior. 76% exact on the 87 verified songs (most misses are relative major/minor, which key-relative tokens tolerate). |
| Phrases | One phrase per section, in **key-relative degrees** (`0:m 8:maj 3:maj 10:maj`), repeats merged, loops reduced to one cycle, max 16 chords. Duplicate phrases within a song are dropped. |
| Moods | Weak labels: exact match against the harmony engine's curated mood patterns (`pattern`), else harmonic-feature + genre rules (`rule`). |
| Splits | 90/5/5 by artist — no artist appears in two splits. Each identical phrase is capped at 50 copies so stock loops can't dominate. |

Outputs `data/processed/{train,val,test}.jsonl.gz`, `vocab.json` (shared with
training and serving), and `stats.json`.

## Chord model

`chordcraft/model` — a decoder-only transformer written from scratch in PyTorch
(RMSNorm pre-norm blocks, causal attention with rotary embeddings, SwiGLU,
tied embeddings; 14.3M parameters). Sequences are
`<bos> mode genre mood len:N` followed by key-relative chord tokens; loss is on
chords + EOS only. Training uses mood-balanced sampling and 30% conditioning
dropout so the same model runs with or without a mood/genre.

Sampling is constrained so every output is valid: exact requested length, no
immediate repeats, optional no-diminished / diatonic-only. Outputs are degrees,
spelled into any key with `spell_degrees`.

```bash
uv sync --extra ml
uv run python -m chordcraft.model.train --data data/processed --out runs/v1          # local (MPS/CPU)
kaggle kernels push -p kaggle --accelerator NvidiaTeslaT4                           # free cloud GPU
uv run python -m chordcraft.model.evaluate --ckpt runs/v1/best.pt --data data/processed
```

### v1 results ([full report](results/chord-transformer-v1/eval.json))

3 epochs on a Kaggle Tesla T4 (8,292 steps, 72 min, $0). **Test perplexity 4.12**
over a 300-chord vocabulary (artist-disjoint test split, 77k phrases).

1,800 progressions per generator (9 moods × 200, half major / half minor, lengths 4 and 8):

| Generator | Valid | Mood control | Novelty | Distinct-2 | Diatonic | Ends on I/V |
| --------- | ----- | ------------ | ------- | ---------- | -------- | ----------- |
| **Chord transformer** | 100% | **82.4%** | 46.9% | **0.114** | 80.7% | **55.3%** |
| Same model, no mood token | 100% | 10.9% | 34.8% | 0.073 | 87.4% | 56.2% |
| Rule engine (baseline) | 100% | 63.2% | 81.0% | 0.090 | 81.2% | 51.2% |
| **Chord transformer + guidance (w=2) + presence penalty** | 100% | **90.4%** | **51.1%** | **0.133** | 76.3% | 57.1% |

The guided row ([report](results/chord-transformer-v1-cfg/eval.json)) is how the app decodes:
classifier-free guidance compares each step with a `mood:any` prompt and pushes away from it,
lifting the weakest moods (aggressive 64% → 96%, romantic 68% → 79%) without losing
diversity. A re-run of the unguided model with sampling dropout correctly disabled
([report](results/chord-transformer-v1-fixed/eval.json)) gives 83.0% mood control — the
original Kaggle evaluation accidentally sampled with dropout on (fixed in `evaluate.py`).

How to read it:
- **Mood control** = share of outputs whose weak mood label matches the
  requested mood. Chance is ~11% (the unconditioned row). The model was trained
  on that same labeler's output, so this shows the conditioning works — it is
  not a human judgement of mood.
- **Novelty** = share of outputs that never appear in the training set. The
  model writes new progressions about half the time; the rule engine's curated
  patterns with substitutions are mostly unseen in real songs, which also means
  they are less typical of them.
- **Oscillation fix:** raw sampling at length 8 produced an immediately
  repeated block (e.g. ii7–iii7–ii7–iii7) in 53.6% of outputs. Decode-time loop
  blocking plus a 0.3 presence penalty brings that to 0% and raises distinct
  chords per 8-chord phrase from 4.26 to 4.88 (360 samples, 9 moods × 2 modes).

## Publishing & in-browser inference

The model is on the Hub at
[ckeen302/chordcraft-chord-transformer](https://huggingface.co/ckeen302/chordcraft-chord-transformer)
(safetensors + config + vocab + model card + ONNX).

```bash
uv run --extra ml python -m chordcraft.model.hub export --ckpt runs/kaggle_v1/v1/best.pt \
    --results results/chord-transformer-v1 --out dist/chord-transformer
uv sync --extra ml --group export
uv run --extra ml --group export python -m chordcraft.model.onnx_export --model dist/chord-transformer --data data/processed
uv run --extra ml python scripts/publish_hf.py model
```

ONNX parity on 512 real validation prefixes:

| Export | Size | Top-1 agreement with PyTorch | Mean KL | Max logit diff |
| ------ | ---- | ---------------------------- | ------- | -------------- |
| fp32 | 58.0 MB | 100% | 0.0 | 1e-5 |
| int8 (dynamic) | 15.1 MB | 98.2% | 0.0005 | 0.31 |

The web app loads the int8 model with ONNX Runtime Web and runs the same
constrained decoder, ported to TypeScript (`lib/ai/sampler.ts`), so the live
site needs no inference server. `scripts/publish_hf.py space` can also deploy
this API as a Docker Space, but Hugging Face now requires a PRO plan for
Docker Spaces, so the deployed app uses in-browser inference instead.

## Checks

```bash
uv run pytest -q
uv run ruff check .
```
