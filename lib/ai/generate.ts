/**
 * Turn chord-transformer samples into playable progressions — the same theory
 * pipeline the rule engine uses: mood colouring (signature extensions), spell in
 * the key, apply the mood's harmonic rhythm, voice-lead, label roman numerals.
 */
import type { InstrumentName, ParsedChord } from '@/types'
import { parseChordStrict } from '@/lib/theory/chords'
import { colourDegrees, moodVibe, spellDegrees, type Mood } from '@/lib/theory/harmony'
import { voiceLeadProgression } from '@/lib/theory/voicing'
import { analyzeProgression } from '@/lib/theory/analysis'
import { sampleProgressions, seededRng, type LogitsFn, type Vocab } from './sampler'

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
}

export async function generateWithModel(
  model: { vocab: Vocab; logits: LogitsFn },
  { key, mood, length, excludeDiminished = false, seed, colour = true, resolve = false }: AiRequest,
): Promise<AiResult> {
  const mode = key.endsWith('Minor') ? 'minor' : 'major'
  const rng = seed === undefined ? Math.random : seededRng(seed)
  const ranked = await sampleProgressions(model.logits, model.vocab, {
    mode, length, mood, excludeDiminished, candidates: resolve ? 8 : 4, rng,
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
