import { describe, expect, it } from 'vitest'
import { parseChord, parseChords } from './chords'
import { keyPrefersFlats, parallelKey, transposeKeyName, transposeProgression } from './transpose'
import { voiceLeadProgression } from './voicing'
import { analyzeProgression } from './analysis'
import { KEY_NAMES } from './keys'

const pcSet = (notes: number[]) => new Set(notes.map(n => n % 12))

describe('transpose', () => {
  it('transposes key names within the same mode', () => {
    expect(transposeKeyName('C Major', 1)).toBe('Db Major')
    expect(transposeKeyName('A Minor', -2)).toBe('G Minor')
    expect(transposeKeyName('B Major', 1)).toBe('C Major')
    expect(transposeKeyName('nonsense', 3)).toBe('nonsense')
  })

  it('is total over every key and both directions', () => {
    for (const k of KEY_NAMES) {
      for (const st of [-11, -1, 1, 5, 11]) expect(KEY_NAMES).toContain(transposeKeyName(k, st))
    }
  })

  it('finds parallel keys for every tonic', () => {
    expect(parallelKey('C Major', 'minor')).toBe('C Minor')
    expect(parallelKey('A Minor', 'major')).toBe('A Major')
    expect(parallelKey('Db Major', 'minor')).toBe('C# Minor')
    expect(parallelKey('Eb Major', 'major')).toBe('Eb Major')
    for (const k of KEY_NAMES) for (const mode of ['major', 'minor'] as const)
      expect(parallelKey(k, mode).endsWith(mode === 'major' ? 'Major' : 'Minor')).toBe(true)
  })

  it('knows which keys spell with flats', () => {
    expect(keyPrefersFlats('F Major')).toBe(true)
    expect(keyPrefersFlats('Eb Major')).toBe(true)
    expect(keyPrefersFlats('C Major')).toBe(false)
    expect(keyPrefersFlats('E Major')).toBe(false)
  })

  it('shifts notes, renames roots, and keeps beats + slash bass', () => {
    const src = [{ ...parseChord('G/B'), beats: 3 }, parseChord('Am7')]
    const out = transposeProgression(src, 1, true)
    expect(out.map(c => c.symbol)).toEqual(['Ab/C', 'Bbm7'])
    expect(out[0].beats).toBe(3)
    expect(out[0].notes).toEqual(src[0].notes.map(n => n + 1))
    expect(out[0].displayQuality).toBe('/C')
  })
})

describe('voiceLeadProgression', () => {
  const chords = parseChords(['C', 'G', 'Am', 'F', 'Dm7', 'G7', 'Cmaj7', 'E7'])
  const voiced = voiceLeadProgression(chords)

  it('keeps the bass anchor and the harmony', () => {
    voiced.forEach((v, i) => {
      expect(v.notes[0]).toBe(chords[i].notes[0])
      expect(pcSet(v.notes)).toEqual(pcSet(chords[i].notes))
      expect(v.symbol).toBe(chords[i].symbol)
    })
  })

  it('keeps upper voices in the C4–B5 window', () => {
    for (const v of voiced.slice(1)) {
      for (const n of v.notes.slice(1)) {
        expect(n).toBeGreaterThanOrEqual(60)
        expect(n).toBeLessThanOrEqual(83)
      }
    }
  })

  it('moves upper voices less than parallel root-position chords', () => {
    const motion = (cs: { notes: number[] }[]) => cs.slice(1).reduce((sum, c, i) => {
      const prev = cs[i].notes.slice(1)
      return sum + c.notes.slice(1).reduce((s, n) => s + Math.min(...prev.map(p => Math.abs(n - p))), 0)
    }, 0)
    expect(motion(voiced)).toBeLessThan(motion(chords))
  })

  it('keeps every chord tone, extensions and slash chords included', () => {
    for (const symbol of ['C9', 'Dm11', 'E7b9', 'Em7/G', 'Bm7/D', 'Cmaj9']) {
      const chord = parseChord(symbol)
      const [v] = voiceLeadProgression([parseChord('C'), chord]).slice(1)
      expect(pcSet(v.notes), symbol).toEqual(pcSet(chord.notes))
    }
  })
})

describe('analyzeProgression', () => {
  it('labels roman numerals and an authentic cadence', () => {
    const a = analyzeProgression(parseChords(['C', 'Am', 'F', 'G7', 'C']), 'C Major')
    expect(a.romans).toEqual(['I', 'vi', 'IV', 'V7', 'I'])
    expect(a.summary).toMatch(/authentic cadence/)
  })

  it('names borrowed and chromatic devices', () => {
    expect(analyzeProgression(parseChords(['C', 'F', 'Fm', 'C']), 'C Major').summary).toMatch(/saddest move/)
    expect(analyzeProgression(parseChords(['Am', 'G', 'F', 'E']), 'A Minor').summary).toMatch(/Andalusian/)
    expect(analyzeProgression(parseChords(['Em', 'F', 'Em', 'F']), 'E Minor').summary).toMatch(/Phrygian/)
  })

  it('handles extended qualities without crashing', () => {
    const a = analyzeProgression(parseChords(['Dm11', 'G13', 'Cmaj9', 'Bm7b5']), 'C Major')
    expect(a.romans).toEqual(['ii11', 'V13', 'IΔ9', 'viiø7'])
  })

  it('asks for more input below two chords', () => {
    expect(analyzeProgression(parseChords(['C']), 'C Major').romans).toEqual([])
  })
})
