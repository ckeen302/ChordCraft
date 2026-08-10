/**
 * Transposition — shift a whole progression by semitones.
 *
 * Works directly on the MIDI notes so voicings, harmonic rhythm (beats), and
 * slash-bass structure survive exactly; only the note numbers and the spelled
 * names (root, symbol) change. Spelling follows the destination key: flat
 * keys name the new roots with flats, sharp keys with sharps.
 */
import type { ParsedChord } from '@/types'
import { NOTE_MAP } from './chords'
import { KEYS } from './keys'

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLAT_NAMES  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

/** Does this key's diatonic set spell with flats? (C Major / A Minor → sharps.) */
export function keyPrefersFlats(keyName: string): boolean {
  const pool = KEYS[keyName] ?? []
  return pool.some(s => /^[A-G]b/.test(s) || s.includes('b', 1)) && !pool.some(s => s.includes('#'))
}

/**
 * Transpose a key name, e.g. transposeKeyName('C Major', 1) → 'Db Major'.
 * Every pitch class has a key in KEYS for both modes, so this is total;
 * the input name is returned unchanged only if it isn't a known key format.
 */
export function transposeKeyName(keyName: string, semitones: number): string {
  const m = keyName.match(/^([A-G][#b]?) (Major|Minor)$/)
  if (!m || !(m[1] in NOTE_MAP)) return keyName
  const pc = ((NOTE_MAP[m[1]] + semitones) % 12 + 12) % 12
  for (const name of Object.keys(KEYS)) {
    const mm = name.match(/^([A-G][#b]?) (Major|Minor)$/)
    if (mm && mm[2] === m[2] && NOTE_MAP[mm[1]] % 12 === pc) return name
  }
  return keyName
}

/**
 * Transpose a progression by `semitones`, renaming roots/symbols with the
 * given spelling preference. Pure — returns new chords; rests pass through.
 */
export function transposeProgression(
  chords: ParsedChord[],
  semitones: number,
  preferFlats: boolean,
): ParsedChord[] {
  const names = preferFlats ? FLAT_NAMES : SHARP_NAMES
  const rename = (noteName: string): string => {
    const midi = NOTE_MAP[noteName]
    return midi === undefined
      ? noteName
      : names[((midi + semitones) % 12 + 12) % 12]
  }

  return chords.map(ch => {
    if (!ch.notes.length || !(ch.root in NOTE_MAP)) return ch // rests stay put

    // Split "G#m7/D#" into body + optional slash bass; keep the quality suffix.
    const [body, bass] = ch.symbol.split('/')
    const rootMatch = body.match(/^[A-G][#b]?/)
    const suffix = rootMatch ? body.slice(rootMatch[0].length) : ''
    const newRoot = rename(ch.root)
    const newBass = bass !== undefined ? rename(bass.trim()) : null

    return {
      ...ch,
      root: newRoot,
      symbol: newRoot + suffix + (newBass ? `/${newBass}` : ''),
      notes: ch.notes.map(n => n + semitones),
      displayQuality: newBass
        ? ch.displayQuality.replace(/\/.*$/, `/${newBass}`)
        : ch.displayQuality,
    }
  })
}
