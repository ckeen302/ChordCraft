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

describe('mood quality', () => {
  it('guidance runs both conditioned and unconditioned rows and changes the distribution', async () => {
    const seen: number[] = []
    const logits: LogitsFn = async rows => {
      seen.push(rows.length)
      return rows.map(row => Float32Array.from(tokens, (_, i) =>
        // the conditioned rows (real mood token) prefer 9:m; unconditioned prefer 7:maj
        i === vocab.id(row[3] === vocab.id('mood:any') ? '7:maj' : '9:m') ? 5 : 0))
    }
    const [guided] = await sampleProgressions(logits, vocab, { mode: 'major', length: 2, mood: 'melancholic', candidates: 2, guidance: 3, rng: seededRng(1) })
    expect(seen[0]).toBe(4)
    expect(guided.degrees[0]).toEqual([9, 'm'])
    seen.length = 0
    await sampleProgressions(logits, vocab, { mode: 'major', length: 2, mood: 'any', candidates: 2, guidance: 3, rng: seededRng(1) })
    expect(seen[0]).toBe(2) // no mood → nothing to guide toward
  })

  it('colouring gives moods their signature chords', async () => {
    const { colourDegrees } = await import('@/lib/theory/harmony')
    const plain: [number, 'maj' | 'm'][] = [[2, 'm'], [7, 'maj'], [0, 'maj'], [9, 'm']]
    const jazz = colourDegrees(plain, 'jazz', false, seededRng(2))
    expect(jazz.filter(([, q]) => q !== 'maj' && q !== 'm').length).toBeGreaterThanOrEqual(3)
    expect(colourDegrees(plain, 'aggressive', false).map(([, q]) => q)).toEqual(['5', '5', '5', '5'])
    const recurring = colourDegrees([[0, 'maj'], [5, 'maj'], [0, 'maj'], [5, 'maj']], 'dreamy', false, seededRng(4))
    expect(recurring[0]).toEqual(recurring[2]) // style-coherent: same chord, same colour
  })
})

describe('one-chord edits', () => {
  it('sampleSlot reads the prefix, honours the filter, and never repeats the excluded chord', async () => {
    const { sampleSlot, isDiatonic } = await import('./sampler')
    const rows: number[][] = []
    const logits: LogitsFn = async r => { rows.push(...r); return fakeLogits(5)(r) }
    for (let s = 0; s < 10; s++) {
      const d = await sampleSlot(logits, vocab, {
        mode: 'major', length: 4, mood: 'dreamy', prefix: [[0, 'maj'], [7, 'maj']],
        exclude: [[9, 'm']], filter: deg => !isDiatonic('major', deg), rng: seededRng(s),
      })
      expect(isDiatonic('major', d)).toBe(false)
      expect(d).not.toEqual([9, 'm'])
      expect(d).not.toEqual([7, 'maj'])
    }
    expect(rows[0].slice(5).map(i => tokens[i])).toEqual(['0:maj', '7:maj'])
  })

  it('reharmonizeWithModel replaces only the chosen bar and keeps durations', async () => {
    const { reharmonizeWithModel, chordToDegree } = await import('./generate')
    const chords = ['C', 'G', 'Am', 'F'].map((s, i) => ({ ...parseChordStrict(s), beats: i + 1 }))
    expect(chordToDegree(chords[2], 'C Major')).toEqual([9, 'm'])
    const r = await reharmonizeWithModel({ vocab, logits: fakeLogits(9) }, {
      key: 'C Major', mood: 'jazz', chords, index: 2, intent: 'darker', seed: 3,
    })
    expect(r.from).toBe('Am')
    expect(r.chords.map(c => c.symbol)).toEqual(['C', 'G', r.to, 'F'])
    expect(r.to).not.toBe('Am')
    expect(['min', 'dim']).toContain((await import('./sampler')).chordFamily(r.chords[2].quality))
    expect(r.chords.map(c => c.beats)).toEqual([1, 2, 3, 4])
    await expect(reharmonizeWithModel({ vocab, logits: fakeLogits() }, { key: 'C Major', mood: 'jazz', chords, index: 7, intent: 'darker' }))
      .rejects.toThrow(/no bar 8/)
  })
})
