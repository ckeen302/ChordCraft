/**
 * Sample-based audio engine for ChordCraft (built on Tone.js).
 *
 * Real recorded multisamples drive the acoustic instruments (piano, guitar,
 * organ, strings, brass, harp, bass, bells) via Tone.Sampler, which pitch-
 * shifts between a handful of sampled pitches. The three inherently electronic
 * voices (Electric Piano, Pad, Synth Lead) use tuned Tone synths — an FM Rhodes
 * for the EP, a detuned-saw pad, and a filtered saw lead.
 *
 * Signal chain:  instrument → shared Reverb → Compressor → master Gain → out
 *
 * Public API (unchanged, consumed by hooks/useTransport + ChordCard + metronome):
 *   ensureAudioReady, switchInstrument, playChord, stopAllNotes, setVolume,
 *   getCtx, playMetronomeClick
 */
import type * as Tone from 'tone'
import type { InstrumentName } from '@/types'

// Tone is loaded via dynamic import (like @tonejs/midi) — a static
// `import * as Tone` breaks Next's webpack named-export analysis, and this
// also keeps Tone out of the initial bundle. `T` holds the loaded module;
// ensureAudioReady() populates it before any synchronous audio call runs.
let T: typeof import('tone') | null = null
async function loadTone(): Promise<typeof import('tone')> {
  if (!T) {
    // Depending on how the bundler resolves Tone (ESM vs UMD), the classes may
    // live on the namespace or under `.default`. Pick whichever has them.
    // Tone resolves to its UMD build here, whose ESM-import namespace comes
    // back empty — but importing it populates `window.Tone` with the full API.
    // Prefer the namespace/default if present, else fall back to the global.
    const mod = await import('tone')
    const anyMod = mod as unknown as { Reverb?: unknown; default?: typeof import('tone') }
    const fromGlobal = (globalThis as unknown as { Tone?: typeof import('tone') }).Tone
    T = anyMod.Reverb ? mod : (anyMod.default?.Reverb ? anyMod.default : fromGlobal ?? mod)
  }
  return T
}

// ─── Sample library ───────────────────────────────────────────────────────────
// nbrosowsky.github.io/tonejs-instruments — filenames use 's' for sharps
// (Ds3 = D#3). Only a sparse set of pitches is needed; Tone.Sampler interpolates.

const BASE = 'https://nbrosowsky.github.io/tonejs-instruments/samples/'

interface SamplerSpec {
  dir:      string
  urls:     Record<string, string>
  release?: number
  /** Relative level in dB when layering (e.g. keep trumpet under french-horn). */
  volume?:  number
}

const SAMPLE_SPECS: Partial<Record<InstrumentName, SamplerSpec[]>> = {
  Piano: [{
    dir: 'piano', release: 1.4,
    urls: {
      C2: 'C2.mp3', C3: 'C3.mp3', C4: 'C4.mp3', C5: 'C5.mp3', C6: 'C6.mp3',
      A2: 'A2.mp3', A3: 'A3.mp3', A4: 'A4.mp3', A5: 'A5.mp3',
      'D#3': 'Ds3.mp3', 'F#4': 'Fs4.mp3',
    },
  }],
  Organ: [{
    dir: 'organ', release: 0.5,
    urls: {
      C3: 'C3.mp3', C4: 'C4.mp3', C5: 'C5.mp3', C6: 'C6.mp3', A4: 'A4.mp3',
      'F#2': 'Fs2.mp3', 'F#3': 'Fs3.mp3', 'F#4': 'Fs4.mp3', 'F#5': 'Fs5.mp3',
    },
  }],
  Guitar: [{
    dir: 'guitar-acoustic', release: 1.0,
    urls: {
      C3: 'C3.mp3', C4: 'C4.mp3', C5: 'C5.mp3',
      A2: 'A2.mp3', A3: 'A3.mp3', A4: 'A4.mp3',
      D2: 'D2.mp3', D3: 'D3.mp3', E2: 'E2.mp3', F3: 'F3.mp3', G4: 'G4.mp3',
      'D#2': 'Ds2.mp3',
    },
  }],
  // Ensemble = cello (body) layered with violin (upper), for a lush string pad.
  Strings: [
    {
      dir: 'cello', release: 1.8,
      urls: {
        C2: 'C2.mp3', C3: 'C3.mp3', C4: 'C4.mp3', A2: 'A2.mp3', A3: 'A3.mp3',
        E2: 'E2.mp3', E3: 'E3.mp3', G2: 'G2.mp3', G3: 'G3.mp3', 'A#2': 'As2.mp3',
      },
    },
    {
      dir: 'violin', release: 1.8, volume: -5,
      urls: {
        C4: 'C4.mp3', C5: 'C5.mp3', C6: 'C6.mp3', A3: 'A3.mp3', A4: 'A4.mp3',
        A5: 'A5.mp3', E4: 'E4.mp3', E5: 'E5.mp3', G3: 'G3.mp3', G4: 'G4.mp3', G5: 'G5.mp3',
      },
    },
  ],
  Bass: [{
    dir: 'bass-electric', release: 0.8,
    urls: { 'A#1': 'As1.mp3', 'C#2': 'Cs2.mp3', E2: 'E2.mp3', G2: 'G2.mp3' },
  }],
  Harp: [{
    dir: 'harp', release: 1.8,
    urls: {
      C3: 'C3.mp3', E3: 'E3.mp3', G3: 'G3.mp3', B3: 'B3.mp3',
      D4: 'D4.mp3', F4: 'F4.mp3', A4: 'A4.mp3', C5: 'C5.mp3',
    },
  }],
  Bell: [{
    dir: 'xylophone', release: 2.0,
    urls: {
      C5: 'C5.mp3', C6: 'C6.mp3', C7: 'C7.mp3', C8: 'C8.mp3',
      G4: 'G4.mp3', G5: 'G5.mp3', G6: 'G6.mp3', G7: 'G7.mp3',
    },
  }],
  // Section = french-horn (warm core) layered with a quieter trumpet (edge).
  Brass: [
    {
      dir: 'french-horn', release: 0.6,
      urls: {
        C2: 'C2.mp3', C4: 'C4.mp3', A1: 'A1.mp3', A3: 'A3.mp3',
        D3: 'D3.mp3', F3: 'F3.mp3', G2: 'G2.mp3',
      },
    },
    {
      dir: 'trumpet', release: 0.6, volume: -9,
      urls: { C4: 'C4.mp3', A3: 'A3.mp3', D5: 'D5.mp3', F3: 'F3.mp3', F4: 'F4.mp3', G4: 'G4.mp3' },
    },
  ],
}

const SYNTH_SET = new Set<InstrumentName>(['Electric Piano', 'Pad', 'Synth Lead'])

// ─── Triggerable voice type (both Sampler and PolySynth satisfy this) ─────────

type Voice = Tone.Sampler | Tone.PolySynth
interface LoadedInstrument {
  sources: Voice[]
  extras:  Tone.ToneAudioNode[]   // in-chain nodes (filters) kept for lifetime
}

// ─── Singleton state ──────────────────────────────────────────────────────────

let _master:    Tone.Gain | null       = null
let _comp:      Tone.Compressor | null = null
let _reverb:    Tone.Reverb | null     = null
let _metroGain: Tone.Gain | null       = null
/** Always-ready synth voice that covers while an instrument's samples stream. */
let _fallback:  LoadedInstrument | null = null

let _currentInstrument: InstrumentName = 'Piano'
let _volume = 0.8

const _players = new Map<InstrumentName, LoadedInstrument>()
const _loading = new Map<InstrumentName, Promise<void>>()

// ─── Master chain ─────────────────────────────────────────────────────────────

function ensureMaster(): void {
  if (_master || !T) return
  _reverb = new T.Reverb({ decay: 2.4, preDelay: 0.01, wet: 0.22 })
  _comp   = new T.Compressor({ threshold: -18, ratio: 4, attack: 0.003, release: 0.25 })
  _master = new T.Gain(_volume)

  _reverb.connect(_comp)
  _comp.connect(_master)
  _master.toDestination()

  // Metronome bypasses the master volume so the click stays audible.
  _metroGain = new T.Gain(0.9).connect(_comp)
}

// ─── Instrument construction ──────────────────────────────────────────────────

function makeSampler(spec: SamplerSpec): Promise<Tone.Sampler> {
  return new Promise((resolve, reject) => {
    const s = new T!.Sampler({
      urls:    spec.urls,
      baseUrl: `${BASE}${spec.dir}/`,
      release: spec.release ?? 1,
      onload:  () => resolve(s),
      // Without this a single 404 leaves the promise pending forever.
      onerror: (e) => { s.dispose(); reject(e) },
    })
    if (spec.volume !== undefined) s.volume.value = spec.volume
  })
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('sample load timeout')), ms))
}

function buildSynth(name: InstrumentName): LoadedInstrument {
  const reverb = _reverb!
  let source: Tone.PolySynth
  const extras: Tone.ToneAudioNode[] = []

  if (name === 'Electric Piano') {
    // FM Rhodes — the classic electric-piano synthesis model.
    source = new T!.PolySynth(T!.FMSynth, {
      harmonicity: 3, modulationIndex: 11,
      oscillator: { type: 'sine' },
      envelope:   { attack: 0.008, decay: 1.1, sustain: 0.12, release: 1.2 },
      modulation: { type: 'sine' },
      modulationEnvelope: { attack: 0.01, decay: 0.4, sustain: 0, release: 0.3 },
    })
    source.connect(reverb)
  } else if (name === 'Pad') {
    source = new T!.PolySynth(T!.Synth, {
      oscillator: { type: 'fatsawtooth', count: 3, spread: 32 },
      envelope:   { attack: 0.7, decay: 0.4, sustain: 0.85, release: 2.6 },
    })
    const filt = new T!.Filter({ type: 'lowpass', frequency: 1100, Q: 0.6 })
    source.connect(filt); filt.connect(reverb); extras.push(filt)
  } else {
    // Synth Lead
    source = new T!.PolySynth(T!.Synth, {
      oscillator: { type: 'sawtooth' },
      envelope:   { attack: 0.02, decay: 0.2, sustain: 0.6, release: 0.4 },
    })
    const filt = new T!.Filter({ type: 'lowpass', frequency: 3200, Q: 1.2 })
    source.connect(filt); filt.connect(reverb); extras.push(filt)
  }

  source.volume.value = -6
  return { sources: [source], extras }
}

/**
 * The instrument (or the fallback synth) to trigger right now. Samplers take
 * seconds to stream from the CDN on first use — rather than dropping notes
 * silently until then (feels like "instruments don't work"), an FM-piano
 * fallback sounds immediately and hands over once the real samples arrive.
 */
function currentVoice(): LoadedInstrument | null {
  const loaded = _players.get(_currentInstrument)
  if (loaded) return loaded
  if (!_fallback && T) _fallback = buildSynth('Electric Piano')
  return _fallback
}

async function buildInstrument(name: InstrumentName): Promise<void> {
  ensureMaster()

  if (SYNTH_SET.has(name)) {
    _players.set(name, buildSynth(name))
    return
  }

  const specs = SAMPLE_SPECS[name]
  if (!specs) { _players.set(name, buildSynth('Pad')); return }

  const all = Promise.all(specs.map(makeSampler))
  const install = (samplers: Tone.Sampler[]) => {
    if (_players.has(name)) { samplers.forEach(s => s.dispose()); return }
    for (const s of samplers) s.connect(_reverb!)
    _players.set(name, { sources: samplers, extras: [] })
  }
  try {
    install(await Promise.race([all, timeout(12_000)]))
  } catch {
    // Slow or failed download: nothing is cached, so the fallback voice covers
    // for now, a slow download still installs when it lands, and a failed one
    // is retried on the next Play or instrument switch.
    all.then(install, () => {})
  }
}

function loadInstrument(name: InstrumentName): Promise<void> {
  if (_players.has(name)) return Promise.resolve()
  const inflight = _loading.get(name)
  if (inflight) return inflight
  const p = buildInstrument(name).finally(() => _loading.delete(name))
  _loading.set(name, p)
  return p
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function ensureAudioReady(instrument: InstrumentName): Promise<void> {
  if (typeof window === 'undefined') return
  const Tone = await loadTone()
  ensureMaster()
  _currentInstrument = instrument
  // Start fetching samples immediately, in parallel with the context resume,
  // so a slow/pending resume never blocks the download.
  const loading = loadInstrument(instrument)
  // Tighten trigger latency (Tone defaults to a 100 ms lookAhead).
  try { Tone.getContext().lookAhead = 0.05 } catch { /* keep default */ }
  await Tone.start().catch(() => {})   // resume AudioContext (needs user gesture)
  // Never hold Play hostage to sample streaming: a barely-perceptible grace,
  // then start — the fallback synth voice covers until the samples arrive.
  await Promise.race([loading, new Promise(res => setTimeout(res, 50))])
}

export async function switchInstrument(instrument: InstrumentName): Promise<void> {
  if (typeof window === 'undefined') return
  _currentInstrument = instrument
  // Eagerly load the Tone module and this instrument's samples (neither needs
  // a user gesture — only the AudioContext resume does). The transport calls
  // this on mount and on every instrument change, so by the time Play is
  // pressed the sound is typically already in memory and starts instantly.
  await loadTone().catch(() => {})
  if (!T) return
  ensureMaster()
  await loadInstrument(instrument)
}

/**
 * Strum/roll spread between note onsets, in ms. Moods set this for
 * articulation: harp-like rolls for dreamy/romantic, tight stabs for metal.
 */
let _rollMs = 12
export function setChordRoll(ms: number): void {
  _rollMs = Math.max(0, Math.min(120, ms))
}
export function getChordRoll(): number {
  return _rollMs
}

/**
 * Play a single note `whenSec` seconds from now, velocity-sensitive.
 * The note-level counterpart of playChord, used by the transport scheduler —
 * no root doubling or strum here; the scheduler applies those per note group.
 */
export function playNote(
  midi: number,
  durationSec: number,
  whenSec = 0,
  velocity = 0.8,
): void {
  if (typeof window === 'undefined' || !T) return
  ensureMaster()
  const loaded = currentVoice()
  if (!loaded) return
  const t = T.now() + Math.max(0, whenSec)
  const name = T.Frequency(midi, 'midi').toNote()
  const vel = Math.max(0.05, Math.min(1, velocity))
  for (const src of loaded.sources) {
    try { trigger(src, name, Math.max(0.05, durationSec), t, vel) } catch { /* voice busy */ }
  }
}

/**
 * Play a chord. Notes are MIDI numbers. The chord root is doubled one octave
 * below (except Bass) for a fuller foundation, and onsets are staggered by
 * the current roll amount for a natural, played-by-hands feel.
 */
export function playChord(notes: number[], durationSec: number): void {
  if (typeof window === 'undefined' || !notes.length || !T) return
  ensureMaster()
  const loaded = currentVoice()
  if (!loaded) return

  let midis: number[]
  if (_currentInstrument === 'Bass') {
    midis = [notes[0] - 12]                 // bass plays the root, an octave down
  } else {
    midis = [notes[0] - 12, ...notes]       // double root below the voicing
  }

  const dur   = Math.max(0.1, durationSec)
  const start = T.now()
  const noteNames = midis.map(m => T!.Frequency(m, 'midi').toNote())

  for (const src of loaded.sources) {
    noteNames.forEach((nn, i) => {
      try { trigger(src, nn, dur, start + i * (_rollMs / 1000)) } catch { /* voice busy */ }
    })
  }
}

/**
 * Start a note and schedule its end. Sampler.triggerAttackRelease forgets the
 * note as soon as it's scheduled, so releaseAll (Stop/Pause) couldn't cut it
 * off — sampled chords rang out for their whole length after Stop. Attacking
 * and scheduling the stop on the source ourselves keeps it releasable.
 */
function trigger(src: Voice, note: string, dur: number, t: number, vel?: number): void {
  if (T && src instanceof T.Sampler) {
    src.triggerAttack(note, t, vel)
    const active = (src as unknown as { _activeSources?: Map<number, { stop(time: number): void }[]> })._activeSources
    const list = active?.get(Math.round(T.Frequency(note).toMidi()))
    const source = list?.[list.length - 1]
    if (source) source.stop(t + dur)
    else src.triggerRelease(note, t + dur)
    return
  }
  src.triggerAttackRelease(note, dur, t, vel)
}

export function stopAllNotes(): void {
  if (!T) return
  const t = T.now()
  const all = [..._players.values(), ...(_fallback ? [_fallback] : [])]
  for (const loaded of all) {
    for (const src of loaded.sources) {
      try { src.releaseAll(t) } catch { /* nothing sounding */ }
    }
  }
}

export function setVolume(value: number): void {
  // Store the level unconditionally; the master chain reads _volume when it's
  // first built (ensureMaster), so a pre-init call still takes effect on Play.
  _volume = Math.max(0, Math.min(1, value))
  if (_master) _master.gain.rampTo(_volume, 0.05)
}

// ─── Metronome support (used by lib/audio/metronome.ts) ───────────────────────

/**
 * Load Tone (if needed), resume the AudioContext, and build the master chain.
 * Safe to call from any user gesture — used by the metronome, which may be
 * toggled before the first Play.
 */
export function warmUpAudio(): void {
  if (typeof window === 'undefined') return
  loadTone().then((Tone) => {
    Tone.start().catch(() => {})
    ensureMaster()
  }).catch(() => {})
}

export function getCtx(): AudioContext | null {
  if (!T) return null
  ensureMaster()
  return T.getContext().rawContext as unknown as AudioContext
}

export function playMetronomeClick(isAccent: boolean): void {
  if (typeof window === 'undefined') return
  if (!T) { warmUpAudio(); return }   // not ready yet — this click is silent
  ensureMaster()
  if (!_metroGain) return
  const now   = T.now()
  const freq  = isAccent ? 1600 : 800
  const level = isAccent ? 0.35 : 0.20

  const osc = new T.Oscillator(freq, 'sine')
  const g   = new T.Gain(0).connect(_metroGain)
  osc.connect(g)
  g.gain.setValueAtTime(level, now)
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.03)
  osc.start(now)
  osc.stop(now + 0.05)
  setTimeout(() => { try { osc.dispose(); g.dispose() } catch { /* already disposed */ } }, 300)
}
