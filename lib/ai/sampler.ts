/**
 * Constrained sampling for the chord transformer — a TypeScript port of
 * backend/chordcraft/model/generate.py, independent of the inference runtime
 * (it only needs a function from token sequences to next-token logits).
 *
 * Every output is valid by construction:
 * - only chord tokens after the control prefix; EOS forced at the exact length
 * - no immediate repeats, and no immediately repeated blocks (ABAB, ABCABC…)
 * - optional no-diminished / diatonic-only masks and a presence penalty
 * - classifier-free guidance: logits = uncond + w·(cond − uncond), where the
 *   unconditioned rows swap the mood token for `mood:any` (w > 1 sharpens mood)
 * The best of N candidates (by mean log-probability) is returned first.
 */
import type { ChordQuality } from '@/types'

export type Degree = [offset: number, quality: ChordQuality]

/** Next-token logits for each row's last position. */
export type LogitsFn = (rows: number[][]) => Promise<Float32Array[]>

export interface Vocab {
  tokens: string[]
  pad: number
  bos: number
  eos: number
  firstChord: number
  id: (token: string) => number
}

export interface SampleOptions {
  mode: 'major' | 'minor'
  length: number
  mood?: string
  genre?: string
  candidates?: number
  temperature?: number
  topP?: number
  presencePenalty?: number
  excludeDiminished?: boolean
  diatonicOnly?: boolean
  blockLoops?: boolean
  guidance?: number
  rng?: () => number
}

export interface Candidate {
  degrees: Degree[]
  logprob: number
}

const MIN_LEN = 2
const MAX_LEN = 16
const DIM_FAMILY = new Set(['dim', 'dim7', 'm7b5'])
const FAMILY: Record<string, 'maj' | 'min' | 'dim' | 'aug' | 'sus'> = {
  maj: 'maj', maj7: 'maj', '6': 'maj', add9: 'maj', '7': 'maj', '9': 'maj',
  maj9: 'maj', '11': 'maj', '13': 'maj', '7b9': 'maj', '7#9': 'maj',
  m: 'min', m7: 'min', m6: 'min', m9: 'min', mmaj7: 'min', m11: 'min',
  dim: 'dim', dim7: 'dim', m7b5: 'dim', aug: 'aug',
  sus2: 'sus', sus4: 'sus', '7sus4': 'sus', '5': 'sus',
}
const DIATONIC: Record<'major' | 'minor', Record<number, string>> = {
  major: { 0: 'maj', 2: 'min', 4: 'min', 5: 'maj', 7: 'maj', 9: 'min', 11: 'dim' },
  minor: { 0: 'min', 2: 'dim', 3: 'maj', 5: 'min', 7: 'min', 8: 'maj', 10: 'maj' },
}

export function makeVocab(tokens: string[]): Vocab {
  const index = new Map(tokens.map((t, i) => [t, i]))
  const id = (t: string) => {
    const i = index.get(t)
    if (i === undefined) throw new Error(`token "${t}" missing from vocabulary`)
    return i
  }
  const firstChord = tokens.findIndex(t => /^\d+:/.test(t))
  if (firstChord < 0) throw new Error('vocabulary has no chord tokens')
  return { tokens, pad: id('<pad>'), bos: id('<bos>'), eos: id('<eos>'), firstChord, id }
}

/** Control prefix, mirroring ChordTokenizer.control_ids (unknown genre/mood → any). */
export function controlIds(v: Vocab, mode: string, length: number, genre = 'any', mood = 'any'): number[] {
  const safe = (kind: string, value: string) => (v.tokens.includes(`${kind}:${value}`) ? value : 'any')
  const len = Math.max(MIN_LEN, Math.min(MAX_LEN, Math.round(length)))
  return [v.bos, v.id(`mode:${mode}`), v.id(`genre:${safe('genre', genre)}`), v.id(`mood:${safe('mood', mood)}`), v.id(`len:${len}`)]
}

export function decodeChord(v: Vocab, id: number): Degree {
  const [off, q] = v.tokens[id].split(':')
  return [Number(off), q as ChordQuality]
}

/** Tokens that would end `seq` in an immediately repeated block (see generate.py). */
export function loopCompletions(seq: number[]): number[] {
  const out: number[] = []
  const n = seq.length
  for (let k = 2; 2 * k - 1 <= n; k++) {
    let echo = true
    for (let i = 0; i < k - 1; i++) {
      if (seq[n - (k - 1) + i] !== seq[n - (2 * k - 1) + i]) { echo = false; break }
    }
    if (echo) out.push(seq[n - k])
  }
  return out
}

function chordMask(v: Vocab, mode: 'major' | 'minor', excludeDim: boolean, diatonicOnly: boolean): boolean[] {
  return v.tokens.map((_, i) => {
    if (i < v.firstChord) return false
    const [off, q] = decodeChord(v, i)
    if (excludeDim && DIM_FAMILY.has(q)) return false
    if (diatonicOnly) {
      const want = DIATONIC[mode][off]
      const fam = FAMILY[q] ?? 'maj'
      if (want === undefined || (fam !== 'sus' && fam !== want)) return false
    }
    return true
  })
}

/** Seeded PRNG (mulberry32) so a seed reproduces a progression. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Next-token logits with classifier-free guidance against `mood:any` (skipped when anyMood is null). */
async function guidedLogits(logits: LogitsFn, rows: number[][], anyMood: number | null, guidance: number): Promise<Float32Array[]> {
  if (anyMood === null) return logits(rows)
  const uncond = rows.map(r => { const u = [...r]; u[3] = anyMood; return u })
  const both = await logits([...rows, ...uncond])
  return rows.map((_, r) => {
    const c = both[r], u = both[r + rows.length]
    return Float32Array.from(c, (x, i) => u[i] + guidance * (x - u[i]))
  })
}

export async function sampleProgressions(logits: LogitsFn, v: Vocab, opts: SampleOptions): Promise<Candidate[]> {
  const {
    mode, mood = 'any', genre = 'any', candidates = 4, temperature = 0.9, topP = 0.95,
    presencePenalty = 0.3, excludeDiminished = false, diatonicOnly = false, blockLoops = true,
    guidance = 2, rng = Math.random,
  } = opts
  const prefix = controlIds(v, mode, opts.length, genre, mood)
  const length = Number(v.tokens[prefix[prefix.length - 1]].split(':')[1])
  const base = chordMask(v, mode, excludeDiminished, diatonicOnly)
  const rows = Array.from({ length: candidates }, () => [...prefix])
  const logprob = new Array(candidates).fill(0)
  const anyMood = v.id('mood:any')
  const guided = guidance !== 1 && prefix[3] !== anyMood

  for (let step = 0; step <= length; step++) {
    const out = await guidedLogits(logits, rows, guided ? anyMood : null, guidance)
    for (let r = 0; r < candidates; r++) {
      const chords = rows[r].slice(prefix.length)
      const allowed = step === length ? v.tokens.map((_, i) => i === v.eos) : [...base]
      if (step > 0 && step < length) allowed[chords[chords.length - 1]] = false
      if (blockLoops && step >= 3 && step < length) for (const t of loopCompletions(chords)) allowed[t] = false
      const used = presencePenalty && step > 0 && step < length ? new Set(chords) : null

      // log-softmax over allowed tokens (for scoring) and tempered nucleus sampling.
      const raw = Array.from(out[r], (x, i) => (allowed[i] ? x - (used?.has(i) ? presencePenalty : 0) : -Infinity))
      const max = Math.max(...raw)
      const logZ = Math.log(raw.reduce((s, x) => s + Math.exp(x - max), 0)) + max
      const tempered = raw.map(x => Math.exp((x - max) / Math.max(temperature, 1e-5)))
      const total = tempered.reduce((s, x) => s + x, 0)
      const order = tempered.map((p, i) => [p / total, i] as const).filter(([p]) => p > 0).sort((a, b) => b[0] - a[0])
      const nucleus: (readonly [number, number])[] = []
      let cum = 0
      for (const item of order) {
        if (cum > topP && nucleus.length) break
        nucleus.push(item)
        cum += item[0]
      }
      const mass = nucleus.reduce((s, [p]) => s + p, 0)
      let u = rng() * mass
      let pickId = nucleus[nucleus.length - 1][1]
      for (const [p, i] of nucleus) {
        u -= p
        if (u <= 0) { pickId = i; break }
      }
      logprob[r] += raw[pickId] - logZ
      rows[r].push(pickId)
    }
  }

  return rows
    .map((row, r) => ({
      degrees: row.slice(prefix.length, prefix.length + length).map(id => decodeChord(v, id)),
      logprob: logprob[r] / (length + 1),
    }))
    .sort((a, b) => b.logprob - a.logprob)
}

/** Token id for a degree, falling back to its plain triad/power chord when the exact quality isn't in the vocabulary. */
export function degreeId(v: Vocab, [off, q]: Degree): number {
  const exact = v.tokens.indexOf(`${off}:${q}`)
  if (exact >= 0) return exact
  const triad = { maj: 'maj', min: 'm', dim: 'dim', aug: 'aug', sus: 'sus4' }[FAMILY[q] ?? 'maj']
  const fallback = v.tokens.indexOf(`${off}:${triad}`)
  return fallback >= 0 ? fallback : v.tokens.indexOf(`${off}:maj`)
}

/** Chord families, for filters that ask for e.g. "something darker". */
export function chordFamily(q: ChordQuality): 'maj' | 'min' | 'dim' | 'aug' | 'sus' {
  return FAMILY[q] ?? 'maj'
}

/** Whether a degree belongs to the key's diatonic set (sus chords count when their root is diatonic). */
export function isDiatonic(mode: 'major' | 'minor', [off, q]: Degree): boolean {
  const want = DIATONIC[mode][off]
  const fam = chordFamily(q)
  return want !== undefined && (fam === 'sus' || fam === want)
}

export interface SlotOptions {
  mode: 'major' | 'minor'
  /** The whole progression's length (the model's len: token). */
  length: number
  /** Chords before the slot, fixed. */
  prefix: Degree[]
  mood?: string
  genre?: string
  /** Chords the slot must not become (e.g. the chord being replaced). */
  exclude?: Degree[]
  /** Restrict the slot; ignored if it would leave nothing to choose. */
  filter?: (d: Degree) => boolean
  temperature?: number
  guidance?: number
  rng?: () => number
}

/**
 * Resample one chord slot, conditioned on the chords before it — the model
 * reading the progression so far and offering a different next chord.
 * Returns the sampled degree.
 */
export async function sampleSlot(logits: LogitsFn, v: Vocab, opts: SlotOptions): Promise<Degree> {
  const { mode, mood = 'any', genre = 'any', exclude = [], filter, temperature = 1, guidance = 2, rng = Math.random } = opts
  const prefix = controlIds(v, mode, Math.max(opts.length, opts.prefix.length + 1), genre, mood)
  const row = [...prefix, ...opts.prefix.map(d => degreeId(v, d))]
  const anyMood = v.id('mood:any')
  const [out] = await guidedLogits(logits, [row], guidance !== 1 && prefix[3] !== anyMood ? anyMood : null, guidance)

  const banned = new Set(exclude.map(d => degreeId(v, d)))
  if (opts.prefix.length) banned.add(degreeId(v, opts.prefix[opts.prefix.length - 1]))
  const base = v.tokens.map((_, i) => i >= v.firstChord && !banned.has(i))
  const filtered = filter ? base.map((ok, i) => ok && filter(decodeChord(v, i))) : base
  const allowed = filtered.some(Boolean) ? filtered : base

  const raw = Array.from(out, (x, i) => (allowed[i] ? x / Math.max(temperature, 1e-5) : -Infinity))
  const max = Math.max(...raw)
  const weights = raw.map(x => Math.exp(x - max))
  let u = rng() * weights.reduce((s, x) => s + x, 0)
  for (let i = 0; i < weights.length; i++) {
    u -= weights[i]
    if (u <= 0 && weights[i] > 0) return decodeChord(v, i)
  }
  return decodeChord(v, weights.findIndex(w => w > 0))
}
