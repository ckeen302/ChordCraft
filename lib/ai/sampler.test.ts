import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { controlIds, decodeChord, loopCompletions, makeVocab, sampleProgressions, seededRng, type LogitsFn } from './sampler'
import { generateWithModel } from './generate'
import { spellDegrees } from '@/lib/theory/harmony'
import { parseChordStrict } from '@/lib/theory/chords'

const { tokens } = JSON.parse(readFileSync(resolve(__dirname, '../../fixtures/chord-vocab.json'), 'utf8')) as { tokens: string[] }
const vocab = makeVocab(tokens)

/** A stand-in model: deterministic pseudo-random logits per (row content, step). */
const fakeLogits = (seed = 1): LogitsFn => async rows => rows.map(row => {
  const rng = seededRng(row.reduce((h, t) => (h * 31 + t) >>> 0, seed))
  return Float32Array.from(tokens, () => rng() * 4)
})

const hasRepeatedBlock = (d: unknown[]) => {
  const s = d.map(x => JSON.stringify(x))
  for (let k = 1; 2 * k <= s.length; k++)
    for (let i = 0; i + 2 * k <= s.length; i++)
      if (s.slice(i, i + k).join() === s.slice(i + k, i + 2 * k).join()) return true
  return false
}

describe('vocabulary', () => {
  it('mirrors the Python tokenizer layout', () => {
    expect(tokens.slice(0, 4)).toEqual(['<pad>', '<bos>', '<eos>', '<unk>'])
    const ids = controlIds(vocab, 'minor', 4, 'rock', 'epic')
    expect(ids.map(i => tokens[i])).toEqual(['<bos>', 'mode:minor', 'genre:rock', 'mood:epic', 'len:4'])
    expect(controlIds(vocab, 'major', 99, 'polka', 'sleepy').map(i => tokens[i]).slice(2))
      .toEqual(['genre:any', 'mood:any', 'len:16'])
    expect(decodeChord(vocab, vocab.id('8:maj'))).toEqual([8, 'maj'])
  })
})

describe('loopCompletions', () => {
  it('matches the Python implementation', () => {
    expect(loopCompletions([10, 11, 10])).toEqual([11])
    expect(loopCompletions([10, 11, 12, 10, 11])).toContain(12)
    expect(loopCompletions([10, 11, 12])).toEqual([])
    expect(loopCompletions([10, 11])).toEqual([])
  })
})

describe('sampleProgressions', () => {
  it.each([2, 4, 8, 16])('length %i: exact length, no repeats, no repeated blocks', async length => {
    for (let s = 0; s < 5; s++) {
      const out = await sampleProgressions(fakeLogits(s), vocab, { mode: 'major', length, candidates: 4, rng: seededRng(s) })
      expect(out).toHaveLength(4)
      for (const c of out) {
        expect(c.degrees).toHaveLength(length)
        expect(hasRepeatedBlock(c.degrees)).toBe(false)
      }
      expect(out.map(c => c.logprob)).toEqual([...out.map(c => c.logprob)].sort((a, b) => b - a))
    }
  })

  it('honours no-diminished and diatonic-only masks', async () => {
    const out = await sampleProgressions(fakeLogits(3), vocab, {
      mode: 'minor', length: 8, candidates: 8, excludeDiminished: true, diatonicOnly: true, rng: seededRng(3),
    })
    for (const c of out) for (const [off, q] of c.degrees) {
      expect(['dim', 'dim7', 'm7b5']).not.toContain(q)
      expect([0, 2, 3, 5, 7, 8, 10]).toContain(off)
    }
  })

  it('is reproducible from a seed', async () => {
    const a = await sampleProgressions(fakeLogits(), vocab, { mode: 'major', length: 6, rng: seededRng(42) })
    const b = await sampleProgressions(fakeLogits(), vocab, { mode: 'major', length: 6, rng: seededRng(42) })
    expect(a).toEqual(b)
  })

  it('follows a confident model', async () => {
    // Logits that strongly prefer I–V–vi–IV in order.
    const want = ['0:maj', '7:maj', '9:m', '5:maj'].map(t => vocab.id(t))
    const logits: LogitsFn = async rows => rows.map(row => {
      const step = row.length - 5
      return Float32Array.from(tokens, (_, i) => (i === (want[step] ?? vocab.eos) ? 20 : 0))
    })
    const [best] = await sampleProgressions(logits, vocab, { mode: 'major', length: 4, rng: seededRng(1) })
    expect(best.degrees).toEqual([[0, 'maj'], [7, 'maj'], [9, 'm'], [5, 'maj']])
  })
})

describe('generateWithModel', () => {
  it('spells, times, voice-leads, and labels model output', async () => {
    const r = await generateWithModel({ vocab, logits: fakeLogits(7) }, { key: 'D Minor', mood: 'epic', length: 8, seed: 7 })
    expect(r.chords).toHaveLength(8)
    expect(r.romans).toHaveLength(8)
    expect(r.patternName).toBe('AI · chord transformer')
    for (const c of r.chords) {
      expect(() => parseChordStrict(c.symbol)).not.toThrow()
      expect(c.beats).toBeGreaterThan(0)
    }
  })
})

it('spellDegrees matches the Python port', () => {
  expect(spellDegrees('A Minor', [[0, 'm'], [8, 'maj'], [3, 'maj'], [10, 'maj']])).toEqual(['Am', 'F', 'C', 'G'])
  expect(spellDegrees('Eb Major', [[0, 'maj7'], [9, 'm7'], [2, 'm7'], [7, '7']])).toEqual(['Ebmaj7', 'Cm7', 'Fm7', 'Bb7'])
})
