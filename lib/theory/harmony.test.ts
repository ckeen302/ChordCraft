import { describe, expect, it } from 'vitest'
import { applySecondaryDominants, generateMoodProgression, MOOD_LABELS, type Mood } from './harmony'
import { generateFromTemplate, generateRandom, generateSmartRich, TEMPLATE_NAMES } from './progressions'
import { parseChordStrict } from './chords'
import { KEY_NAMES } from './keys'

const MOODS = Object.keys(MOOD_LABELS) as Mood[]

describe('generateMoodProgression', () => {
  it('always emits strictly parseable symbols with aligned metadata', () => {
    for (const mood of MOODS) {
      for (const key of KEY_NAMES) {
        for (let trial = 0; trial < 15; trial++) {
          const length = 2 + (trial % 11)
          const r = generateMoodProgression(key, { mood, length, excludeDiminished: trial % 2 === 0 })
          const ctx = `${mood} / ${key} / len ${length}`
          expect(r.symbols, ctx).toHaveLength(length)
          expect(r.romans, ctx).toHaveLength(length)
          expect(r.beats, ctx).toHaveLength(length)
          for (const s of r.symbols) expect(() => parseChordStrict(s), `${ctx}: ${s}`).not.toThrow()
          for (const b of r.beats) expect(b, ctx).toBeGreaterThan(0)
          expect(r.bpm, ctx).toBeGreaterThanOrEqual(40)
          expect(r.bpm, ctx).toBeLessThanOrEqual(240)
          expect(r.patternName, ctx).toBeTruthy()
        }
      }
    }
  })

  it('clamps length to 2–16', () => {
    expect(generateMoodProgression('C Major', { mood: 'jazz', length: 1, excludeDiminished: false }).symbols).toHaveLength(2)
    expect(generateMoodProgression('C Major', { mood: 'jazz', length: 99, excludeDiminished: false }).symbols).toHaveLength(16)
  })

  it('honours excludeDiminished whenever the mood has a dim-free pattern', () => {
    for (let i = 0; i < 200; i++) {
      const r = generateMoodProgression('A Minor', { mood: 'melancholic', length: 8, excludeDiminished: true })
      expect(r.symbols.some(s => s.includes('dim'))).toBe(false)
    }
  })

  it('rejects unknown keys', () => {
    expect(() => generateMoodProgression('H Major', { mood: 'jazz', length: 4, excludeDiminished: false })).toThrow()
  })
})

describe('applySecondaryDominants', () => {
  it('replaces the chord before a target with its V7 and never the opening chord', () => {
    for (let i = 0; i < 100; i++) {
      const out = applySecondaryDominants(['C', 'Am', 'F', 'G'])
      expect(out[0]).toBe('C')
      const changed = out.findIndex((s, j) => s !== ['C', 'Am', 'F', 'G'][j])
      expect(changed).toBeGreaterThanOrEqual(1)
      expect(out[changed]).toMatch(/7$/)
    }
  })
})

describe('progressions', () => {
  it('generateSmartRich voice-leads and carries beats', () => {
    const r = generateSmartRich('D Minor', { mood: 'epic', length: 6, excludeDiminished: false })
    expect(r.chords).toHaveLength(6)
    for (const c of r.chords) expect(c.beats).toBeGreaterThan(0)
  })

  it('templates map scale degrees to diatonic chords', () => {
    expect(generateFromTemplate('C Major', 'I – V – vi – IV').map(c => c.symbol)).toEqual(['C', 'G', 'Am', 'F'])
    expect(generateFromTemplate('A Minor', 'i – VII – VI – VII').map(c => c.symbol)).toEqual(['Am', 'G', 'F', 'G'])
    for (const t of TEMPLATE_NAMES) expect(generateFromTemplate('E Major', t).length).toBeGreaterThan(0)
  })

  it('random generation stays diatonic', () => {
    for (let i = 0; i < 50; i++) {
      const chords = generateRandom('G Major', 6, true)
      expect(chords).toHaveLength(6)
      for (const c of chords) expect(['G', 'Am', 'Bm', 'C', 'D', 'Em']).toContain(c.symbol)
    }
  })
})
