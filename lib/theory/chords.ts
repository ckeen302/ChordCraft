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
  maj9:    [0, 4, 7, 11, 14],
  m7b5:    [0, 3, 6, 10],
  '11':    [0, 4, 7, 10, 14, 17],
  m11:     [0, 3, 7, 10, 14, 17],
  '13':    [0, 4, 7, 10, 14, 21],   // 11th omitted — it clashes with the 3rd
  '7b9':   [0, 4, 7, 10, 13],
  '7#9':   [0, 4, 7, 10, 15],
  '5':     [0, 7],                  // power chord (no third)
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
  maj9:    'Δ9',
  m7b5:    'ø7',
  '11':    '11',
  m11:     'm11',
  '13':    '13',
  '7b9':   '7♭9',
  '7#9':   '7♯9',
  '5':     '5',
}

/** Canonical suffix appended to a root when spelling a symbol from a quality. */
export const QUALITY_SUFFIX: Record<ChordQuality, string> = {
  maj: '', m: 'm', dim: 'dim', aug: 'aug',
  '7': '7', maj7: 'maj7', m7: 'm7', dim7: 'dim7',
  sus2: 'sus2', sus4: 'sus4', '6': '6', m6: 'm6',
  '7sus4': '7sus4', add9: 'add9', '9': '9', m9: 'm9', mmaj7: 'mmaj7',
  maj9: 'maj9', m7b5: 'm7b5', '11': '11', m11: 'm11', '13': '13',
  '7b9': '7b9', '7#9': '7#9', '5': '5',
}

// ─── Quality normalisation ───────────────────────────────────────────────────

/** Exact alternative spellings — accepted by strict parsing. */
const ALIASES: Record<string, ChordQuality> = {
  '':        'maj',
  'M':       'maj',
  'major':   'maj',
  '-':       'm',
  'min':     'm',
  'minor':   'm',
  '+':       'aug',
  'M7':      'maj7',
  'Maj7':    'maj7',
  'ma7':     'maj7',
  'Δ':       'maj7',
  'Δ7':      'maj7',
  'min7':    'm7',
  '-7':      'm7',
  'dom7':    '7',
  'sus':     'sus4',
  '7sus':    '7sus4',
  '°':       'dim',
  'o':       'dim',
  '°7':      'dim7',
  'o7':      'dim7',
  'mM7':     'mmaj7',
  'minmaj7': 'mmaj7',
  'm(maj7)': 'mmaj7',
  'M9':      'maj9',
  'Maj9':    'maj9',
  'Δ9':      'maj9',
  'ø':       'm7b5',
  'ø7':      'm7b5',
  'min7b5':  'm7b5',
  'm7-5':    'm7b5',
  'min11':   'm11',
  'min9':    'm9',
  'add2':    'add9',
}

/**
 * Lenient fallbacks for suffixes outside the catalogue (Cmaj7#11, Dm13…),
 * mapped to the nearest catalogued quality. Order matters: longer and more
 * specific prefixes first, and every maj-prefixed rule before the bare 'm'
 * rule — otherwise "maj9" would read as a minor chord.
 */
const PREFIX_FALLBACKS: [string, ChordQuality][] = [
  ['mmaj', 'mmaj7'], ['mM', 'mmaj7'], ['minmaj', 'mmaj7'], ['m(maj', 'mmaj7'],
  ['maj13', 'maj9'], ['maj11', 'maj9'], ['maj9', 'maj9'], ['M9', 'maj9'],
  ['maj7', 'maj7'], ['M7', 'maj7'], ['Δ', 'maj7'], ['maj', 'maj'],
  ['m7b5', 'm7b5'], ['ø', 'm7b5'],
  ['m13', 'm11'], ['m11', 'm11'], ['min11', 'm11'],
  ['m9', 'm9'], ['min9', 'm9'], ['m7', 'm7'], ['min7', 'm7'],
  ['m6', 'm6'], ['min6', 'm6'],
  ['dim7', 'dim7'], ['°7', 'dim7'], ['dim', 'dim'], ['°', 'dim'],
  ['aug', 'aug'], ['+', 'aug'],
  ['add9', 'add9'], ['add2', 'add9'],
  ['7sus', '7sus4'], ['sus2', 'sus2'], ['sus', 'sus4'],
  ['13', '13'], ['11', '11'], ['9', '9'],
  ['7b9', '7b9'], ['7#9', '7#9'], ['7', '7'], ['6', '6'],
  ['min', 'm'], ['m', 'm'],
]

/** Resolve a suffix; `exact` is false when the quality was only approximated. */
function normalizeQuality(suffix: string): { quality: ChordQuality; exact: boolean } {
  if (Object.hasOwn(ALIASES, suffix)) return { quality: ALIASES[suffix], exact: true }
  if (Object.hasOwn(QUALITY_INTERVALS, suffix)) return { quality: suffix as ChordQuality, exact: true }
  const hit = PREFIX_FALLBACKS.find(([prefix]) => suffix.startsWith(prefix))
  return { quality: hit ? hit[1] : 'maj', exact: false }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Parse a chord symbol string into a structured {@link ParsedChord}.
 *
 * @example
 * parseChord('F#m7')  // { root: 'F#', quality: 'm7', notes: [66,69,73,76], … }
 * parseChord('Bdim')  // { root: 'B',  quality: 'dim', … }
 *
 * By default unknown suffixes are approximated (Cmaj7#11 → maj7) so hand-typed
 * charts still play. With `strict`, anything not exactly catalogued throws —
 * use it to validate machine-generated chords.
 */
export function parseChord(symbol: string, { strict = false }: { strict?: boolean } = {}): ParsedChord {
  let s = symbol.trim()
  if (!s) throw new Error('Empty chord symbol')

  // Slash chord ("G/B", "C#m/G#"): the part after the slash is the bass note,
  // voiced below the chord body.
  let bassMidi: number | null = null
  const slash = s.indexOf('/')
  if (slash > 0) {
    const bassName = s.slice(slash + 1).trim()
    const normalized = bassName[0]?.toUpperCase() + bassName.slice(1)
    if (Object.hasOwn(NOTE_MAP, normalized)) {
      bassMidi = NOTE_MAP[normalized] - 12   // one octave below the chord body
    } else if (strict) {
      throw new Error(`Unknown bass note in chord: "${symbol}"`)
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

  if (!Object.hasOwn(NOTE_MAP, root)) {
    throw new Error(`Unknown root note in chord: "${symbol}"`)
  }

  const qualitySuffix = s.slice(idx)
  const { quality, exact } = normalizeQuality(qualitySuffix)
  if (strict && !exact) {
    throw new Error(`Unrecognised chord quality "${qualitySuffix}" in chord: "${symbol}"`)
  }
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

/** {@link parseChord} in strict mode: throws on any symbol it would have to guess at. */
export function parseChordStrict(symbol: string): ParsedChord {
  return parseChord(symbol, { strict: true })
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
