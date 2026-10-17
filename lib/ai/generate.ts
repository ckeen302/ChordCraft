/**
 * Turn chord-transformer samples into playable progressions — the same theory
 * pipeline the rule engine uses: mood colouring (signature extensions), spell in
 * the key, apply the mood's harmonic rhythm, voice-lead, label roman numerals.
 */
import type { ChordQuality, InstrumentName, ParsedChord } from '@/types'
import { NOTE_MAP, parseChordStrict } from '@/lib/theory/chords'
import { colourDegrees, moodVibe, spellDegrees, type Mood } from '@/lib/theory/harmony'
import { voiceLeadProgression } from '@/lib/theory/voicing'
import { analyzeProgression } from '@/lib/theory/analysis'
import {
  chordFamily, isDiatonic, sampleProgressions, sampleSlot, seededRng,
  type Degree, type LogitsFn, type Vocab,
} from './sampler'

export interface AiResult {
  chords: ParsedChord[]
  romans: string[]
  patternName: string
  bpm: number
  instrument: InstrumentName
  rollMs: number
}

export interface AiRequest {
  key: string
  mood: Mood
  length: number
  excludeDiminished?: boolean
  seed?: number
  /** Give plain triads the mood's signature extensions (default true). */
  colour?: boolean
  /** Prefer a candidate that ends on the tonic. */
  resolve?: boolean
  /** One of the model's genre tokens (pop, rock, alternative, jazz, soul…); unknown → any. */
  genre?: string
}

export async function generateWithModel(
  model: { vocab: Vocab; logits: LogitsFn },
  { key, mood, length, excludeDiminished = false, seed, colour = true, resolve = false, genre }: AiRequest,
): Promise<AiResult> {
  const mode = key.endsWith('Minor') ? 'minor' : 'major'
  const rng = seed === undefined ? Math.random : seededRng(seed)
  const ranked = await sampleProgressions(model.logits, model.vocab, {
    mode, length, mood, genre, excludeDiminished, candidates: resolve ? 8 : 4, rng,
  })
  // Candidates arrive best-first; "resolve" takes the best one that lands home.
  const best = (resolve && ranked.find(c => c.degrees[c.degrees.length - 1][0] === 0)) || ranked[0]
  const degrees = colour ? colourDegrees(best.degrees, mood, mode === 'minor', rng) : best.degrees
  const vibe = moodVibe(mood)
  const parsed = spellDegrees(key, degrees).map((symbol, i) => ({
    ...parseChordStrict(symbol),
    beats: vibe.rhythm[i % vibe.rhythm.length],
  }))
  const chords = voiceLeadProgression(parsed)
  return {
    chords,
    romans: analyzeProgression(chords, key).romans,
    patternName: 'AI · chord transformer',
    bpm: vibe.bpm,
    instrument: vibe.instrument,
    rollMs: vibe.rollMs,
  }
}

// ─── Editing one chord ───────────────────────────────────────────────────────

export type ReharmIntent = 'surprising' | 'darker' | 'brighter' | 'tenser' | 'jazzier' | 'simpler' | 'resolve'

const TENSE = new Set<ChordQuality>(['7', '7b9', '7#9', 'dim', 'dim7', 'm7b5', 'aug', '7sus4'])
const EXTENDED = new Set<ChordQuality>(['maj7', 'm7', '7', '9', 'maj9', 'm9', '11', 'm11', '13', '6', 'm6', 'm7b5', 'mmaj7'])
const TRIADS = new Set<ChordQuality>(['maj', 'm', 'dim'])

/** Which chords suit each edit, relative to the key. */
export function intentFilter(intent: ReharmIntent, mode: 'major' | 'minor'): (d: Degree) => boolean {
  switch (intent) {
    case 'surprising': return d => !isDiatonic(mode, d)
    case 'darker': return ([, q]) => chordFamily(q) === 'min' || chordFamily(q) === 'dim'
    case 'brighter': return ([, q]) => chordFamily(q) === 'maj' || chordFamily(q) === 'sus'
    case 'tenser': return ([, q]) => TENSE.has(q)
    case 'jazzier': return ([, q]) => EXTENDED.has(q)
    case 'simpler': return d => TRIADS.has(d[1]) && isDiatonic(mode, d)
    case 'resolve': return ([off]) => off === 0
  }
}

/** A chord as a key-relative degree (semitone offset from the tonic, quality). */
export function chordToDegree(chord: ParsedChord, key: string): Degree {
  const tonic = NOTE_MAP[key.split(' ')[0]]
  const root = NOTE_MAP[chord.root]
  if (tonic === undefined || root === undefined) throw new Error(`Can't place ${chord.symbol} in ${key}`)
  return [(root - tonic + 12) % 12, chord.quality]
}

/**
 * Replace the chord at `index` with one the model proposes after reading the
 * chords before it, steered by `intent`. Durations stay; the whole
 * progression is re-voice-led so the new chord connects smoothly.
 */
export async function reharmonizeWithModel(
  model: { vocab: Vocab; logits: LogitsFn },
  { key, mood, genre, chords, index, intent, seed }: {
    key: string; mood: Mood; genre?: string; chords: ParsedChord[]; index: number; intent: ReharmIntent; seed?: number
  },
): Promise<{ chords: ParsedChord[]; romans: string[]; from: string; to: string }> {
  if (index < 0 || index >= chords.length) throw new Error(`There's no bar ${index + 1} — the progression has ${chords.length}.`)
  const mode = key.endsWith('Minor') ? 'minor' : 'major'
  const degrees = chords.map(c => chordToDegree(c, key))
  const current = degrees[index]
  const degree = await sampleSlot(model.logits, model.vocab, {
    mode, mood, genre,
    length: Math.min(16, chords.length),
    prefix: degrees.slice(Math.max(0, index - 15), index),
    exclude: [current, ...(index + 1 < degrees.length ? [degrees[index + 1]] : [])],
    filter: intentFilter(intent, mode),
    temperature: intent === 'surprising' ? 1.2 : 0.9,
    rng: seed === undefined ? Math.random : seededRng(seed),
  })
  const [symbol] = spellDegrees(key, [degree])
  const replaced = chords.map((c, i) => (i === index ? { ...parseChordStrict(symbol), beats: c.beats } : c))
  const voiced = voiceLeadProgression(replaced)
  return { chords: voiced, romans: analyzeProgression(voiced, key).romans, from: chords[index].symbol, to: symbol }
}
