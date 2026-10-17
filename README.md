# ChordCraft — Progression Studio

A chord-progression generator with pro-quality sampled playback, a real-time MIDI piano roll, and one-click MIDI export. Built with Next.js 15, TypeScript, Tone.js, and Tailwind.

## Features

- **AI · Chord Transformer** — progressions written by a 14M-parameter transformer trained from scratch in PyTorch on 1.4M real-song progressions, steered by mood and length. It runs **in the browser**: the int8 ONNX export (15 MB, [on the Hugging Face Hub](https://huggingface.co/ckeen302/chordcraft-chord-transformer)) executes in ONNX Runtime Web with constrained decoding ported to TypeScript (~0.4 s per progression, no server). Every chord is spelled, voice-led, and analysed by the theory engine. Model, data, and evaluation: [backend/README.md](backend/README.md).
- **Chord Chat** — describe what you want in plain English ("sad lo-fi in A minor, 8 chords", "epic trailer", "smooth jazz on rhodes") and the chord transformer writes it straight into the piano roll as MIDI, with a reply explaining the harmony. Refine it conversationally: "darker", "jazzier", "longer", "faster", "up a step", "make bar 3 more surprising", "another one". Requests are parsed in the browser (moods and synonyms, style presets like lo-fi/trap/punk, keys, length, tempo, instrument).
- **AI copilot (opt-in)** — a small instruct LLM running **in your browser** (Transformers.js on WebGPU, WASM fallback) reads free-form requests like "something like Radiohead's bridges but brighter" or "a rainy-day coffee shop vibe" and answers with a JSON tool call (`generate`, `adjust`, `transpose`, `reharmonize`, `help`, `clarify`) validated against a JSON Schema before anything runs. One-chord edits ("make bar 3 more surprising") re-sample just that slot from the chord transformer, conditioned on the chords before it. If the model is slow, crashes, or produces an invalid call, the rules parser answers instead; each reply says which one handled it. See [LLM copilot](#llm-copilot).
- **Mood-true AI output** — classifier-free guidance (mood control 83% → 90%), keys that follow the mood (melancholic in C plays in C minor), and a mood colouring layer that gives the model's chords each mood's signature extensions.
- **Smart Generate** — a mood-driven harmony engine. Defaults to **Random**, rolling a fresh mood on every generate (shown as a badge, e.g. "🎲 Nostalgic"); pin one of the 9 moods (Uplifting, Melancholic, Dreamy, Romantic, Nostalgic, Tense, Jazz, Epic, Aggressive) to repeat it instead. Each blends signature progressions from real repertoire (doo-wop changes, ii–V–I turnarounds, the minor axis, sad-pop loops) with a weighted Markov chain over functional harmony, plus mood-specific cadences and chord extensions.
- **Fully Random & Classic Templates** — pure-chance diatonic progressions, or fixed patterns like I–V–vi–IV and ii–V–I.
- **Real sampled instruments** — 11 voices played from recorded multisamples via Tone.js (grand piano, acoustic guitar, organ, layered string/brass ensembles, harp, bass, bells) with an FM electric piano, pad, and lead. Root-octave doubling and humanized note onsets.
- **FL Studio–style piano roll** — a real note editor, not just a chord grid: every note has its own start, length, and velocity. Pencil-draw on empty cells, drag to move (whole selection follows), drag a note's right edge to resize, right-click to erase, ⌘drag for box selection, ⌘A/⌘C/⌘X/⌘V and ⌘B (duplicate right), Delete key, snap grid (1/4 · 1/2 · 1 · off), horizontal zoom, a velocity lane with draggable bars, full C1–B7 pitch range with scroll, and a beat-accurate playhead. Chord columns relabel themselves via chord detection as you edit, and playback follows edits live.
- **Popular Songs library** — 87 research-verified progressions with the record's real key, tempo, and per-chord harmonic rhythm.
- **Transport** — play/pause/stop (Space), loop, transport-tied metronome (M), live BPM 40–240, beats-per-chord, volume.
- **Export** — standards-compliant `.mid` files (correct tempo, beats-per-chord, and General MIDI program for the selected instrument), or copy the progression as text.
- **Undo / Redo** — every edit (generate, note edits, deletions, transpose) is undoable via buttons or ⌘Z / ⇧⌘Z.
- **Transpose** — shift the whole progression ±1 semitone; voicings, rhythm, and roman numerals survive, and the key select follows (all 24 keys covered).
- **Harmonic analysis** — an instant rule-based breakdown of every progression (cadence type, borrowed chords, named devices like the Phrygian bII or the IV→iv "saddest move").
- **Robust chord parsing** — 24 chord qualities including extended and altered chords (maj9, m11, 13, m7b5, 7♭9, 7♯9), common notations (Δ, ø, °, mM7), and a strict mode that rejects anything it would have to guess at.
- **Saved progressions** — name and keep favourites (exact voicings round-trip), separate from the auto-history of recent generations.
- **Settings** — persisted defaults for BPM, instrument, beats-per-chord, and volume, applied every launch.
- **Preset Finder** — a browsable library of famous VST preset identifications ("what preset is that sound?"), in the spirit of [r/findthepreset](https://www.reddit.com/r/findthepreset/): search, filter by VST, grouped by artist, every entry labelled **Confirmed** (official documentation) or **Community ID** (accepted lore) with a source link. Grow it by appending to `lib/data/presets.ts`.
- **Shortcuts reference** — keyboard icon in the header lists every transport key and piano-roll gesture.
- **No lost work** — both tabs stay live in the background: switch between Generator and Popular Songs without losing your progression, undo history, or selected song. Metronome accents follow each song's meter (3/4, 6/8, 12/8).

## Getting started

```bash
npm install
npm run dev      # http://localhost:3000
```

No configuration or API keys required. Samples stream from a CDN on first play.

The AI mode downloads its model from the Hugging Face Hub on first load — nothing to configure.
The Python side (data pipeline, training, evaluation, and an optional FastAPI service) lives in
[`backend/`](backend/README.md).

## Scripts

| Command              | Purpose                       |
| -------------------- | ----------------------------- |
| `npm run dev`        | Dev server (localhost:3000)   |
| `npm run build`      | Production build              |
| `npm start`          | Serve the production build    |
| `npm run type-check` | TypeScript check              |
| `npm run lint`       | ESLint                        |
| `npm test`           | Vitest unit tests             |

> Note: don't run `npm run build` while a dev server is running — both write to `.next/` and the dev server's chunk manifest gets corrupted (ChunkLoadError). Stop the dev server first, or just rely on `type-check`.

## Architecture

```
app/                 Next.js App Router shell (SSR-safe; audio loads client-side only)
components/
  ChordCraftApp.tsx  Root layout: header, Chord Lab, transport bar
  chord-lab/         Generator UI, chord strip/cards
  piano/PianoRoll.tsx  Real-time MIDI roll
  layout/TransportBar.tsx
hooks/useTransport.ts  Note-level playback: lookahead scheduler over NoteEvents
                       (velocity, exact starts/lengths, loop, live BPM, playhead clock)
store/useStore.ts      Zustand store — pure state, no side effects
lib/
  theory/            Chord parsing, keys, harmony engine (moods, Markov, signatures),
                     transpose, rule-based analysis
  roll/notes.ts      NoteEvent model — chords ⇄ notes conversion, chord windows,
                     per-window chord detection
  audio/             Tone.js sample engine + metronome
  midi/              MIDI export (chord blocks or exact note events)
  ai/                In-browser chord transformer: ONNX Runtime Web loader, constrained
                     sampler (TS port of the Python decoder), theory post-processing,
                     one-slot reharmonization
  chat/              Chord Chat: rules parser, LLM copilot (prompt, tool-call schema +
                     validator, router with fallback), Transformers.js Web Worker, eval set
  data/              Popular-song progressions (87 songs), VST preset library
backend/             FastAPI service + Python port of the theory engine (see backend/README.md)
fixtures/theory.json Golden outputs pinning the TypeScript and Python engines together
```

## LLM copilot

Chord Chat has two interpreters behind one interface (`lib/chat/copilot.ts`):

```
message ─▶ LLM (Web Worker) ─▶ JSON ─▶ normalise ─▶ JSON Schema ─▶ context check ─▶ ParsedRequest ─▶ chord transformer
              │ off / timeout / crash          └───── invalid ─────┐
              └──────────────────────────────▶ rules parser ◀──────┘
```

- **Opt-in, $0, no server.** Nothing downloads until you press *Enable* in the chat panel, which shows the download size up front. Weights stream from the Hugging Face Hub at a pinned revision, run in a Web Worker with [Transformers.js](https://github.com/huggingface/transformers.js), and are cached by the browser. WebGPU when available (q4 weights; q4f16 was tried and produced garbage on some GPUs because of fp16 activation overflow), otherwise WASM on the CPU (q8 weights, slower).
- **Tool-call contract** (`lib/chat/toolcall.ts`): `TOOL_CALL_SCHEMA` is a JSON Schema (draft 2020-12) with enums for every mood, key, genre, instrument and edit intent, integer ranges, and per-tool required fields. Model output is extracted (tolerating code fences and chatter), normalised (case, synonyms such as "rhodes" → Electric Piano, keys such as "Db minor" → C# Minor, numbers sent as strings, out-of-range tempos clamped), validated, then checked against the current progression (no bar 9 in a 4-chord loop). A bad optional field is dropped with a warning instead of sinking the whole call; a bad tool or a missing required field means the rules parser takes over.
- **Prompt** (`lib/chat/prompt.ts`): a compact system prompt with the vocabularies and the current key, mood, tempo and chords, plus six few-shot examples for stock models. The assistant turn is prefilled with `{"tool": "` so even a 0.5B model goes straight into JSON. Decoding is greedy.
- **Richer edits**: `reharmonize` replaces one chord, steered by an intent (`surprising`, `darker`, `brighter`, `tenser`, `jazzier`, `simpler`, `resolve`) that filters the chord transformer's vocabulary for that slot (`sampleSlot` in `lib/ai/sampler.ts`). The rules parser learned the same edit, so it works without the LLM too. The model's genre tokens (pop, rock, alternative, soul…) are now reachable from chat as well.
- **Tests**: `lib/chat/toolcall.test.ts` (schema, normalisation, salvage, context checks) and `lib/chat/copilot.test.ts` (fallback on invalid JSON, schema violations, impossible edits, crashes and timeouts, using a fake LLM).

### Evaluation and fine-tuning

`npx tsx scripts/eval-copilot.ts <repo> <revision>` runs a model through the browser's exact prompt and validator on 30 held-out requests (`lib/chat/eval/cases.ts`) on the CPU, and scores valid calls, exact calls and per-field accuracy.

COPILOT_EVAL_TABLE

The stock 0.5B model often picks the wrong tool or invents values (`"mood": "jazzier"`, `"tool": "increase bpm"`), so the copilot is fine-tuned with LoRA on synthetic chats:

- **Data** (`scripts/copilot-data.ts`): 6,000 chats in exactly the format the browser sends (random current key, mood and progression), built from templates and lexicons (scenes, ~40 artists mapped to moods and genres, mood/instrument synonyms, transposition intervals, bar references, off-topic questions, casual phrasing). Every label passes `parseToolCall`, and requests in the eval set are excluded.
- **Training** (`backend/kaggle/copilot/train_copilot.py`, Kaggle T4, free): LoRA r=16 on all attention and MLP projections of Qwen2.5-0.5B-Instruct, loss on the assistant JSON only, 2 epochs, then merged into the base weights.
- **Export** (`backend/copilot/export_onnx.py`, a second Kaggle kernel): Optimum ONNX export with KV cache, then 4-bit MatMulNBits (WebGPU) and 8-bit dynamic (WASM) quantization, in the layout Transformers.js loads from the Hub.

## Roadmap — AI rebuild

ChordCraft is being rebuilt into an AI chord-progression generator:

- **Chord model** — ✅ custom decoder-only transformer in PyTorch, trained on Chordonomicon with mode/genre/mood/length control tokens and constrained decoding (v1: test perplexity 4.12, 82% mood control vs 63% for the rule engine).
- **LLM copilot** — ✅ an in-browser LLM (Transformers.js, WebGPU/WASM) that turns natural-language requests into schema-validated tool calls, with the rules parser as fallback; LoRA fine-tune of Qwen2.5-0.5B on synthetic tool-call data (PEFT, Kaggle T4). Next: DPO with the theory engine as the judge, analyze/search tools.
- **RAG** — sentence-transformer embeddings + FAISS over the song library for "sounds like…" requests.
- **Serving** — ✅ in-browser ONNX inference (int8, 15 MB); FastAPI service for the theory engine and server-side generation.
- **Evals** — rule engine vs. chord model vs. LLM-only, scored on validity, key adherence, and cadence quality.
- **Infra** — training on Modal and Kaggle GPUs, experiment tracking with W&B, models on the Hugging Face Hub, CI on GitHub Actions.
