/**
 * Note-event utilities — the bridge between ChordCraft's chord model and the
 * FL Studio-style piano roll.
 *
 * The progression (ParsedChord[]) stays the semantic layer: chord cards,
 * analysis, transpose, and the harmony engine all speak chords. The roll and
 * the playback engine speak NoteEvents. Chords → notes is exact (each chord
 * tone becomes one event spanning the chord's window); notes → chords is
 * detection (each window is labelled by the pitches sounding in it), exactly
 * like the old roll's detectChord relabelling — but notes are now free to
 * start anywhere, have any length, and carry velocity.
 */
import { detectChord } from '@/lib/theory/chords'
import type { NoteEvent, ParsedChord } from '@/types'

/** One chord column: where it starts and how long it lasts, in beats. */
export interface ChordWindow {
  start: number
  beats: number
}

const EPS = 1e-6

/** Pitch range the piano roll shows and keeps (C1–B7). */
export const ROLL_LO_MIDI = 24
export const ROLL_HI_MIDI = 107

let _idCounter = 0
export function newNoteId(): string {
  _idCounter += 1
  return `n${_idCounter}-${Math.random().toString(36).slice(2, 6)}`
}

/** Column layout for a progression (`beats` falls back to the global grid). */
export function chordWindows(chords: ParsedChord[], fallbackBeats: number): ChordWindow[] {
  const out: ChordWindow[] = []
  let pos = 0
  for (const c of chords) {
    const beats = c.beats ?? fallbackBeats
    out.push({ start: pos, beats })
    pos += beats
  }
  return out
}

export function totalBeatsOf(windows: ChordWindow[]): number {
  const last = windows[windows.length - 1]
  return last ? last.start + last.beats : 0
}

/** Exact conversion: every chord tone → one block-length note event. */
export function chordsToNotes(
  chords: ParsedChord[],
  fallbackBeats: number,
  velocity = 0.78,
): NoteEvent[] {
  const windows = chordWindows(chords, fallbackBeats)
  const notes: NoteEvent[] = []
  chords.forEach((c, i) => {
    for (const midi of c.notes) {
      notes.push({
        id: newNoteId(),
        midi,
        start: windows[i].start,
        duration: windows[i].beats,
        velocity,
      })
    }
  })
  return notes
}

/**
 * Label each window with the chord formed by the notes sounding in it.
 * Windows keep their duration (`beats`), so the harmonic rhythm is stable
 * under note edits; empty windows come back as rests.
 */
export function detectWindowChords(notes: NoteEvent[], windows: ChordWindow[]): ParsedChord[] {
  return windows.map(w => {
    const end = w.start + w.beats
    const sounding = notes.filter(n => n.start < end - EPS && n.start + n.duration > w.start + EPS)
    const pitches = [...new Set(sounding.map(n => n.midi))].sort((a, b) => a - b)
    return { ...detectChord(pitches), beats: w.beats }
  })
}

/** Grow the window grid with `fallbackBeats`-sized slots until it covers `endBeat`. */
export function extendWindows(
  windows: ChordWindow[],
  endBeat: number,
  fallbackBeats: number,
): ChordWindow[] {
  const fb = Math.max(1, fallbackBeats)
  const out = windows.slice()
  let total = totalBeatsOf(out)
  while (total < endBeat - EPS) {
    out.push({ start: total, beats: fb })
    total += fb
  }
  return out
}

/**
 * Remove window `index` from the note timeline: notes inside it are dropped,
 * notes spanning its edges are trimmed, and everything after shifts left.
 */
export function deleteWindowNotes(
  notes: NoteEvent[],
  windows: ChordWindow[],
  index: number,
): NoteEvent[] {
  const w = windows[index]
  if (!w) return notes
  const end = w.start + w.beats
  const out: NoteEvent[] = []
  for (const n of notes) {
    const nEnd = n.start + n.duration
    if (n.start >= w.start - EPS && n.start < end - EPS) {
      // Starts inside the window: keep only the part that spills past it.
      if (nEnd > end + EPS) out.push({ ...n, start: w.start, duration: nEnd - end })
      continue
    }
    if (n.start < w.start && nEnd > w.start + EPS) {
      // Spans into the window from before: lose the deleted stretch, keep any tail past it.
      out.push({ ...n, duration: nEnd > end + EPS ? n.duration - w.beats : w.start - n.start })
      continue
    }
    if (n.start >= end - EPS) {
      out.push({ ...n, start: n.start - w.beats })
      continue
    }
    out.push(n)
  }
  return out
}
