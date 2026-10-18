/**
 * Arpeggiator — turns the notes in each chord column into a broken-chord
 * pattern. It's a pure function of the block notes, so the lab can keep the
 * block chords as the source of truth and flip the arp on and off freely.
 */
import { newNoteId, ROLL_HI_MIDI, type ChordWindow } from '@/lib/roll/notes'
import type { NoteEvent } from '@/types'

export type ArpPattern = 'up' | 'down' | 'updown' | 'random'
export type ArpRate = '1/4' | '1/8' | '1/8t' | '1/16'

export interface ArpSettings {
  pattern: ArpPattern
  rate: ArpRate
  octaves: 1 | 2
  /** Fraction of each step the note sounds (0.5 = plucky, 0.95 = legato). */
  gate: number
  /** Hold the lowest note under the whole chord and arpeggiate the rest. */
  holdBass: boolean
}

export const DEFAULT_ARP: ArpSettings = {
  pattern: 'up', rate: '1/8', octaves: 1, gate: 0.95, holdBass: false,
}

export const ARP_PATTERNS: { value: ArpPattern; label: string }[] = [
  { value: 'up', label: 'Up' },
  { value: 'down', label: 'Down' },
  { value: 'updown', label: 'Up-Down' },
  { value: 'random', label: 'Random' },
]

export const ARP_RATES: { value: ArpRate; label: string }[] = [
  { value: '1/4', label: '1/4' },
  { value: '1/8', label: '1/8' },
  { value: '1/8t', label: '1/8T' },
  { value: '1/16', label: '1/16' },
]

const STEP_BEATS: Record<ArpRate, number> = { '1/4': 1, '1/8': 0.5, '1/8t': 1 / 3, '1/16': 0.25 }
const EPS = 1e-6

/** Small deterministic PRNG so "Random" gives the same arp every time it's toggled on. */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The order pitches are played in for one cycle of the pattern. */
function cycle(pitches: number[], pattern: ArpPattern): number[] {
  const up = [...pitches].sort((a, b) => a - b)
  if (pattern === 'down') return up.reverse()
  if (pattern === 'updown') return up.length > 2 ? [...up, ...up.slice(1, -1).reverse()] : up
  return up
}

/** Validate settings read from storage; anything unknown falls back to the default. */
export function sanitizeArp(raw: unknown): ArpSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ArpSettings>
  return {
    pattern: ARP_PATTERNS.some(p => p.value === r.pattern) ? r.pattern! : DEFAULT_ARP.pattern,
    rate: ARP_RATES.some(p => p.value === r.rate) ? r.rate! : DEFAULT_ARP.rate,
    octaves: r.octaves === 2 ? 2 : 1,
    gate: typeof r.gate === 'number' && r.gate >= 0.1 && r.gate <= 1 ? r.gate : DEFAULT_ARP.gate,
    holdBass: r.holdBass === true,
  }
}

/**
 * Arpeggiate every chord column. Each column's pitches are the notes that
 * start inside it; columns restart the pattern so it lines up with the
 * chord changes. Notes starting outside every column are kept as they are.
 */
export function arpeggiate(notes: NoteEvent[], windows: ChordWindow[], opts: ArpSettings): NoteEvent[] {
  const step = STEP_BEATS[opts.rate]
  const out: NoteEvent[] = []
  const used = new Set<NoteEvent>()

  windows.forEach((w, wi) => {
    const end = w.start + w.beats
    const inside = notes.filter(n => n.start >= w.start - EPS && n.start < end - EPS)
    if (!inside.length) return
    inside.forEach(n => used.add(n))

    const vel = inside.reduce((s, n) => s + n.velocity, 0) / inside.length
    let pitches = [...new Set(inside.map(n => n.midi))].sort((a, b) => a - b)

    if (opts.holdBass && pitches.length >= 3) {
      out.push({ id: newNoteId(), midi: pitches[0], start: w.start, duration: w.beats, velocity: vel * 0.85 })
      pitches = pitches.slice(1)
    }
    if (opts.octaves === 2) {
      const top = pitches.map(p => p + 12).filter(p => p <= ROLL_HI_MIDI && !pitches.includes(p))
      pitches = [...pitches, ...top]
    }

    const order = cycle(pitches, opts.pattern)
    const rand = mulberry32(wi * 7919 + pitches.reduce((s, p) => s * 31 + p, 17))
    let prev = -1
    let i = 0
    for (let t = 0; t < w.beats - EPS; t += step, i++) {
      let midi: number
      if (opts.pattern === 'random' && order.length > 1) {
        do { midi = order[Math.floor(rand() * order.length)] } while (midi === prev)
      } else {
        midi = order[i % order.length]
      }
      prev = midi
      const len = Math.min(step, w.beats - t)
      // Accent the downbeats a little so the pattern grooves instead of ticking.
      const onBeat = Math.abs(t - Math.round(t)) < EPS
      out.push({
        id: newNoteId(),
        midi,
        start: w.start + t,
        duration: Math.max(0.05, len * opts.gate),
        velocity: Math.min(1, onBeat ? vel * 1.05 : vel * 0.88),
      })
    }
  })

  for (const n of notes) if (!used.has(n)) out.push(n)
  return out
}
