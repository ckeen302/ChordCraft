# ChordCraft

ChordCraft writes chord progressions. You can describe what you want in plain English ("sad lo-fi in A minor, 8 chords") and it puts the chords into a piano roll that you can play, edit, and export as MIDI. The chords come from a small transformer model I trained from scratch, and it runs in the browser.

Live site: https://chord-craft-live.vercel.app

![Typing "sad lo-fi in A minor, 8 chords" into Chord Chat, then "make it darker"](docs/demo.gif)

## How it works

The model is a 14.3M-parameter decoder-only transformer written in PyTorch. It was trained on [Chordonomicon](https://huggingface.co/datasets/ailsntua/Chordonomicon), a dataset of about 680k songs' chord charts. The dataset has no key labels, so the data pipeline estimates each song's key and stores every phrase as scale degrees relative to that key instead of as chord names. That way "vi IV I V" is one pattern rather than twelve, and the output can be spelled in any key afterwards. Each training sequence starts with mode, genre, mood, and length tokens, so you can ask for a mood and a length.

Training took 72 minutes on a free Kaggle T4. The weights are on the Hugging Face Hub at [ckeen302/chordcraft-chord-transformer](https://huggingface.co/ckeen302/chordcraft-chord-transformer), along with an int8 ONNX export. The website downloads that ONNX file once and runs it with ONNX Runtime Web, so there is no inference server to pay for or wait on. A progression takes about 0.4 s.

The decoder is constrained so every output is usable. It enforces the exact length you asked for, blocks immediate repeats, and blocks short loops. Mood is steered with classifier-free guidance: the model was trained with the mood token dropped 30% of the time, and while decoding it compares each step against a "no mood" prediction and pushes away from it. The decoder was written in Python first and then ported to TypeScript (`lib/ai/sampler.ts`).

After the model picks scale degrees, a theory engine spells the chords in the chosen key, voices them, and labels them with roman numerals. The same engine exists in TypeScript (`lib/theory`) and Python (`backend/chordcraft/theory`). Both have to produce the same output for about 500 shared test cases in `fixtures/theory.json`.

Chord Chat parses the request in the browser (mood words, styles like lo-fi or trap, key, length, tempo, instrument). Follow-ups like "darker", "jazzier", "longer", or "up a step" change the previous request.

There is also an optional FastAPI service in `backend/` that serves the theory engine, server-side generation, and the Preset Finder database. Details are in [backend/README.md](backend/README.md).

## Results

These come from `backend/results/` and are explained in more detail in [backend/README.md](backend/README.md).

- Test perplexity: 4.12 over a 300-chord vocabulary, on a test split with no artists shared with training.
- Mood control: 90.4% with guidance, compared to 63.2% for the older rule-based generator (1,800 progressions each, 9 moods; chance is about 11%). The mood labels come from a rule-based labeler, and the model was trained on that labeler's output, so this shows that the mood conditioning works. It doesn't show that people would hear the mood.
- Browser model: the int8 ONNX file is 15 MB and picks the same top token as the PyTorch model 98.2% of the time (512 validation prefixes).
- Repeated loops: before loop blocking, 53.6% of 8-chord outputs repeated a block right away (like ii7 iii7 ii7 iii7). With loop blocking and a presence penalty it is 0%.

## Other parts of the app

- Smart Generate, a rule-based generator with 9 moods, plus fully random and fixed templates (I V vi IV, ii V I).
- A piano roll where every note can be drawn, moved, resized, and given its own velocity.
- 11 sampled instruments through Tone.js, with loop, metronome, and BPM from 40 to 240.
- MIDI export, undo/redo, transpose, saved progressions, and a short harmonic analysis of each progression.
- Popular Songs: 87 progressions from well-known songs with their real key and tempo.
- Preset Finder: 832 "what preset is that sound?" identifications from r/findthepreset, YouTube, and the web. They live in SQLite with full-text search. A weekly GitHub Action looks for new solved threads and opens a pull request with them.

## Running it

```bash
npm install
npm run dev      # http://localhost:3000
```

No API keys are needed. The model downloads from Hugging Face the first time you use it.

Other commands: `npm test` (Vitest), `npm run type-check`, `npm run lint`, and `npm run build`. Don't run `npm run build` while the dev server is running, because both write to `.next/`.

The Python side (data pipeline, training, evaluation, and the API) uses uv:

```bash
cd backend
uv sync
uv run uvicorn chordcraft.api.main:app --reload   # http://localhost:8000/docs
uv run pytest -q
```

CI runs the web and backend checks on every push.

## Repo layout

```
app/, components/   Next.js UI (Chord Lab, piano roll, transport bar)
hooks/, store/      Playback scheduler and Zustand state
lib/ai/             ONNX model loader and the TypeScript decoder
lib/chat/           Chord Chat request parser
lib/theory/         Chord parsing, keys, rule-based generator, analysis
lib/audio/, lib/midi/  Tone.js playback and MIDI export
backend/            Data pipeline, PyTorch model, evaluation, FastAPI service
fixtures/           Shared test cases for the TypeScript and Python theory engines
```

## License

The code is MIT. The model was trained on Chordonomicon, which is CC BY-NC 4.0, so the model weights are for non-commercial use only.
