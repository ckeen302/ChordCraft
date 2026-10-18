import { describe, expect, it } from 'vitest'
import { chordWindows, chordsToNotes, deleteWindowNotes, detectWindowChords, extendWindows, totalBeatsOf } from './notes'
import { parseChord } from '@/lib/theory/chords'

const prog = [{ ...parseChord('C'), beats: 4 }, parseChord('G'), { ...parseChord('Am'), beats: 1 }]

describe('chord windows', () => {
  it('lays out per-chord beats with a global fallback', () => {
    expect(chordWindows(prog, 2)).toEqual([
      { start: 0, beats: 4 }, { start: 4, beats: 2 }, { start: 6, beats: 1 },
    ])
    expect(totalBeatsOf(chordWindows(prog, 2))).toBe(7)
  })

  it('extends the grid to cover trailing notes', () => {
    const w = extendWindows(chordWindows(prog, 2), 10, 2)
    expect(totalBeatsOf(w)).toBe(11)
  })
})

describe('chordsToNotes / detectWindowChords', () => {
  it('round-trips chords through the note timeline', () => {
    const windows = chordWindows(prog, 2)
    const notes = chordsToNotes(prog, 2)
    expect(notes).toHaveLength(9)
    expect(new Set(notes.map(n => n.id)).size).toBe(9)
    expect(detectWindowChords(notes, windows).map(c => c.symbol)).toEqual(['C', 'G', 'Am'])
  })
})

describe('deleteWindowNotes', () => {
  it('drops the window and shifts later notes left', () => {
    const windows = chordWindows(prog, 2)
    const out = deleteWindowNotes(chordsToNotes(prog, 2), windows, 1)
    expect(out).toHaveLength(6)
    expect(Math.max(...out.map(n => n.start))).toBe(4)
  })

  it('trims a note that spans into the deleted window', () => {
    const notes = [{ id: 'a', midi: 60, start: 2, duration: 4, velocity: 0.8 }]
    const out = deleteWindowNotes(notes, [{ start: 0, beats: 4 }, { start: 4, beats: 2 }], 1)
    expect(out).toEqual([{ id: 'a', midi: 60, start: 2, duration: 2, velocity: 0.8 }])
  })
})
