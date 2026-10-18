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
      if (s.year !== null) {
        expect(s.year, s.id).toBeGreaterThanOrEqual(1600)
        expect(s.year, s.id).toBeLessThanOrEqual(new Date().getFullYear())
      } else {
        expect(s.yearSourceUrl, s.id).toBeUndefined()
      }
      expect(s.title.trim(), s.id).not.toBe('')
      expect(s.artist.trim(), s.id).not.toBe('')
    }
  })

  it('confirms every song\'s chords against a Songsterr transcription', () => {
    for (const s of POPULAR_SONGS) {
      expect(s.chordCheckUrl, s.id).toMatch(/^https:\/\/www\.songsterr\.com\/a\/wsa\/[\w-]+-tab-s\d+$/)
      expect(['same', 'transposed'], s.id).toContain(s.chordCheckKey)
      // A tab in another key confirms the progression's shape; the key then needs songbpm.
      if (s.chordCheckKey === 'transposed') expect(['exact', 'relative'], s.id).toContain(s.keyCheck)
      if (s.yearSourceUrl) {
        expect(s.yearSourceUrl, s.id).toMatch(/^https:\/\/(musicbrainz\.org\/recording|www\.wikidata\.org\/entity)\/[\w-]+$/)
      }
    }
  })

  it('links every song to its TheoryTab source and songbpm tempo check', () => {
    for (const s of POPULAR_SONGS) {
      expect(s.sourceUrl, s.id).toMatch(/^https:\/\/www\.hooktheory\.com\/theorytab\/view\/[\w-]+\/[\w-]+$/)
      expect(s.tempoCheckUrl, s.id).toMatch(/^https:\/\/songbpm\.com\/@[\w-]+\/[\w-]+$/)
      expect(['exact', 'relative', 'differs', 'unavailable'], s.id).toContain(s.keyCheck)
      // A checked tempo agrees with ours, allowing half/double time (×3 in compound meter):
      // songbpm's, or where it disagreed, the Songsterr tab that settled it.
      const compound = s.timeSignature.endsWith('/8') || ['6/4', '12/4'].includes(s.timeSignature)
      // A tab may notate a triplet feel in a triple meter (12/8, 6/4) that TheoryTab writes in 4/4.
      const ratios = [1, 0.5, 2, ...(compound || s.tempoSourceUrl ? [1 / 3, 3, 2 / 3, 1.5] : [])]
      const agrees = (check: number) => ratios.some(r => Math.abs(s.bpm - check * r) <= 0.04 * check * r)
      if (s.tempoSourceUrl) {
        expect(s.tempoSourceUrl, s.id).toMatch(/^https:\/\/www\.songsterr\.com\/a\/wsa\/[\w-]+-tab-s\d+$/)
        expect(s.tempoSourceBpm, s.id).toBeDefined()
      }
      const check = s.tempoSourceUrl ? s.tempoSourceBpm! : s.tempoCheckBpm
      expect(agrees(check), `${s.id}: ${s.bpm} vs ${check}`).toBe(true)
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
      // MIDI stores tempo as whole microseconds per quarter note: compare in that unit, ±1 µs.
      expect(Math.abs(60e6 / midi.header.tempos[0].bpm - 60e6 / quarterBpm), s.id).toBeLessThanOrEqual(1)

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

  it('round-trips chord count, total beats and tempo exactly, on the DAW grid', async () => {
    for (const s of POPULAR_SONGS) {
      const midi = new Midi(await buildMidiBytes(songToParsedChords(s), s.bpm, 4, 0, s.timeSignature))
      const [num, den] = s.timeSignature.split('/').map(Number)
      const quartersPerBeat = den === 8 && num % 3 === 0 ? 1.5 : 1
      const ppq = midi.header.ppq
      const notes = midi.tracks[0].notes

      // Chord count: one onset per stored chord.
      const onsets = [...new Set(notes.map(n => n.ticks))].sort((a, b) => a - b)
      expect(onsets.length, s.id).toBe(s.chords.length)

      // Each chord starts on the tick its stored beats put it on (±1 tick of rounding).
      let beats = 0
      s.chords.forEach((c, i) => {
        expect(Math.abs(onsets[i] - beats * quartersPerBeat * ppq), `${s.id} chord ${i + 1}`).toBeLessThanOrEqual(1)
        beats += c.beats
      })

      // Total length: the last chord ends at the stored total (notes are held 92% of each chord).
      const last = s.chords[s.chords.length - 1].beats
      const end = Math.max(...notes.map(n => n.ticks + n.durationTicks))
      const expectedEnd = (beats - last * 0.08) * quartersPerBeat * ppq
      expect(Math.abs(end - expectedEnd), `${s.id} total beats`).toBeLessThanOrEqual(2)

      // Tempo: the file plays at the stored BPM (quarter-note BPM in compound meter).
      expect(midi.header.tempos.length, s.id).toBe(1)
      expect(Math.abs(60e6 / midi.header.tempos[0].bpm - 60e6 / (s.bpm * quartersPerBeat)), s.id).toBeLessThanOrEqual(1)
      expect(midi.duration, s.id).toBeCloseTo((beats - last * 0.08) * 60 / s.bpm, 2)
    }
  })
})
