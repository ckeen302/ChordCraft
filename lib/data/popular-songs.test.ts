import { describe, expect, it } from 'vitest'
import { Midi } from '@tonejs/midi'
import { POPULAR_SONGS, pulsesPerBar, songToParsedChords } from './popular-songs'
import { parseChordStrict } from '@/lib/theory/chords'
import { KEYS } from '@/lib/theory/keys'
import { buildMidiBytes } from '@/lib/midi/export'

const MODES = ['major', 'minor', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'locrian', 'harmonicMinor', 'phrygianDominant']

describe('popular songs data', () => {
  it('is a real library with unique ids and songs', () => {
    expect(POPULAR_SONGS.length).toBeGreaterThanOrEqual(150)
    expect(new Set(POPULAR_SONGS.map(s => s.id)).size).toBe(POPULAR_SONGS.length)
    const songKeys = POPULAR_SONGS.map(s => `${s.artist}|${s.title}`.toLowerCase())
    expect(new Set(songKeys).size).toBe(POPULAR_SONGS.length)
  })

  it('has valid keys, modes, tempos, meters and years', () => {
    for (const s of POPULAR_SONGS) {
      expect(KEYS[s.key], s.id).toBeDefined()
      expect(MODES, s.id).toContain(s.mode)
      expect(s.bpm, s.id).toBeGreaterThanOrEqual(40)
      expect(s.bpm, s.id).toBeLessThanOrEqual(240)
      expect(s.timeSignature, s.id).toMatch(/^\d+\/(4|8)$/)
      expect(s.year, s.id).toBeGreaterThanOrEqual(1600)
      expect(s.year, s.id).toBeLessThanOrEqual(new Date().getFullYear())
      expect(s.title.trim(), s.id).not.toBe('')
      expect(s.artist.trim(), s.id).not.toBe('')
    }
  })

  it('links every song to its TheoryTab source and songbpm tempo check', () => {
    for (const s of POPULAR_SONGS) {
      expect(s.sourceUrl, s.id).toMatch(/^https:\/\/www\.hooktheory\.com\/theorytab\/view\/[\w-]+\/[\w-]+$/)
      expect(s.tempoCheckUrl, s.id).toMatch(/^https:\/\/songbpm\.com\/@[\w-]+\/[\w-]+$/)
      expect(['exact', 'relative', 'differs', 'unavailable'], s.id).toContain(s.keyCheck)
      // The checked tempo agrees with ours, allowing half/double time (×3 in compound meter).
      const ratios = [1, 0.5, 2, ...(s.timeSignature.endsWith('/8') ? [1 / 3, 3, 2 / 3, 1.5] : [])]
      const ok = ratios.some(r => Math.abs(s.bpm - s.tempoCheckBpm * r) <= 0.04 * s.tempoCheckBpm * r)
      expect(ok, `${s.id}: ${s.bpm} vs ${s.tempoCheckBpm}`).toBe(true)
    }
  })

  it('every chord parses strictly and has a positive duration', () => {
    for (const s of POPULAR_SONGS) {
      expect(s.chords.length, s.id).toBeGreaterThanOrEqual(2)
      for (const c of s.chords) {
        expect(() => parseChordStrict(c.symbol), `${s.id}: ${c.symbol}`).not.toThrow()
        expect(c.beats, s.id).toBeGreaterThan(0)
      }
      expect(songToParsedChords(s)).toHaveLength(s.chords.length)
    }
  })

  it('counts metronome pulses per bar from the meter', () => {
    expect(pulsesPerBar('4/4')).toBe(4)
    expect(pulsesPerBar('3/4')).toBe(3)
    expect(pulsesPerBar('6/8')).toBe(2)
    expect(pulsesPerBar('12/8')).toBe(4)
  })
})

describe('popular songs MIDI export', () => {
  it('writes each song at its tempo, meter and exact chord timing', async () => {
    for (const s of POPULAR_SONGS) {
      const chords = songToParsedChords(s)
      const midi = new Midi(await buildMidiBytes(chords, s.bpm, 4, 0, s.timeSignature))
      const [num, den] = s.timeSignature.split('/').map(Number)
      expect(midi.header.timeSignatures[0].timeSignature, s.id).toEqual([num, den])
      const quarterBpm = den === 8 ? s.bpm * 1.5 : s.bpm
      expect(midi.header.tempos[0].bpm, s.id).toBeCloseTo(quarterBpm, 3)

      // Each chord's notes start where the previous chords' beats add up to.
      const secondsPerBeat = 60 / s.bpm
      const starts = [...new Set(midi.tracks[0].notes.map(n => n.time.toFixed(3)))].map(Number)
      let t = 0
      const expected = s.chords.map(c => { const at = t; t += c.beats * secondsPerBeat; return at })
      expect(starts.length, s.id).toBe(expected.length)
      starts.forEach((at, i) => expect(at, `${s.id} chord ${i + 1}`).toBeCloseTo(expected[i], 2))

      // And it plays exactly the chord's notes.
      chords.forEach((c, i) => {
        const notes = midi.tracks[0].notes.filter(n => Math.abs(n.time - expected[i]) < 0.005).map(n => n.midi)
        expect(notes.sort(), `${s.id} chord ${i + 1}`).toEqual([...c.notes].sort())
      })
    }
  })
})
