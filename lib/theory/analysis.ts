/**
 * Rule-based progression analysis.
 *
 * Describes what a progression does in functional-harmony terms — roman
 * numerals, the closing cadence, borrowed/chromatic chords, and named devices
 * (Phrygian bII, the IV→iv "saddest move", secondary dominants, the
 * Andalusian descent). Pure and instant, so the Analysis panel always has
 * something musical to say.
 */
import type { ParsedChord } from '@/types'
import { KEYS } from './keys'
import { NOTE_MAP, QUALITY_DISPLAY } from './chords'

export interface ProgressionAnalysis {
  /** Roman numeral per chord ('—' for rests / unparseable slots). */
  romans: string[]
  /** 2–4 plain-prose sentences. */
  summary: string
}

// Numeral by semitone offset from the tonic, per mode.
const MAJOR_NUMERALS = ['I', 'bII', 'II', 'bIII', 'III', 'IV', '#IV', 'V', 'bVI', 'VI', 'bVII', 'VII']
const MINOR_NUMERALS = ['I', 'bII', 'II', 'III', '#III', 'IV', '#IV', 'V', 'VI', '#VI', 'VII', '#VII']

type Family = 'maj' | 'min' | 'dim' | 'aug' | 'sus'

/** Triad family of each quality — what decides numeral case + diatonic match. */
const FAMILY: Record<string, Family> = {
  maj: 'maj', maj7: 'maj', '6': 'maj', add9: 'maj', '7': 'maj', '9': 'maj',
  maj9: 'maj', '11': 'maj', '13': 'maj', '7b9': 'maj', '7#9': 'maj',
  m: 'min', m7: 'min', m6: 'min', m9: 'min', mmaj7: 'min', m11: 'min',
  dim: 'dim', dim7: 'dim', m7b5: 'dim',
  aug: 'aug',
  sus2: 'sus', sus4: 'sus', '7sus4': 'sus',
}

/** Qualities with a dominant (major 3rd + flat 7th) sound — secondary-dominant candidates. */
const DOMINANT_QUALITIES = new Set<string>(['7', '9', '11', '13', '7b9', '7#9'])

const famOf = (c: ParsedChord): Family => FAMILY[c.quality] ?? 'maj'
const pcOf  = (c: ParsedChord): number => NOTE_MAP[c.root] % 12

function romanFor(chord: ParsedChord, tonicPc: number, isMinor: boolean): string {
  const off = ((pcOf(chord) - tonicPc) % 12 + 12) % 12
  let base = (isMinor ? MINOR_NUMERALS : MAJOR_NUMERALS)[off]
  const fam = famOf(chord)
  if (fam === 'min' || fam === 'dim') base = base.toLowerCase()
  let suffix = QUALITY_DISPLAY[chord.quality] ?? ''
  if (fam === 'min') suffix = suffix.replace(/^m/, '') // case already says minor
  return base + suffix
}

export function analyzeProgression(
  chords: ParsedChord[],
  keyName: string,
  patternName?: string,
): ProgressionAnalysis {
  const keyMatch = keyName.match(/^([A-G][#b]?) (Major|Minor)$/)
  const playable = chords.filter(c => c.notes.length > 0 && Object.hasOwn(NOTE_MAP, c.root))
  if (!keyMatch || playable.length < 2) {
    return { romans: [], summary: 'Add at least two chords to see an analysis.' }
  }

  const tonicPc = NOTE_MAP[keyMatch[1]] % 12
  const isMinor = keyMatch[2] === 'Minor'
  const off = (c: ParsedChord) => ((pcOf(c) - tonicPc) % 12 + 12) % 12

  const romans = chords.map(c =>
    c.notes.length > 0 && Object.hasOwn(NOTE_MAP, c.root) ? romanFor(c, tonicPc, isMinor) : '—',
  )

  // Diatonic pool: pitch class + triad family for each chord of the key.
  const pool = (KEYS[keyName] ?? []).map(sym => {
    const m = sym.match(/^([A-G][#b]?)(.*)$/)!
    return {
      pc: NOTE_MAP[m[1]] % 12,
      fam: (m[2] === 'dim' ? 'dim' : m[2] === 'm' ? 'min' : 'maj') as Family,
    }
  })
  const isDiatonic = (c: ParsedChord): boolean => {
    const fam = famOf(c)
    if (fam === 'sus') return pool.some(p => p.pc === pcOf(c)) // no third — root decides
    return pool.some(p => p.pc === pcOf(c) && p.fam === fam)
  }

  const sentences: string[] = []
  const playableRomans = playable.map(c => romanFor(c, tonicPc, isMinor))
  sentences.push(
    `${playableRomans.join(' – ')} — a ${playable.length}-chord ${isMinor ? 'minor' : 'major'}-key progression in ${keyName}` +
    (patternName ? `, built on the ${patternName} family.` : '.'),
  )

  // ── Cadence: how the final pair lands ────────────────────────────────────
  const last = playable[playable.length - 1]
  const prev = playable[playable.length - 2]
  const tonicWord = isMinor ? 'i' : 'I'
  let cadence: string
  if (off(last) === 0) {
    if (off(prev) === 7 && famOf(prev) !== 'min' && famOf(prev) !== 'dim') {
      cadence = `Closes with an authentic cadence (V→${tonicWord}) — the strongest possible resolution.`
    } else if (off(prev) === 5 && famOf(prev) === 'maj') {
      cadence = 'Closes with a plagal ("amen") cadence — a soft, gospel-tinged landing.'
    } else if (off(prev) === 5 && famOf(prev) === 'min' && !isMinor) {
      cadence = 'Closes iv→I — the minor-plagal cadence, bittersweet and cinematic.'
    } else if (off(prev) === 10) {
      cadence = 'Closes bVII→' + tonicWord + ' — a modal, backdoor-flavoured resolution.'
    } else {
      cadence = 'Ends home on the tonic.'
    }
  } else if (off(last) === 7 && famOf(last) !== 'min') {
    cadence = 'Ends on V — a half cadence that leaves the loop hungry to start over.'
  } else if (off(prev) === 7 && famOf(prev) !== 'min' && (off(last) === 8 || off(last) === 9)) {
    cadence = `A deceptive cadence (V→${playableRomans[playableRomans.length - 1]}) — resolution promised, then sidestepped.`
  } else {
    cadence = `Ends away from home on ${playableRomans[playableRomans.length - 1]} — open-ended, made to loop.`
  }
  sentences.push(cadence)

  // ── Colour: name the chromatic devices ───────────────────────────────────
  const colour: string[] = []
  const covered = new Set<number>()

  // The IV→iv fade (adjacent same-root major→minor on the 4th degree).
  if (!isMinor) {
    for (let i = 0; i < playable.length - 1; i++) {
      const a = playable[i], b = playable[i + 1]
      if (off(a) === 5 && off(b) === 5 && famOf(a) === 'maj' && famOf(b) === 'min') {
        colour.push(`The ${a.symbol}→${b.symbol} move is the IV→iv fade — pop's "saddest move".`)
        covered.add(i + 1)
      }
    }
  }

  // The Andalusian descent (i–VII–VI–V in minor).
  if (isMinor) {
    for (let i = 0; i <= playable.length - 4; i++) {
      const offs = [0, 10, 8, 7]
      if (offs.every((o, j) => off(playable[i + j]) === o)) {
        colour.push('Features the Andalusian cadence (i–VII–VI–V) — flamenco\'s four-step descent.')
        break
      }
    }
  }

  const mentioned = new Set<string>()
  playable.forEach((c, i) => {
    if (isDiatonic(c) || covered.has(i) || mentioned.has(c.symbol)) return
    mentioned.add(c.symbol)
    const o = off(c)
    const fam = famOf(c)
    const next = playable[(i + 1) % playable.length]

    // Secondary dominant: a dom-7-flavoured chord a fifth above its target.
    const isDom = DOMINANT_QUALITIES.has(c.quality)
    if (isDom && o !== 7 && next && ((pcOf(c) - pcOf(next)) % 12 + 12) % 12 === 7) {
      colour.push(`${c.symbol} is a secondary dominant (V7 of ${next.symbol}) — a borrowed pull toward ${next.symbol}.`)
    } else if (o === 1) {
      colour.push(`${c.symbol} is the Phrygian bII — instant menace, one semitone above home.`)
    } else if (isMinor && o === 7 && fam !== 'min') {
      colour.push(`${c.symbol} is the harmonic-minor V — the classical dominant pulling back to i.`)
    } else if (!isMinor && o === 5 && fam === 'min') {
      colour.push(`${c.symbol} is the borrowed iv — pop's "saddest move", on loan from ${keyMatch[1]} minor.`)
    } else if (!isMinor && o === 10 && fam === 'maj') {
      colour.push(`${c.symbol} is the Mixolydian bVII — a rock lift borrowed from the parallel minor.`)
    } else if (!isMinor && o === 8 && fam === 'maj') {
      colour.push(`${c.symbol} is a borrowed bVI — epic, trailer-sized colour from the parallel minor.`)
    } else if (!isMinor && o === 3 && fam === 'maj') {
      colour.push(`${c.symbol} is a chromatic-mediant bIII — a cinematic sidestep.`)
    } else {
      colour.push(`${c.symbol} (${romanFor(c, tonicPc, isMinor)}) sits outside the key — chromatic colour.`)
    }
  })

  if (colour.length) {
    sentences.push(...colour)
  } else {
    sentences.push(`Every chord is diatonic to ${keyName} — a clean, stable palette.`)
  }

  return { romans, summary: sentences.join(' ') }
}
