import type { ChordQuality, ParsedChord } from '@/types'

// ─── Note → MIDI mapping (middle octave, includes enharmonics) ───────────────

export const NOTE_MAP: Record<string, number> = {
  'C':  60, 'B#': 60,
  'C#': 61, 'Db': 61,
  'D':  62,
  'D#': 63, 'Eb': 63,
  'E':  64, 'Fb': 64,
  'F':  65, 'E#': 65,
  'F#': 66, 'Gb': 66,
  'G':  67,
  'G#': 68, 'Ab': 68,
  'A':  69,
  'A#': 70, 'Bb': 70,
  'B':  71, 'Cb': 71,
}

// ─── Semitone intervals for each quality ─────────────────────────────────────

export const QUALITY_INTERVALS: Record<ChordQuality, number[]> = {
  maj:  [0, 4, 7],
  m:    [0, 3, 7],
  dim:  [0, 3, 6],
  aug:  [0, 4, 8],
  '7':    [0, 4, 7, 10],
  maj7:   [0, 4, 7, 11],
  m7:     [0, 3, 7, 10],
  dim7:   [0, 3, 6, 9],
  sus2:   [0, 2, 7],
  sus4:   [0, 5, 7],
  '6':    [0, 4, 7, 9],
  m6:     [0, 3, 7, 9],
  '7sus4': [0, 5, 7, 10],
  add9:    [0, 4, 7, 14],
  '9':     [0, 4, 7, 10, 14],
  m9:      [0, 3, 7, 10, 14],
  mmaj7:   [0, 3, 7, 11],
}

// ─── Display labels rendered on chord cards ──────────────────────────────────

export const QUALITY_DISPLAY: Record<ChordQuality, string> = {
  maj:  '',
  m:    'm',
  dim:  '°',
  aug:  '+',
  '7':    '7',
  maj7:   'Δ7',
  m7:     'm7',
  dim7:   '°7',
  sus2:   'sus2',
  sus4:   'sus4',
  '6':    '6',
  m6:     'm6',
  '7sus4': '7sus4',
  add9:    'add9',
  '9':     '9',
  m9:      'm9',
  mmaj7:   'mΔ7',
}

// ─── Quality normalisation ───────────────────────────────────────────────────

const ALIASES: Record<string, ChordQuality> = {
  '':       'maj',
  'M':      'maj',
  'major':  'maj',
  '-':      'm',
  'minor':  'm',
  '+':      'aug',
  'M7':     'maj7',
  'Maj7':   'maj7',
  'ma7':    'maj7',
  'min7':   'm7',
  '-7':     'm7',
  'dom7':   '7',
  'sus':    'sus4',
}

function normalizeQuality(suffix: string): ChordQuality {
  if (suffix in ALIASES) return ALIASES[suffix]
  if (suffix in QUALITY_INTERVALS) return suffix as ChordQuality
  // Best-effort prefix detection — longer/more-specific suffixes first.
  if (suffix.startsWith('maj7') || suffix.startsWith('M7'))  return 'maj7'
  if (suffix.startsWith('mmaj7') || suffix.startsWith('mM7') || suffix.startsWith('minmaj7')) return 'mmaj7'
  if (suffix.startsWith('m9')   || suffix.startsWith('min9'))return 'm9'
  if (suffix.startsWith('m7')   || suffix.startsWith('min7'))return 'm7'
  if (suffix.startsWith('dim7'))                              return 'dim7'
  if (suffix.startsWith('dim'))                               return 'dim'
  if (suffix.startsWith('aug'))                               return 'aug'
  if (suffix.startsWith('add9'))                              return 'add9'
  if (suffix.startsWith('7sus4') || suffix.startsWith('7sus'))return '7sus4'
  if (suffix.startsWith('sus2'))                              return 'sus2'
  if (suffix.startsWith('sus4') || suffix.startsWith('sus')) return 'sus4'
  if (suffix.startsWith('m6'))                                return 'm6'
  if (suffix.startsWith('6'))                                 return '6'
  if (suffix.startsWith('9'))                                 return '9'
  if (suffix.startsWith('7'))                                 return '7'
  if (suffix.startsWith('m') || suffix.startsWith('min'))     return 'm'
  return 'maj'
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Parse a chord symbol string into a structured {@link ParsedChord}.
 *
 * @example
 * parseChord('F#m7')  // { root: 'F#', quality: 'm7', notes: [66,69,73,76], … }
 * parseChord('Bdim')  // { root: 'B',  quality: 'dim', … }
 */
export function parseChord(symbol: string): ParsedChord {
  let s = symbol.trim()
  if (!s) throw new Error('Empty chord symbol')

  // Slash chord ("G/B", "C#m/G#"): the part after the slash is the bass note,
  // voiced below the chord body.
  let bassMidi: number | null = null
  const slash = s.indexOf('/')
  if (slash > 0) {
    const bassName = s.slice(slash + 1).trim()
    const normalized = bassName[0]?.toUpperCase() + bassName.slice(1)
    if (normalized in NOTE_MAP) {
      bassMidi = NOTE_MAP[normalized] - 12   // one octave below the chord body
    }
    s = s.slice(0, slash)
  }

  let idx = 1
  let root = s[0].toUpperCase()

  // Accidental: sharp (#) or flat (b)
  if (idx < s.length && (s[idx] === '#' || s[idx] === 'b')) {
    root += s[idx]
    idx++
  }

  if (!(root in NOTE_MAP)) {
    throw new Error(`Unknown root note in chord: "${symbol}"`)
  }

  const qualitySuffix = s.slice(idx)
  const quality = normalizeQuality(qualitySuffix)
  const base = NOTE_MAP[root]
  const intervals = QUALITY_INTERVALS[quality]
  const notes = intervals.map(i => base + i)
  if (bassMidi !== null && !notes.includes(bassMidi)) notes.unshift(bassMidi)

  return {
    symbol,
    root,
    quality,
    notes,
    displayQuality: QUALITY_DISPLAY[quality] + (bassMidi !== null ? symbol.slice(symbol.indexOf('/')) : ''),
  }
}

/** Parse multiple chord symbols, skipping any that fail. */
export function parseChords(symbols: string[]): ParsedChord[] {
  return symbols.flatMap(sym => {
    try {
      return [parseChord(sym)]
    } catch {
      return []
    }
  })
}

// ─── Reverse lookup: MIDI notes → chord symbol ───────────────────────────────

const PC_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** Suffix appended to the root when rebuilding a symbol from a quality. */
const QUALITY_SUFFIX: Record<ChordQuality, string> = {
  maj: '', m: 'm', dim: 'dim', aug: 'aug',
  '7': '7', maj7: 'maj7', m7: 'm7', dim7: 'dim7',
  sus2: 'sus2', sus4: 'sus4', '6': '6', m6: 'm6',
  '7sus4': '7sus4', add9: 'add9', '9': '9', m9: 'm9', mmaj7: 'mmaj7',
}

/**
 * Name an arbitrary set of MIDI notes — the inverse of parseChord(), used by
 * the piano-roll editor so hand-edited voicings keep meaningful labels.
 *
 * Tries every sounding pitch class as a candidate root against the known
 * quality shapes (octave-folded). Falls back to a "custom" label when the
 * notes don't form a catalogued chord, and to a rest for an empty set.
 */
export function detectChord(notes: number[]): ParsedChord {
  const sorted = [...new Set(notes)].sort((a, b) => a - b)
  if (!sorted.length) {
    return { symbol: 'Rest', root: '—', quality: 'maj', notes: [], displayQuality: 'rest' }
  }

  const pcs = [...new Set(sorted.map(n => n % 12))]
  for (const rootPc of pcs) {
    const rel = new Set(pcs.map(pc => (pc - rootPc + 12) % 12))
    for (const [quality, intervals] of Object.entries(QUALITY_INTERVALS)) {
      const shape = new Set(intervals.map(i => i % 12))
      if (rel.size === shape.size && [...rel].every(x => shape.has(x))) {
        const q    = quality as ChordQuality
        const root = PC_NAMES[rootPc]
        return {
          symbol: root + QUALITY_SUFFIX[q],
          root,
          quality: q,
          notes: sorted,
          displayQuality: QUALITY_DISPLAY[q],
        }
      }
    }
  }

  const root = PC_NAMES[sorted[0] % 12]
  return {
    symbol: sorted.length === 1 ? root : `${root}*`,
    root,
    quality: 'maj',
    notes: sorted,
    displayQuality: sorted.length === 1 ? 'note' : 'custom',
  }
}
