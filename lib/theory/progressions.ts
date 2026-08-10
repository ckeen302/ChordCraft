import { KEYS } from './keys'
import { parseChords } from './chords'
import { voiceLeadProgression } from './voicing'
import {
  generateMoodProgression,
  applySecondaryDominants,
  type Mood,
  type SmartGenerationOptions,
  type MoodGenerationResult,
  MOOD_LABELS,
} from './harmony'
import type { InstrumentName, ParsedChord } from '@/types'

// ─── Progression templates (as scale-degree indices) ─────────────────────────

/** Named templates expressed as 0-based diatonic scale-degree indices. */
export const TEMPLATES: Record<string, number[]> = {
  'I – V – vi – IV':   [0, 4, 5, 3],
  'I – IV – V':        [0, 3, 4],
  'I – vi – IV – V':   [0, 5, 3, 4],
  'vi – IV – I – V':   [5, 3, 0, 4],
  'ii – V – I':        [1, 4, 0],
  'I – IV – vi – V':   [0, 3, 5, 4],
  'I – iii – IV – V':  [0, 2, 3, 4],
  'i – VII – VI – VII':[0, 6, 5, 6],
}

export const TEMPLATE_NAMES = Object.keys(TEMPLATES)
export { MOOD_LABELS }
export type { Mood }

// ─── Generators ──────────────────────────────────────────────────────────────

export interface SmartResult {
  chords: ParsedChord[]
  romans: string[]
  patternName: string
  bpm: number
  instrument: InstrumentName
  /** Mood articulation: strum/roll spread in ms. */
  rollMs: number
}

/**
 * Generate a musically coherent chord progression using the harmony engine.
 *
 * Pipeline (harmony engine v2):
 *   1. A curated, research-grounded progression pattern for the mood is
 *      chosen (chromatic palette: borrowed chords, modal colour, V7-in-minor).
 *   2. The pattern is cycled to length with role-equivalent variation.
 *   3. Style-coherent extensions colour the chords.
 *   4. Optionally, one chord is swapped for a secondary dominant (V7/x).
 * Also returns roman numerals, the progression family name, and a
 * mood-appropriate BPM + instrument suggestion.
 */
export function generateSmartRich(
  key: string,
  options: SmartGenerationOptions,
): SmartResult {
  const result: MoodGenerationResult = generateMoodProgression(key, options)

  let symbols = result.symbols
  if (options.chromaticColor) {
    symbols = applySecondaryDominants(symbols)
  }

  // Parse, attach the mood's harmonic rhythm, then voice-lead so the chords
  // connect like played hands instead of parallel root-position jumps.
  const parsed = parseChords(symbols).map((c, i) => ({ ...c, beats: result.beats[i] }))

  return {
    chords: voiceLeadProgression(parsed),
    romans: result.romans,
    patternName: result.patternName,
    bpm: result.bpm,
    instrument: result.instrument,
    rollMs: result.rollMs,
  }
}

/** Chords-only variant of {@link generateSmartRich}. */
export function generateSmart(
  key: string,
  options: SmartGenerationOptions,
): ParsedChord[] {
  return generateSmartRich(key, options).chords
}

/**
 * Generate a fully random diatonic progression — no harmonic rules at all.
 * Exposed in the UI as "Fully Random" for users who want pure surprise;
 * generateSmart() is the recommended default.
 */
export function generateRandom(
  key: string,
  length = 4,
  excludeDiminished = false,
): ParsedChord[] {
  const pool = (KEYS[key] ?? []).filter(
    c => !excludeDiminished || !c.endsWith('dim'),
  )
  if (!pool.length) throw new Error(`Unknown key: "${key}"`)

  const symbols = Array.from({ length: Math.max(1, length) }, () =>
    pool[Math.floor(Math.random() * pool.length)],
  )
  return voiceLeadProgression(parseChords(symbols))
}

/** Build a progression from a named template (scale-degree pattern). */
export function generateFromTemplate(
  key: string,
  templateName: string,
): ParsedChord[] {
  const pool = KEYS[key]
  if (!pool) throw new Error(`Unknown key: "${key}"`)
  const degrees = TEMPLATES[templateName]
  if (!degrees) throw new Error(`Unknown template: "${templateName}"`)
  const symbols = degrees.map(d => pool[d % pool.length])
  return voiceLeadProgression(parseChords(symbols))
}
