/**
 * Golden fixtures — the theory engine's exact outputs for a broad, fixed set
 * of inputs. Written to `fixtures/theory.json` by `npm run fixtures` and
 * consumed by the Python port's test-suite, so both implementations are
 * proven identical. A Vitest check fails if the committed file goes stale.
 *
 * Only deterministic functions are covered; the mood generator is random by
 * design and is tested by properties instead.
 */
import { detectChord, parseChord, NOTE_MAP, QUALITY_INTERVALS, QUALITY_DISPLAY, QUALITY_SUFFIX } from './chords'
import { KEYS, KEY_NAMES } from './keys'
import { voiceLeadProgression } from './voicing'
import { keyPrefersFlats, transposeKeyName, transposeProgression } from './transpose'
import { analyzeProgression } from './analysis'
import type { ParsedChord } from '@/types'

const ROOTS = ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B']

/** Alias spellings, approximated suffixes, slash chords, and malformed input. */
const EDGE_SYMBOLS = [
  'CM', 'Cmajor', 'C-', 'Cmin', 'Cminor', 'C+', 'CM7', 'CMaj7', 'Cma7', 'CΔ', 'CΔ7', 'Cmin7', 'C-7',
  'Cdom7', 'Csus', 'C7sus', 'C°', 'Co', 'C°7', 'Co7', 'CmM7', 'Cminmaj7', 'Cm(maj7)', 'CM9', 'CMaj9',
  'CΔ9', 'Cø', 'Cø7', 'Cmin7b5', 'Cm7-5', 'Cmin11', 'Cmin9', 'Cadd2',
  'Cmaj13', 'Cmaj11', 'Cmaj7#11', 'Cm13', 'Cm7b9', 'C7b13', 'C9sus4', 'C6/9', 'Cadd11', 'Cxyz',
  'G/B', 'C/E', 'D/F#', 'Am/G', 'F#m7/C#', 'C/H', 'Cmaj7/B', 'Bb/D',
  'am', 'c#m7', ' G7 ', 'E#', 'Cb', 'Fbmaj7', 'B#dim',
  'Hm', 'X', '', '/G',
]

type Outcome = { ok: true; chord: ParsedChord } | { ok: false; error: string }

function attempt(symbol: string, strict: boolean): Outcome {
  try {
    return { ok: true, chord: parseChord(symbol, { strict }) }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

const DETECT_SETS: number[][] = [
  [], [60], [60, 61, 62], [60, 64, 67], [64, 67, 72], [55, 59, 62, 65], [59, 62, 65, 69],
  [57, 60, 64, 67], [60, 63, 66, 69], [60, 62, 67], [60, 65, 67], [60, 64, 68], [48, 60, 64, 67, 71],
  [62, 65, 69, 72, 76, 79], [55, 59, 62, 65, 69, 76], [60, 64, 67, 70, 73], [60, 64, 67, 70, 75],
  [47, 59, 62, 65, 69], [40, 55, 59, 62],
]

const PROGRESSIONS: string[][] = [
  ['C', 'G', 'Am', 'F'],
  ['Am', 'F', 'C', 'G'],
  ['Dm7', 'G7', 'Cmaj7', 'A7'],
  ['C', 'G/B', 'Am', 'Am/G', 'F', 'C/E', 'Dm7', 'G7sus4'],
  ['Cm', 'Ab', 'Eb', 'Bb'],
  ['Em', 'F', 'Em', 'F'],
  ['C9', 'F9', 'C9', 'G13'],
  ['Dm11', 'G13', 'Cmaj9', 'Bm7b5', 'E7b9', 'Am9'],
  ['F#m', 'D', 'A', 'E'],
  ['Bbmaj7', 'Gm7', 'Cm7', 'F7', 'Bb6'],
  ['C', 'Caug', 'C6', 'C7', 'F', 'Fm', 'C'],
  ['Am', 'G', 'F', 'E7'],
]

const ANALYSIS_CASES: [string[], string][] = [
  [['C', 'Am', 'F', 'G7', 'C'], 'C Major'],
  [['C', 'F', 'Fm', 'C'], 'C Major'],
  [['Am', 'G', 'F', 'E'], 'A Minor'],
  [['Em', 'F', 'Em', 'F'], 'E Minor'],
  [['C', 'A7', 'Dm', 'G7'], 'C Major'],
  [['C', 'Bb', 'F', 'C'], 'C Major'],
  [['C', 'Ab', 'Bb', 'C'], 'C Major'],
  [['C', 'Eb', 'F', 'C'], 'C Major'],
  [['Am', 'Dm', 'E7', 'Am'], 'A Minor'],
  [['C', 'G', 'Am'], 'C Major'],
  [['C', 'F'], 'C Major'],
  [['F', 'G'], 'C Major'],
  [['Dm11', 'G13', 'Cmaj9', 'Bm7b5'], 'C Major'],
  [['Csus4', 'C', 'Fsus2', 'G7sus4'], 'C Major'],
  [['D', 'A', 'Bm', 'G'], 'D Major'],
  [['Ebm', 'Cb', 'Gb', 'Db'], 'Eb Minor'],
  [['C'], 'C Major'],
  [['C', 'G'], 'Nonsense Key'],
]

export function buildTheoryFixtures() {
  const symbols = [
    ...ROOTS.flatMap(r => Object.values(QUALITY_SUFFIX).map(s => r + s)),
    ...EDGE_SYMBOLS,
  ]

  return {
    version: 1,
    tables: {
      noteMap: NOTE_MAP,
      qualityIntervals: QUALITY_INTERVALS,
      qualityDisplay: QUALITY_DISPLAY,
      qualitySuffix: QUALITY_SUFFIX,
      keys: KEYS,
    },
    parse: symbols.map(symbol => ({
      symbol,
      lenient: attempt(symbol, false),
      strict: attempt(symbol, true),
    })),
    detect: DETECT_SETS.map(notes => ({ notes, chord: detectChord(notes) })),
    voiceLead: PROGRESSIONS.map(syms => {
      const chords = syms.map(s => parseChord(s))
      return { symbols: syms, notes: voiceLeadProgression(chords).map(c => c.notes) }
    }),
    keyPrefersFlats: KEY_NAMES.map(key => ({ key, flats: keyPrefersFlats(key) })),
    transposeKeyName: KEY_NAMES.flatMap(key =>
      [-11, -7, -1, 1, 2, 5, 7, 11].map(semitones => ({ key, semitones, result: transposeKeyName(key, semitones) })),
    ),
    transposeProgression: PROGRESSIONS.flatMap(syms =>
      [[-3, false], [1, true], [1, false], [6, true]].map(([semitones, preferFlats]) => ({
        symbols: syms,
        semitones,
        preferFlats,
        result: transposeProgression(syms.map(s => parseChord(s)), semitones as number, preferFlats as boolean),
      })),
    ),
    analyze: ANALYSIS_CASES.map(([syms, key]) => ({
      symbols: syms,
      key,
      result: analyzeProgression(syms.map(s => parseChord(s)), key),
    })),
  }
}
