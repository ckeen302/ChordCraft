import { describe, expect, it } from 'vitest'
import { arpeggiate, DEFAULT_ARP, sanitizeArp, type ArpSettings } from './arp'
import { chordWindows, chordsToNotes } from './notes'
import type { ParsedChord } from '@/types'

const chord = (notes: number[], beats = 2): ParsedChord =>
  ({ symbol: 'X', root: 'C', quality: '', displayQuality: '', notes, beats }) as unknown as ParsedChord

const run = (chords: ParsedChord[], opts: Partial<ArpSettings> = {}) => {
  const notes = chordsToNotes(chords, 2)
  return arpeggiate(notes, chordWindows(chords, 2), { ...DEFAULT_ARP, ...opts })
    .sort((a, b) => a.start - b.start || a.midi - b.midi)
}

describe('arpeggiate', () => {
  it('plays chord tones upward in eighth notes', () => {
    const out = run([chord([60, 64, 67])])
    expect(out.map(n => n.midi)).toEqual([60, 64, 67, 60])
    expect(out.map(n => n.start)).toEqual([0, 0.5, 1, 1.5])
  })

  it('restarts the pattern on each chord', () => {
    const out = run([chord([60, 64, 67], 1), chord([65, 69, 72], 1)])
    expect(out.map(n => n.midi)).toEqual([60, 64, 65, 69])
  })

  it('down and up-down orders', () => {
    expect(run([chord([60, 64, 67])], { pattern: 'down' }).map(n => n.midi)).toEqual([67, 64, 60, 67])
    expect(run([chord([60, 64, 67], 4)], { pattern: 'updown' }).map(n => n.midi))
      .toEqual([60, 64, 67, 64, 60, 64, 67, 64])
  })

  it('random is deterministic and never repeats a note back to back', () => {
    const a = run([chord([60, 64, 67, 71], 4)], { pattern: 'random', rate: '1/16' }).map(n => n.midi)
    const b = run([chord([60, 64, 67, 71], 4)], { pattern: 'random', rate: '1/16' }).map(n => n.midi)
    expect(a).toEqual(b)
    expect(a).toHaveLength(16)
    for (let i = 1; i < a.length; i++) expect(a[i]).not.toBe(a[i - 1])
  })

  it('holds the bass and spans two octaves', () => {
    const out = run([chord([48, 64, 67])], { holdBass: true, octaves: 2 })
    const bass = out.filter(n => n.midi === 48)
    expect(bass).toHaveLength(1)
    expect(bass[0].duration).toBe(2)
    expect(out.filter(n => n.midi !== 48).map(n => n.midi)).toEqual([64, 67, 76, 79])
  })

  it('triplets fill the window exactly', () => {
    const out = run([chord([60, 64, 67], 1)], { rate: '1/8t' })
    expect(out).toHaveLength(3)
    const last = out[2]
    expect(last.start + last.duration).toBeLessThanOrEqual(1 + 1e-9)
  })

  it('skips empty columns and keeps the chord length', () => {
    const chords = [chord([60, 64, 67]), chord([], 2), chord([62, 65, 69])]
    const out = run(chords)
    expect(out.some(n => n.start >= 2 && n.start < 4)).toBe(false)
    expect(Math.max(...out.map(n => n.start + n.duration))).toBeLessThanOrEqual(6)
  })
})

describe('sanitizeArp', () => {
  it('falls back to defaults for junk', () => {
    expect(sanitizeArp(null)).toEqual(DEFAULT_ARP)
    expect(sanitizeArp({ pattern: 'sideways', rate: 3, octaves: 9, gate: 7 })).toEqual(DEFAULT_ARP)
    expect(sanitizeArp({ pattern: 'down', rate: '1/16', octaves: 2, gate: 0.5, holdBass: true }))
      .toEqual({ pattern: 'down', rate: '1/16', octaves: 2, gate: 0.5, holdBass: true })
  })
})
