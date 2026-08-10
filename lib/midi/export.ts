/**
 * MIDI file export using @tonejs/midi.
 *
 * Generates a standards-compliant .mid file from a parsed chord progression
 * and triggers a browser download.
 */
import type { InstrumentName, NoteEvent, ParsedChord } from '@/types'
import { downloadBlob } from '@/lib/utils'

/** Map each app instrument to its closest General MIDI program number. */
export const GM_PROGRAM: Record<InstrumentName, number> = {
  'Piano':          0,   // Acoustic Grand Piano
  'Electric Piano': 4,   // Electric Piano 1
  'Pad':            89,  // Pad 2 (warm)
  'Synth Lead':     80,  // Lead 1 (square)
  'Organ':          16,  // Drawbar Organ
  'Guitar':         24,  // Acoustic Guitar (nylon)
  'Strings':        48,  // String Ensemble 1
  'Bass':           33,  // Electric Bass (finger)
  'Harp':           46,  // Orchestral Harp
  'Bell':           14,  // Tubular Bells
  'Brass':          61,  // Brass Section
}

/**
 * Build a MIDI `Uint8Array` from a chord progression.
 *
 * @param chords       Parsed chord objects (each has a `notes` array of MIDI note numbers).
 * @param bpm          Tempo in beats per minute.
 * @param beatsPerChord How many beats each chord is held (default: 2).
 * @param program      General MIDI instrument program number (0 = Grand Piano).
 */
export async function buildMidiBytes(
  chords: ParsedChord[],
  bpm: number,
  beatsPerChord = 2,
  program = 0,
): Promise<Uint8Array> {
  const { Midi } = await import('@tonejs/midi')

  const midi = new Midi()
  // Set tempo header. update() recomputes each tempo entry's `time` field;
  // without it, @tonejs/midi's seconds→ticks binary search spins forever on
  // the first addNote (undefined `time` never narrows the search bounds).
  midi.header.tempos.push({ bpm, ticks: 0 })
  midi.header.update()

  const track = midi.addTrack()
  track.instrument.number = program
  track.channel = 0

  const secondsPerBeat = 60 / bpm

  // Per-chord `beats` (song progressions) override the uniform grid, so the
  // exported MIDI matches the song's real harmonic rhythm.
  let startTime = 0
  chords.forEach(chord => {
    const chordDuration = secondsPerBeat * (chord.beats ?? beatsPerChord)
    // Leave a slight gap so notes don't bleed
    const noteDuration = chordDuration * 0.92
    chord.notes.forEach(note => {
      track.addNote({
        midi: note,
        time: startTime,
        duration: noteDuration,
        velocity: 0.75,
      })
    })
    startTime += chordDuration
  })

  return midi.toArray()
}

/**
 * Build a MIDI file and immediately download it in the browser.
 *
 * @param chords    Parsed chord progression.
 * @param bpm       Tempo.
 * @param filename  Stem of the downloaded file (`.mid` is appended).
 */
export async function downloadMidi(
  chords: ParsedChord[],
  bpm: number,
  filename = 'chordcraft-progression',
  beatsPerChord = 2,
  program = 0,
): Promise<void> {
  const bytes = await buildMidiBytes(chords, bpm, beatsPerChord, program)
  // Copy into a guaranteed plain ArrayBuffer to satisfy the BlobPart constraint
  // (bytes.buffer may be typed as ArrayBufferLike which includes SharedArrayBuffer).
  const plain = new Uint8Array(bytes)
  const blob = new Blob([plain], { type: 'audio/midi' })
  downloadBlob(blob, `${filename}.mid`)
}

/**
 * Build MIDI from raw note events — exact starts, lengths, and velocities,
 * so piano-roll edits export precisely as drawn.
 */
export async function buildMidiBytesFromNotes(
  notes: NoteEvent[],
  bpm: number,
  program = 0,
): Promise<Uint8Array> {
  const { Midi } = await import('@tonejs/midi')

  const midi = new Midi()
  midi.header.tempos.push({ bpm, ticks: 0 })
  midi.header.update()

  const track = midi.addTrack()
  track.instrument.number = program
  track.channel = 0

  const secondsPerBeat = 60 / bpm
  for (const n of notes) {
    track.addNote({
      midi: n.midi,
      time: n.start * secondsPerBeat,
      // Slight gap so back-to-back notes don't bleed.
      duration: Math.max(0.05, n.duration * secondsPerBeat * 0.96),
      velocity: Math.max(0.05, Math.min(1, n.velocity)),
    })
  }
  return midi.toArray()
}

/** Download a note-event timeline as a .mid file. */
export async function downloadMidiFromNotes(
  notes: NoteEvent[],
  bpm: number,
  filename = 'chordcraft-progression',
  program = 0,
): Promise<void> {
  const bytes = await buildMidiBytesFromNotes(notes, bpm, program)
  const plain = new Uint8Array(bytes)
  const blob = new Blob([plain], { type: 'audio/midi' })
  downloadBlob(blob, `${filename}.mid`)
}
