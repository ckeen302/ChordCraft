# ChordCraft — Progression Studio

A chord-progression generator with pro-quality sampled playback, a real-time MIDI piano roll, and one-click MIDI export. Built with Next.js 15, TypeScript, Tone.js, and Tailwind.

## Features

- **AI · Chord Transformer** — progressions written by a 14M-parameter transformer trained from scratch in PyTorch on 1.4M real-song progressions, steered by mood and length, served by the FastAPI backend. Every chord is spelled, voice-led, and analysed by the theory engine; when the backend is offline the generator falls back to the rule-based engine below. Model, data, and evaluation: [backend/README.md](backend/README.md).
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

To enable the AI mode locally, run the backend too (see [backend/README.md](backend/README.md)) —
the app looks for it at `NEXT_PUBLIC_API_URL` (default `http://localhost:8000`; copy `.env.example`):

```bash
cd backend && uv sync --extra ml && uv run uvicorn chordcraft.api.main:app --port 8000
```

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
  data/              Popular-song progressions (87 songs), VST preset library
backend/             FastAPI service + Python port of the theory engine (see backend/README.md)
fixtures/theory.json Golden outputs pinning the TypeScript and Python engines together
```

## Roadmap — AI rebuild

ChordCraft is being rebuilt into an AI chord-progression generator:

- **Chord model** — a custom decoder-only transformer written in PyTorch, trained on open chord datasets with mood/key/tempo control tokens and constrained decoding (only valid, in-key chords can be sampled).
- **LLM copilot** — a fine-tuned open model (Llama / Qwen, LoRA via Hugging Face PEFT + TRL) that turns natural-language requests into tool calls: generate, edit, analyze, search.
- **RAG** — sentence-transformer embeddings + FAISS over the song library for "sounds like…" requests.
- **Backend** — FastAPI with streaming responses; the theory engine validates and repairs every model output.
- **Evals** — rule engine vs. chord model vs. LLM-only, scored on validity, key adherence, and cadence quality.
- **Infra** — training on Modal and Kaggle GPUs, experiment tracking with W&B, models on the Hugging Face Hub, CI on GitHub Actions.
