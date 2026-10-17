/**
 * Turn chord-transformer samples into playable progressions — the same theory
 * pipeline the rule engine uses: spell in the key, apply the mood's harmonic
 * rhythm, voice-lead, and label roman numerals.
 */
import type { InstrumentName, ParsedChord } from '@/types'
import { parseChordStrict } from '@/lib/theory/chords'
import { moodVibe, spellDegrees, type Mood } from '@/lib/theory/harmony'
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
}

export async function generateWithModel(
  model: { vocab: Vocab; logits: LogitsFn },
  { key, mood, length, excludeDiminished = false, seed }: AiRequest,
): Promise<AiResult> {
  const mode = key.endsWith('Minor') ? 'minor' : 'major'
  const [best] = await sampleProgressions(model.logits, model.vocab, {
    mode, length, mood, excludeDiminished, candidates: 4,
    rng: seed === undefined ? Math.random : seededRng(seed),
  })
  const vibe = moodVibe(mood)
  const parsed = spellDegrees(key, best.degrees).map((symbol, i) => ({
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
