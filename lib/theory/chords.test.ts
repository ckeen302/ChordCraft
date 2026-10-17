import { describe, expect, it } from 'vitest'
import { detectChord, parseChord, parseChordStrict, parseChords, QUALITY_INTERVALS } from './chords'
import type { ChordQuality } from '@/types'

const pcs = (notes: number[]) => [...new Set(notes.map(n => n % 12))].sort((a, b) => a - b)

describe('parseChord — basics', () => {
  it.each([
    ['C', 'C', 'maj', [60, 64, 67]],
    ['Am', 'A', 'm', [69, 72, 76]],
    ['F#m7', 'F#', 'm7', [66, 69, 73, 76]],
    ['Bbmaj7', 'Bb', 'maj7', [70, 74, 77, 81]],
    ['Bdim', 'B', 'dim', [71, 74, 77]],
    ['Caug', 'C', 'aug', [60, 64, 68]],
    ['Dsus2', 'D', 'sus2', [62, 64, 69]],
    ['G7sus4', 'G', '7sus4', [67, 72, 74, 77]],
  ] as const)('%s → %s %s', (sym, root, quality, notes) => {
    const c = parseChord(sym)
    expect(c.root).toBe(root)
    expect(c.quality).toBe(quality)
    expect(c.notes).toEqual(notes)
    expect(c.symbol).toBe(sym)
  })

  it('voices a slash bass an octave below the chord body', () => {
    const c = parseChord('G/B')
    expect(c.quality).toBe('maj')
    expect(c.notes[0]).toBe(59)            // B3
    expect(c.displayQuality).toBe('/B')
  })

  it('adds a chord-tone slash bass an octave below rather than reusing the upper note', () => {
    expect(parseChord('C/E').notes).toEqual([52, 60, 64, 67])
  })

  it.each([
    ['CM7', 'maj7'], ['CMaj7', 'maj7'], ['Cmin7', 'm7'], ['C-7', 'm7'],
    ['C-', 'm'], ['C+', 'aug'], ['Csus', 'sus4'], ['Cdom7', '7'],
  ] as const)('alias %s → %s', (sym, quality) => {
    expect(parseChord(sym).quality).toBe(quality)
  })

  it('throws on an unknown root', () => {
    expect(() => parseChord('Hm')).toThrow(/Unknown root/)
    expect(() => parseChord('')).toThrow()
  })
})

describe('parseChord — extended chords (regression: maj9 used to parse as minor)', () => {
  it.each([
    ['Cmaj9', 'maj9'],
    ['Dm11', 'm11'],
    ['G13', '13'],
    ['Am7b5', 'm7b5'],
    ['Bø7', 'm7b5'],
    ['C7b9', '7b9'],
    ['C7#9', '7#9'],
    ['CmM7', 'mmaj7'],
    ['CΔ7', 'maj7'],
    ['C°7', 'dim7'],
  ] as const)('%s → %s', (sym, quality) => {
    expect(parseChord(sym).quality).toBe(quality)
  })

  it('never turns a maj-prefixed suffix into a minor chord', () => {
    for (const sym of ['Cmaj9', 'Cmaj13', 'Cmaj7#11', 'Cmaj11', 'CM9']) {
      const c = parseChord(sym)
      expect(c.quality, sym).not.toMatch(/^m(?!aj)/)
      expect(c.notes, sym).toContain(64) // the major third E
    }
  })
})

describe('parseChordStrict', () => {
  it('accepts every catalogued quality and alias', () => {
    for (const q of Object.keys(QUALITY_INTERVALS)) {
      const sym = 'C' + (q === 'maj' ? '' : q)
      expect(parseChordStrict(sym).quality, sym).toBe(q)
    }
  })

  it('rejects suffixes it would only guess at', () => {
    expect(() => parseChordStrict('Cmaj7#11')).toThrow(/Unrecognised chord quality/)
    expect(() => parseChordStrict('Cxyz')).toThrow(/Unrecognised chord quality/)
  })

  it('rejects an invalid slash bass instead of dropping it', () => {
    expect(() => parseChordStrict('C/H')).toThrow(/bass/)
    expect(parseChord('C/H').notes).toEqual([60, 64, 67]) // lenient keeps the old behaviour
  })
})

describe('parseChords', () => {
  it('skips unparseable symbols', () => {
    expect(parseChords(['C', 'Hm', 'G']).map(c => c.symbol)).toEqual(['C', 'G'])
  })
})

describe('detectChord', () => {
  it('round-trips every quality from a root-position voicing', () => {
    for (const q of Object.keys(QUALITY_INTERVALS) as ChordQuality[]) {
      const notes = QUALITY_INTERVALS[q].map(i => 62 + i) // root D
      const d = detectChord(notes)
      expect(d.root, q).toBe('D')
      expect(d.quality, q).toBe(q)
    }
  })

  it('detects inversions by pitch-class content', () => {
    const d = detectChord([64, 67, 72]) // C/E
    expect(d.root).toBe('C')
    expect(d.quality).toBe('maj')
  })

  it('labels empty input a rest and unknown sets custom', () => {
    expect(detectChord([]).symbol).toBe('Rest')
    expect(detectChord([60, 61, 62]).displayQuality).toBe('custom')
    expect(detectChord([60]).displayQuality).toBe('note')
  })

  it('keeps the parsed pitch classes intact', () => {
    const c = parseChord('Ebm7')
    expect(pcs(detectChord(c.notes).notes)).toEqual(pcs(c.notes))
  })
})
