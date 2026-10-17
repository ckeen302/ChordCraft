# ChordCraft

ChordCraft is a web app for writing chord progressions. You pick a mood or just type what you want, like "sad lo-fi in A minor, 8 chords", and it puts the chords in a piano roll where you can play them, tweak them, and export them as MIDI for your DAW.

Try it here: https://chord-craft-live.vercel.app

![Typing a request into Chord Chat and getting chords in the piano roll](docs/demo.gif)

## What it does

- Generate progressions by mood. Pick a key, a mood (uplifting, melancholic, dreamy, jazz, epic, and a few others) and a length, then hit Generate.
- Chord Chat. Describe what you want in plain English. You can follow up with things like "make it darker", "jazzier", "faster", or "up a step" and it updates the progression.
- Piano roll. Every note can be drawn, moved, resized, or deleted, and playback follows your edits.
- Playback and export. 11 sampled instruments, adjustable tempo, loop, metronome, and one-click MIDI export.
- Popular Songs. Chord progressions from well-known songs with their real key and tempo.
- Preset Finder. A searchable list of the synth presets behind famous sounds, collected from r/findthepreset and YouTube.

## How the AI part works

I trained a small transformer model in PyTorch on about 680,000 songs' worth of chord charts. Instead of learning chord names, it learns chords relative to the key (like "the IV chord"), so one pattern works in every key. You can tell it the mood and how many chords you want.

The trained model is exported to ONNX and runs right in your browser, so there's no server involved. It takes well under a second to write a progression. After the model picks the chords, a music theory layer spells them in your key, voices them so they connect smoothly, and labels them with roman numerals.

The model is on Hugging Face: [ckeen302/chordcraft-chord-transformer](https://huggingface.co/ckeen302/chordcraft-chord-transformer). Training details and evaluation numbers are in [backend/README.md](backend/README.md).

## Tech

Next.js, TypeScript, Tailwind, Tone.js, PyTorch, ONNX Runtime Web, FastAPI, SQLite, Vitest, pytest, GitHub Actions.

## Running it locally

```bash
npm install
npm run dev
```

Then open http://localhost:3000. No API keys needed. The model downloads the first time you use it.

The Python side (data pipeline, training, and an optional API) lives in `backend/` and uses uv:

```bash
cd backend
uv sync
uv run pytest -q
```

## License

The code is MIT. The model was trained on the Chordonomicon dataset, which is CC BY-NC 4.0, so the model itself is for non-commercial use.
