/**
 * Central Zustand store.
 *
 * Holds all shared UI + playback state. Audio side-effects are performed in
 * `hooks/useTransport` — this store is pure data.
 *
 * Two linked layers describe what's loaded:
 *  - `progression` (ParsedChord[]) — the semantic layer: chord cards,
 *    analysis, MIDI program choice.
 *  - `noteEvents` (NoteEvent[]) — the playable layer the transport schedules
 *    and the piano roll edits. Auto-derived from the progression on load;
 *    freeform roll edits make it custom (`notesCustom`), after which the
 *    global beats-per-chord no longer re-times it.
 */
import { create } from 'zustand'
import { chordsToNotes } from '@/lib/roll/notes'
import type { InstrumentName, NoteEvent, ParsedChord } from '@/types'

interface AppState {
  // ── Progression ─────────────────────────────────────────────────────────
  progression: ParsedChord[]
  noteEvents: NoteEvent[]
  /** True once the roll has made freeform note edits (notes ≠ chord blocks). */
  notesCustom: boolean
  source: string
  loadProgression: (chords: ParsedChord[], source: string) => void
  /**
   * Load chords together with an exact note timeline (piano-roll edits).
   * Playback state is untouched when the same source is already playing —
   * use updateProgressionAndNotes for that; this resets the transport.
   */
  loadProgressionWithNotes: (chords: ParsedChord[], notes: NoteEvent[], source: string) => void
  /**
   * Replace chords + notes in place — playback state is untouched, so
   * piano-roll edits apply live while the transport keeps running.
   */
  updateProgressionAndNotes: (chords: ParsedChord[], notes: NoteEvent[], source?: string) => void

  // ── Playback ─────────────────────────────────────────────────────────────
  isPlaying: boolean
  isPaused: boolean
  /** True while Play is initialising audio / streaming instrument samples. */
  audioLoading: boolean
  /** Index of the chord card currently highlighted (-1 = none). */
  currentChordIndex: number
  setPlaying: (playing: boolean) => void
  setPaused: (paused: boolean) => void
  setAudioLoading: (loading: boolean) => void
  setCurrentChordIndex: (index: number) => void

  // ── Transport settings ───────────────────────────────────────────────────
  bpm: number
  volume: number
  instrument: InstrumentName
  /**
   * True once the user has explicitly picked an instrument (dropdowns or a
   * saved default). While set, Smart Generate's "auto sound" never overrides
   * the choice; re-enabling the Auto toggle opts back into mood timbres.
   */
  instrumentTouched: boolean
  /** Metronome accent grouping (3 for 3/4, 2 for 6/8, 4 otherwise). */
  beatsPerBar: number
  setBeatsPerBar: (beats: number) => void
  beatsPerChord: 1 | 2 | 4
  loopEnabled: boolean
  metronomeEnabled: boolean
  setBpm: (bpm: number) => void
  setVolume: (volume: number) => void
  setInstrument: (instrument: InstrumentName) => void
  /** User-initiated instrument pick — also marks instrumentTouched. */
  chooseInstrument: (instrument: InstrumentName) => void
  setInstrumentTouched: (touched: boolean) => void
  setBeatsPerChord: (beats: 1 | 2 | 4) => void
  setLoopEnabled: (enabled: boolean) => void
  setMetronomeEnabled: (enabled: boolean) => void
}

export const useStore = create<AppState>((set, get) => ({
  // Progression
  progression: [],
  noteEvents: [],
  notesCustom: false,
  source: '',
  loadProgression: (chords, source) =>
    set({
      progression: chords,
      noteEvents: chordsToNotes(chords, get().beatsPerChord),
      notesCustom: false,
      source,
      currentChordIndex: -1,
      isPlaying: false,
      isPaused: false,
      beatsPerBar: 4,   // songs override after loading (3/4, 6/8, …)
    }),
  loadProgressionWithNotes: (chords, notes, source) =>
    set({
      progression: chords,
      noteEvents: notes,
      notesCustom: true,
      source,
      currentChordIndex: -1,
      isPlaying: false,
      isPaused: false,
    }),
  updateProgressionAndNotes: (chords, notes, source) =>
    set(source === undefined
      ? { progression: chords, noteEvents: notes, notesCustom: true }
      : { progression: chords, noteEvents: notes, notesCustom: true, source }),

  // Playback
  isPlaying: false,
  isPaused: false,
  audioLoading: false,
  currentChordIndex: -1,
  setPlaying: playing => set({ isPlaying: playing }),
  setPaused: paused => set({ isPaused: paused }),
  setAudioLoading: loading => set({ audioLoading: loading }),
  setCurrentChordIndex: index => set({ currentChordIndex: index }),

  // Transport
  bpm: 100,
  volume: 80,
  instrument: 'Piano',
  instrumentTouched: false,
  beatsPerChord: 2,
  loopEnabled: false,
  metronomeEnabled: false,
  setBpm: bpm => set({ bpm }),
  setVolume: volume => set({ volume }),
  setInstrument: instrument => set({ instrument }),
  chooseInstrument: instrument => set({ instrument, instrumentTouched: true }),
  setInstrumentTouched: touched => set({ instrumentTouched: touched }),
  beatsPerBar: 4,
  setBeatsPerBar: beats => set({ beatsPerBar: beats }),
  setBeatsPerChord: beatsPerChord =>
    set(state => ({
      beatsPerChord,
      // Chord-block timelines follow the global grid live; custom note
      // timelines are absolute (FL-style) and stay put.
      noteEvents: state.notesCustom
        ? state.noteEvents
        : chordsToNotes(state.progression, beatsPerChord),
    })),
  setLoopEnabled: loopEnabled => set({ loopEnabled }),
  setMetronomeEnabled: metronomeEnabled => set({ metronomeEnabled }),
}))
