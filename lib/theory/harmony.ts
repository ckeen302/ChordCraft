/**
 * Harmony engine v2 — research-grounded mood generation.
 *
 * Where v1 walked a Markov chain over the 7 diatonic degrees, v2 models what
 * actually carries emotion in real music:
 *
 *  - CHROMATIC PALETTE: chords are (semitone-offset, quality) specs relative
 *    to the tonic, so moods can use the devices that define them — borrowed
 *    iv and bVI/bVII in major, Phrygian bII, the harmonic-minor V7, Lydian II,
 *    doo-wop III7, Mario-cadence bVI–bVII–I, chromatic mediants.
 *  - CURATED PROGRESSION POOLS per mood, drawn from corpus research of hit
 *    songs and scoring practice, weighted by how strongly they signal the mood.
 *  - STYLE-COHERENT EXTENSIONS: a chord that recurs keeps the same colour
 *    (jazz ii stays m7 everywhere), instead of random per-slot dice rolls.
 *  - MOOD = HARMONY + TEMPO + TIMBRE: each mood carries a BPM range and
 *    instrument suggestions (arousal research: tempo is half the emotion).
 *
 * References: Hooktheory corpus analyses, film/game scoring practice,
 * music-psychology findings on mode/tempo/consonance→valence/arousal.
 */
import type { ChordQuality, InstrumentName } from '@/types'
import { KEYS } from './keys'
import { NOTE_MAP } from './chords'

// ─── Moods ────────────────────────────────────────────────────────────────────

export type Mood =
  | 'uplifting' | 'melancholic' | 'dreamy' | 'romantic' | 'nostalgic'
  | 'tense' | 'jazz' | 'epic' | 'aggressive'

export const MOOD_LABELS: Record<Mood, string> = {
  uplifting:   'Uplifting',
  melancholic: 'Melancholic',
  dreamy:      'Dreamy',
  romantic:    'Romantic',
  nostalgic:   'Nostalgic',
  tense:       'Tense',
  jazz:        'Jazz',
  epic:        'Epic / Cinematic',
  aggressive:  'Aggressive',
}

export interface SmartGenerationOptions {
  mood:              Mood
  length:            number
  excludeDiminished: boolean
  /** Insert one secondary dominant (V7/x) for extra chromatic colour. */
  chromaticColor?:   boolean
}

// ─── Chord specs ──────────────────────────────────────────────────────────────

/** A chord relative to the tonic: semitone offset (0–11) + quality. */
interface ChordSpec { off: number; q: ChordQuality }

/** Weighted, named progression pattern. */
interface Pattern {
  specs: ChordSpec[]
  w: number
  /** Which famous family this is (surfaced in the UI). */
  name: string
  /** Per-chord duration in beats (cycled); overrides the mood's rhythm. */
  beats?: number[]
}

const M  = (off: number): ChordSpec => ({ off, q: 'maj' })
const m  = (off: number): ChordSpec => ({ off, q: 'm' })
const D7 = (off: number): ChordSpec => ({ off, q: '7' })
const dim = (off: number): ChordSpec => ({ off, q: 'dim' })

// ─── Mood profiles ────────────────────────────────────────────────────────────

interface MoodProfile {
  major: Pattern[]
  minor: Pattern[]
  /** Probability that a chord receives a style extension. */
  extendProb: number
  /** Style-coherent quality upgrades: applied by base quality + role. */
  extend: {
    tonic?:  ChordQuality[]   // upgrades for the tonic chord
    maj?:    ChordQuality[]   // other major triads
    min?:    ChordQuality[]   // minor triads
    dom?:    ChordQuality[]   // the V chord (major, functioning dominant)
  }
  bpm: [number, number]
  instruments: InstrumentName[]
  /** Default per-chord duration in beats (cycled along the progression). */
  rhythm: number[]
  /** Strum/roll spread in ms — harp-like for dreamy, tight stabs for metal. */
  rollMs: number
}

const PROFILES: Record<Mood, MoodProfile> = {
  // ── UPLIFTING — the pop-anthem axis, plagal gospel lifts, Mixolydian rock.
  uplifting: {
    major: [
      { specs: [M(0), M(7), m(9), M(5)],  w: 5, name: 'Axis (I–V–vi–IV)' },
      { specs: [M(5), M(7), m(9), M(0)],  w: 3, name: 'Hopscotch (IV–V–vi–I)' },
      { specs: [M(0), M(5), M(7), M(5)],  w: 2, name: 'Rock & roll (I–IV–V–IV)' },
      { specs: [M(0), M(10), M(5), M(0)], w: 2, name: 'Mixolydian lift (I–bVII–IV–I)' },
      { specs: [M(0), M(5), m(9), M(7)],  w: 2, name: 'Pop cycle (I–IV–vi–V)' },
      { specs: [M(0), m(4), M(5), M(7)],  w: 1, name: 'Puff (I–iii–IV–V)' },
    ],
    minor: [
      { specs: [m(0), M(3), M(10), M(8)], w: 3, name: 'EDM euphoria (i–III–VII–VI)' },
      { specs: [m(0), M(8), M(3), M(10)], w: 3, name: 'Rising anthem (i–VI–III–VII)' },
      { specs: [m(0), M(10), M(8), M(10)], w: 1, name: 'Rock climb (i–VII–VI–VII)' },
    ],
    extendProb: 0.3,
    extend: { tonic: ['add9'], maj: ['add9', 'sus2'], dom: ['7'] },
    bpm: [100, 140],
    instruments: ['Piano', 'Guitar'],
    rhythm: [4],
    rollMs: 15,
  },

  // ── MELANCHOLIC — sad-pop loop, Andalusian descent, IV→iv, lament motion.
  melancholic: {
    major: [
      { specs: [m(9), M(5), M(0), M(7)],  w: 4, name: 'Sad-pop loop (vi–IV–I–V)' },
      { specs: [M(0), M(7), m(9), M(5)],  w: 2, name: 'Axis, minor-weighted' },
      { specs: [M(0), M(5), m(5), M(0)],  w: 3, name: 'The saddest move (I–IV–iv–I)' },
      { specs: [M(0), M(4), m(9), M(5)],  w: 1, name: 'Mediant ache (I–III–vi–IV)' },
    ],
    minor: [
      { specs: [m(0), M(10), M(8), M(7)], w: 4, name: 'Andalusian (i–VII–VI–V)' },
      { specs: [m(0), M(8), M(3), M(10)], w: 3, name: 'Minor axis, slow' },
      { specs: [m(0), m(5), M(8), M(7)],  w: 2, name: 'Lament (i–iv–VI–V)' },
      { specs: [m(0), M(10), M(8), M(10)], w: 2, name: 'Rock lament (i–VII–VI–VII)' },
      // Chromatic inner-voice descent: root held while 7→b7→6 falls
      // ("While My Guitar Gently Weeps").
      { specs: [m(0), { off: 0, q: 'mmaj7' }, { off: 0, q: 'm7' }, { off: 0, q: 'm6' }],
        w: 2, name: 'Line cliché (i–i△7–i7–i6)' },
      // Pure natural minor — the v has no leading-tone pull: trapped sadness.
      { specs: [m(0), m(5), m(7), m(0)],  w: 2, name: 'Trapped (i–iv–v–i)' },
    ],
    extendProb: 0.5,
    extend: { tonic: ['maj7'], maj: ['maj7'], min: ['m7', 'm9'], dom: ['7'] },
    bpm: [50, 80],
    instruments: ['Piano', 'Strings'],
    rhythm: [4],
    rollMs: 35,
  },

  // ── DREAMY — Lydian II, plagal floats, maj7/sus2 shimmer, Dorian iv.
  dreamy: {
    major: [
      { specs: [M(0), M(2), M(5), M(0)],  w: 3, name: 'Lydian float (I–II–IV–I)' },
      { specs: [M(0), M(5), M(0), M(5)],  w: 3, beats: [8, 8, 8, 8], name: 'Plagal drift (I–IV)' },
      { specs: [M(0), M(5), m(9), M(5)],  w: 2, name: 'Shimmer cycle (I–IV–vi–IV)' },
      { specs: [M(0), M(10), M(5), M(0)], w: 2, name: 'Mixolydian haze (I–bVII–IV–I)' },
      { specs: [M(0), m(4), M(5), M(0)],  w: 1, name: 'Gentle mediant (I–iii–IV–I)' },
    ],
    minor: [
      { specs: [m(0), M(5), m(0), M(5)],  w: 3, name: 'Dorian float (i–IV)' },
      { specs: [m(0), M(3), M(10), M(5)], w: 2, name: 'Dark shimmer (i–III–VII–IV)' },
      { specs: [m(0), M(3), M(8), M(3)],  w: 2, name: 'Cloud mediants (i–III–VI–III)' },
    ],
    extendProb: 0.75,
    extend: { tonic: ['maj7', 'add9'], maj: ['maj7', 'sus2', 'add9'], min: ['m7', 'm9'] },
    bpm: [55, 90],
    instruments: ['Electric Piano', 'Pad'],
    rhythm: [8],           // 2 bars per chord — the floating feel IS the space
    rollMs: 55,
  },

  // ── ROMANTIC — standards turnarounds, doo-wop mediants, royal-road J-pop.
  romantic: {
    major: [
      { specs: [M(0), m(9), m(2), M(7)],  w: 4, name: 'Standards turnaround (I–vi–ii–V)' },
      { specs: [m(9), M(5), M(0), M(7)],  w: 3, name: 'Yearning loop (vi–IV–I–V)' },
      { specs: [M(0), m(4), m(9), M(5)],  w: 3, name: 'Falling-in-love arc (I–iii–vi–IV)' },
      { specs: [M(0), M(5), m(2), M(7)],  w: 2, name: 'Love-struck (I–IV–ii–V)' },
      { specs: [M(5), M(7), m(4), m(9)],  w: 2, name: 'Royal road (IV–V–iii–vi)' },
      { specs: [M(0), D7(4), m(9), M(5)], w: 2, name: 'Dramatic mediant (I–III7–vi–IV)' },
      { specs: [m(2), M(7), M(0), m(9)],  w: 2, name: 'Circle (ii–V–I–vi)' },
      // The most famous sequence in Western music — descending 5-6 pattern.
      { specs: [M(0), M(7), m(9), m(4), M(5), M(0), M(5), M(7)],
        w: 3, beats: [2, 2, 2, 2, 2, 2, 2, 2], name: 'Pachelbel sequence' },
    ],
    minor: [
      { specs: [m(0), m(5), M(10), M(3)], w: 3, name: 'Minor circle (i–iv–VII–III)' },
      { specs: [m(0), M(8), m(2), D7(7)], w: 2, name: 'Torch song (i–VI–ii–V7)' },
    ],
    extendProb: 0.65,
    extend: { tonic: ['maj7', '6'], maj: ['maj7'], min: ['m7'], dom: ['7', '9', '7sus4'] },
    bpm: [58, 96],
    instruments: ['Piano', 'Strings'],
    rhythm: [4],
    rollMs: 40,
  },

  // ── NOSTALGIC — doo-wop changes, vintage 6ths, III7 chromatic mediant.
  nostalgic: {
    major: [
      { specs: [M(0), m(9), M(5), M(7)],  w: 5, name: 'Doo-wop (I–vi–IV–V)' },
      { specs: [M(0), m(9), m(2), M(7)],  w: 3, name: 'Blue Moon (I–vi–ii–V)' },
      { specs: [M(0), M(5), m(5), M(0)],  w: 2, name: 'Sepia fade (I–IV–iv–I)' },
      { specs: [M(0), D7(4), M(5), m(5)], w: 1, name: 'Vintage mediant (I–III7–IV–iv)' },
      // Tin Pan Alley dominant chain — "Five Foot Two", "Sweet Georgia Brown".
      { specs: [D7(9), D7(2), D7(7), M(0)], w: 2, beats: [4, 4, 4, 4],
        name: 'Ragtime circle (VI7–II7–V7–I)' },
    ],
    minor: [
      { specs: [m(0), M(8), m(5), M(7)],  w: 2, name: 'Old-ballroom (i–VI–iv–V)' },
    ],
    extendProb: 0.6,
    extend: { tonic: ['6', 'maj7'], maj: ['6', 'maj7'], min: ['m6', 'm7'], dom: ['7'] },
    bpm: [65, 100],
    instruments: ['Piano', 'Electric Piano'],
    rhythm: [2],           // doo-wop changes every half bar — "Heart and Soul"
    rollMs: 30,
  },

  // ── TENSE — Phrygian bII, diminished creep, chromatic mediant oscillation.
  tense: {
    major: [
      { specs: [M(0), M(8), M(0), M(8)],  w: 3, name: 'Chromatic mediant creep (I–bVI)' },
      { specs: [M(0), m(5), M(0), M(10)], w: 2, name: 'Modal unease (I–iv–I–bVII)' },
      { specs: [M(0), dim(11), M(0), dim(11)], w: 1, name: 'Leading-tone stab (I–vii°)' },
    ],
    minor: [
      { specs: [m(0), M(1), m(0), M(1)],  w: 4, name: 'Phrygian (i–bII)' },
      { specs: [m(0), dim(2), D7(7), m(0)], w: 3, name: 'Noir cadence (i–ii°–V7–i)' },
      { specs: [m(0), m(5), dim(2), D7(7)], w: 2, name: 'Creeping circle (i–iv–ii°–V7)' },
      // Herrmann's "Hitchcock chord" — the min-maj7 paradox, never resolving.
      { specs: [{ off: 0, q: 'mmaj7' }, m(5), { off: 0, q: 'mmaj7' }, M(1)],
        w: 2, beats: [8, 4, 8, 4], name: 'Hitchcock vamp (i△7)' },
      // Alternating diminished 7ths with no tonal anchor (Psycho's "The City").
      { specs: [{ off: 11, q: 'dim7' }, { off: 2, q: 'dim7' }, { off: 11, q: 'dim7' }, { off: 2, q: 'dim7' }],
        w: 1, name: 'Psycho drift (°7–°7)' },
      { specs: [m(0), { off: 0, q: 'aug' }, m(0), M(1)], w: 1, name: 'Augmented crawl' },
    ],
    extendProb: 0.4,
    extend: { min: ['m9'], dom: ['7'], maj: ['sus2'] },
    bpm: [55, 120],
    instruments: ['Strings', 'Pad'],
    rhythm: [4],
    rollMs: 10,
  },

  // ── JAZZ — ii–V–I machinery, turnarounds, tritone subs, secondary dominants.
  jazz: {
    major: [
      { specs: [m(2), M(7), M(0), m(9)],  w: 4, beats: [2, 2, 4, 4], name: 'ii–V–I–vi' },
      { specs: [M(0), m(9), m(2), M(7)],  w: 3, name: 'Rhythm turnaround (I–vi–ii–V)' },
      { specs: [m(4), m(9), m(2), M(7)],  w: 3, name: 'Ladder (iii–vi–ii–V)' },
      { specs: [M(0), D7(9), m(2), D7(7)], w: 2, name: 'Secondary dominant (I–VI7–ii–V7)' },
      { specs: [m(2), D7(1), M(0), M(0)], w: 2, name: 'Tritone sub (ii–bII7–I)' },
      { specs: [M(0), m(5), D7(10), M(0)], w: 2, name: 'Backdoor (I–iv–bVII7–I)' },
      // Every chord a dominant 7 — the jazz-blues skeleton.
      { specs: [D7(0), D7(5), D7(0), D7(7)], w: 2, beats: [4, 4, 4, 4],
        name: 'Jazz blues (I7–IV7–I7–V7)' },
    ],
    minor: [
      { specs: [dim(2), D7(7), m(0), m(0)], w: 4, beats: [2, 2, 4, 4], name: 'Minor ii°–V–i' },
      { specs: [m(0), m(5), M(10), M(3)],  w: 3, name: 'Autumn circle (i–iv–VII–III)' },
      { specs: [m(0), M(8), dim(2), D7(7)], w: 2, name: 'Torch turnaround (i–VI–ii°–V7)' },
    ],
    extendProb: 0.95,
    extend: { tonic: ['maj7', '6'], maj: ['maj7'], min: ['m7', 'm9'], dom: ['7', '9', '7sus4'] },
    bpm: [70, 135],
    instruments: ['Electric Piano', 'Piano'],
    rhythm: [2],           // medium-swing: two chords per bar
    rollMs: 25,
  },

  // ── EPIC — minor axis, Mario cadence, bVII power motion, chromatic mediants.
  epic: {
    major: [
      { specs: [M(8), M(10), M(0), M(0)], w: 3, name: 'Mario cadence (bVI–bVII–I)' },
      { specs: [M(0), M(10), M(8), M(10)], w: 2, name: 'Power float (I–bVII–bVI–bVII)' },
      { specs: [M(0), M(7), m(9), M(5)],  w: 2, name: 'Anthem axis' },
      { specs: [M(0), M(8), M(0), M(10)], w: 1, name: 'Trailer mediants (I–bVI–I–bVII)' },
    ],
    minor: [
      { specs: [m(0), M(8), M(3), M(10)], w: 5, name: 'Minor axis (i–VI–III–VII)' },
      // Dorian nobility: minor v (no leading tone) + MAJOR IV — Zimmer's "Time".
      { specs: [m(0), m(7), M(10), M(5)], w: 3, name: 'Dorian vamp (i–v–VII–IV)' },
      { specs: [m(0), M(10), M(8), M(10)], w: 3, name: 'Battle loop (i–VII–VI–VII)' },
      // Start away from home — "already mid-adventure" (Game of Thrones).
      { specs: [M(8), M(3), m(5), m(0)],  w: 2, name: 'Adventure (VI–III–iv–i)' },
      { specs: [m(0), M(8), M(10), m(0)], w: 2, name: 'March (i–VI–VII–i)' },
      { specs: [m(0), m(5), M(8), M(10)], w: 2, name: 'Siege (i–iv–VI–VII)' },
    ],
    extendProb: 0.2,
    extend: { maj: ['sus4', 'add9'], min: ['m7'], dom: ['sus4'] },
    bpm: [95, 145],
    instruments: ['Strings', 'Brass'],
    rhythm: [4],
    rollMs: 20,
  },

  // ── AGGRESSIVE — Phrygian slams, bVII/bVI power motion, raw triads.
  aggressive: {
    major: [
      { specs: [M(0), M(10), M(5), M(0)], w: 3, name: 'Rock slam (I–bVII–IV–I)' },
      { specs: [M(0), M(3), M(5), M(0)],  w: 2, name: 'Hard mediant (I–bIII–IV–I)' },
      { specs: [M(0), M(5), M(7), M(0)],  w: 2, name: 'Punk (I–IV–V–I)' },
    ],
    minor: [
      { specs: [m(0), M(1), m(0), M(1)],  w: 4, name: 'Phrygian slam (i–bII)' },
      { specs: [m(0), M(8), M(10), m(0)], w: 3, name: 'Metal loop (i–VI–VII–i)' },
      // Run down the mode and land the bII hammer before home.
      { specs: [m(0), M(10), M(8), M(1)], w: 2, name: 'Phrygian descent (i–VII–VI–bII)' },
      { specs: [m(0), M(10), m(0), M(10)], w: 2, name: 'Drive (i–VII)' },
      { specs: [m(0), m(5), m(0), M(7)],  w: 1, name: 'Minor punk (i–iv–i–V)' },
    ],
    extendProb: 0.05,
    extend: { dom: ['7'] },
    bpm: [140, 200],
    instruments: ['Guitar', 'Organ'],
    rhythm: [2],           // riff-speed changes
    rollMs: 0,             // tight stabs, no roll
  },
}

// ─── Role-equivalent substitutions (variation between cycles) ────────────────

const SUBS_MAJOR: ChordSpec[][] = [
  [M(0), m(9), m(4)],          // tonic family
  [M(5), m(2)],                // subdominant family
  [M(7), M(10)],               // dominant family (bVII as backdoor)
]
const SUBS_MINOR: ChordSpec[][] = [
  [m(0), M(8), M(3)],          // tonic family
  [m(5), M(8)],                // subdominant family
  [M(7), M(10), D7(7)],        // dominant family
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function weightedPick<T extends { w: number }>(items: T[]): T {
  const total = items.reduce((a, b) => a + b.w, 0)
  let r = Math.random() * total
  for (const it of items) { r -= it.w; if (r <= 0) return it }
  return items[items.length - 1]
}

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)] }

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLAT_NAMES  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

/** Flat-side borrowed degrees (bII, bIII, bV, bVI, bVII) spell with flats. */
const FLAT_DEGREE_OFFSETS = new Set([1, 3, 6, 8, 10])

/** Root-name spelling per key: diatonic roots use the key's own spelling. */
function makeSpeller(key: string): (pc: number, off: number) => string {
  const diatonic = new Map<number, string>()
  for (const sym of KEYS[key] ?? []) {
    const root = sym[1] === '#' || sym[1] === 'b' ? sym.slice(0, 2) : sym[0]
    const pc = NOTE_MAP[root]
    if (pc !== undefined) diatonic.set(pc % 12, root)
  }
  const flatKey = key.includes('b') || /^(F Major|D Minor|G Minor|C Minor|F Minor)$/.test(key)
  return (pc: number, off: number) => {
    const known = diatonic.get(pc % 12)
    if (known) return known
    // Borrowed flat-degree chords (Phrygian bII, bVI, bVII…) are flat-spelled
    // by convention regardless of the key's sharp side.
    if (FLAT_DEGREE_OFFSETS.has(((off % 12) + 12) % 12)) return FLAT_NAMES[pc % 12]
    return flatKey ? FLAT_NAMES[pc % 12] : SHARP_NAMES[pc % 12]
  }
}

const QUALITY_SUFFIX: Record<ChordQuality, string> = {
  maj: '', m: 'm', dim: 'dim', aug: 'aug',
  '7': '7', maj7: 'maj7', m7: 'm7', dim7: 'dim7',
  sus2: 'sus2', sus4: 'sus4', '6': '6', m6: 'm6',
  '7sus4': '7sus4', add9: 'add9', '9': '9', m9: 'm9', mmaj7: 'mmaj7',
}

// Roman numerals by semitone offset (degree names; accidental from offset).
const ROMAN_MAJOR: Record<number, string> = {
  0: 'I', 1: 'bII', 2: 'II', 3: 'bIII', 4: 'III', 5: 'IV',
  6: 'bV', 7: 'V', 8: 'bVI', 9: 'VI', 10: 'bVII', 11: 'VII',
}
const ROMAN_MINOR: Record<number, string> = {
  0: 'I', 1: 'bII', 2: 'II', 3: 'III', 4: '#III', 5: 'IV',
  6: 'bV', 7: 'V', 8: 'VI', 9: '#VI', 10: 'VII', 11: '#VII',
}

function romanFor(spec: ChordSpec, isMinorKey: boolean): string {
  const base = (isMinorKey ? ROMAN_MINOR : ROMAN_MAJOR)[spec.off] ?? '?'
  const minorish = spec.q === 'm' || spec.q === 'm7' || spec.q === 'm6' || spec.q === 'm9'
    || spec.q === 'mmaj7' || spec.q === 'dim' || spec.q === 'dim7'
  const numeral = minorish ? base.toLowerCase() : base
  const tail: Partial<Record<ChordQuality, string>> = {
    dim: '°', dim7: '°7', aug: '+', '7': '7', maj7: 'Δ7', m7: '7', m9: '9',
    sus2: 'sus2', sus4: 'sus4', '6': '6', m6: '6', add9: 'add9', '9': '9', '7sus4': '7sus4',
    mmaj7: 'Δ7',
  }
  return numeral + (tail[spec.q] ?? '')
}

// ─── Generation ───────────────────────────────────────────────────────────────

export interface MoodGenerationResult {
  symbols: string[]
  romans: string[]
  /** Which progression family seeded this run (shown in UI). */
  patternName: string
  /** Mood-appropriate tempo, sampled from the researched range. */
  bpm: number
  /** Mood-appropriate instrument suggestion. */
  instrument: InstrumentName
  /** Per-chord duration in beats — the mood's harmonic rhythm. */
  beats: number[]
  /** Strum/roll spread in ms for playback (mood articulation). */
  rollMs: number
}

/**
 * Generate a mood progression: curated pattern → cycle to length with
 * role-equivalent variation → style-coherent extensions → spelled symbols.
 */
export function generateMoodProgression(
  key: string,
  { mood, length, excludeDiminished }: SmartGenerationOptions,
): MoodGenerationResult {
  const isMinorKey = key.toLowerCase().includes('minor')
  const tonicName  = key.split(' ')[0]
  const tonicPc    = NOTE_MAP[tonicName]
  if (tonicPc === undefined) throw new Error(`Unknown key: "${key}"`)

  const profile = PROFILES[mood]
  const safeLen = Math.max(2, Math.min(16, length))

  // 1. Pick a curated pattern (respecting the diminished filter).
  let pool = isMinorKey ? profile.minor : profile.major
  if (excludeDiminished) {
    const noDim = pool.filter(p => !p.specs.some(s => s.q === 'dim' || s.q === 'dim7'))
    if (noDim.length) pool = noDim
  }
  const pattern = weightedPick(pool)

  // 2. Cycle to the requested length; on repeat passes occasionally swap a
  //    chord for a role-equivalent (keeps long loops alive without breaking
  //    the mood's identity).
  const subs = isMinorKey ? SUBS_MINOR : SUBS_MAJOR
  const specs: ChordSpec[] = []
  for (let i = 0; i < safeLen; i++) {
    const base = pattern.specs[i % pattern.specs.length]
    let spec = base
    const cyclePass = Math.floor(i / pattern.specs.length)
    // Vary repeat passes with role-equivalents — but never the first or LAST
    // slot (a substituted final chord wrecks the cadence), and never in a way
    // that creates an adjacent duplicate.
    if (
      cyclePass > 0 &&
      i % pattern.specs.length !== 0 &&
      i !== safeLen - 1 &&
      Math.random() < 0.25
    ) {
      const family = subs.find(f => f.some(s => s.off === base.off && s.q === base.q))
      if (family) {
        const prev = specs[i - 1]
        const next = pattern.specs[(i + 1) % pattern.specs.length]
        const alt = pick(family.filter(s =>
          !(s.off === base.off && s.q === base.q)
          && !(excludeDiminished && (s.q === 'dim' || s.q === 'dim7'))
          && !(prev && s.off === prev.off)          // no repeat with previous
          && !(next && s.off === next.off)))        // no repeat with upcoming
        if (alt) spec = alt
      }
    }
    specs.push({ ...spec })
  }

  // 3. Style-coherent extensions: each distinct (off,q) gets ONE upgrade
  //    decision reused everywhere it recurs. Roots the pattern deliberately
  //    moves through multiple qualities (line clichés like i–i△7–i7–i6) are
  //    exempt — recoloring them would garble the intended voice-leading.
  const qualitiesPerOff = new Map<number, Set<ChordQuality>>()
  for (const s of pattern.specs) {
    if (!qualitiesPerOff.has(s.off)) qualitiesPerOff.set(s.off, new Set())
    qualitiesPerOff.get(s.off)!.add(s.q)
  }
  const lockedOffs = new Set(
    [...qualitiesPerOff.entries()].filter(([, qs]) => qs.size > 1).map(([off]) => off),
  )

  const decided = new Map<string, ChordQuality>()
  for (const spec of specs) {
    if (lockedOffs.has(spec.off)) continue
    const k = `${spec.off}:${spec.q}`
    if (decided.has(k)) { spec.q = decided.get(k)!; continue }
    let q = spec.q
    if (Math.random() < profile.extendProb) {
      const isDom = spec.off === 7 && spec.q === 'maj'
      // Chromatic-mediant majors take a DOMINANT 7th, never maj7 — a maj7
      // would add a note outside the borrowed sonority (III△7 in major puts
      // #9 against the key; Dorian IV△7 in minor puts a #3 cross-relation).
      const isBorrowedDomColour =
        spec.q === 'maj' && ((!isMinorKey && spec.off === 4) || (isMinorKey && spec.off === 5))
      if (isBorrowedDomColour)                              q = Math.random() < 0.5 ? '7' : spec.q
      else if (isDom && profile.extend.dom?.length)         q = pick(profile.extend.dom)
      else if (spec.q === 'maj' && spec.off === 0 && profile.extend.tonic?.length)
                                                            q = pick(profile.extend.tonic)
      else if (spec.q === 'maj' && profile.extend.maj?.length) q = pick(profile.extend.maj)
      else if (spec.q === 'm' && profile.extend.min?.length)   q = pick(profile.extend.min)
      else if (spec.q === 'dim' && (mood === 'jazz' || mood === 'tense')) q = 'dim7'
    }
    decided.set(k, q)
    spec.q = q
  }

  // 4. Spell symbols in the key.
  const spell = makeSpeller(key)
  const symbols = specs.map(s => spell(tonicPc + s.off, s.off) + QUALITY_SUFFIX[s.q])
  const romans  = specs.map(s => romanFor(s, isMinorKey))

  // 5. Harmonic rhythm: pattern-specific beats, else the mood default, cycled.
  const rhythmSrc = pattern.beats ?? profile.rhythm
  const beats = specs.map((_, i) => rhythmSrc[i % rhythmSrc.length])

  // 6. Mood tempo + timbre.
  const [lo, hi] = profile.bpm
  const bpm = Math.round(lo + Math.random() * (hi - lo))

  return {
    symbols,
    romans,
    patternName: pattern.name,
    bpm,
    instrument: pick(profile.instruments),
    beats,
    rollMs: profile.rollMs,
  }
}

// ─── Secondary dominants (chromatic colour) ──────────────────────────────────

/** Pitch class (0–11) of a chord symbol's root. */
function rootPitchClass(symbol: string): number | null {
  const letter: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
  const base = letter[symbol[0]?.toUpperCase()]
  if (base === undefined) return null
  if (symbol[1] === '#') return (base + 1) % 12
  if (symbol[1] === 'b') return (base + 11) % 12
  return base
}

/**
 * Replace one chord with the secondary dominant (V7/x) of the chord that
 * follows it. E.g. in C major: C – Am – D7 – G (D7 = V7 of G).
 *
 * The opening tonic is never replaced, and diminished targets are skipped
 * (V7 of a diminished chord isn't functional).
 */
export function applySecondaryDominants(symbols: string[]): string[] {
  const out = [...symbols]

  const candidates: number[] = []
  for (let i = 2; i < out.length; i++) {
    if (out[i].includes('dim')) continue
    candidates.push(i)
  }
  if (!candidates.length) return out

  const target = candidates[Math.floor(Math.random() * candidates.length)]
  const targetPc = rootPitchClass(out[target])
  if (targetPc === null) return out

  const secondaryRoot = SHARP_NAMES[(targetPc + 7) % 12]
  out[target - 1] = `${secondaryRoot}7`
  return out
}

export { MOOD_LABELS as MOODS }
