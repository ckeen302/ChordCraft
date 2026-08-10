'use client'

/**
 * useTransport — note-level playback engine.
 *
 * Replaces the old chord-block setTimeout chain with a lookahead scheduler
 * over NoteEvents (FL Studio-style): every note has its own start, length,
 * and velocity, so freeform piano-roll edits play back exactly as drawn.
 *
 * Design:
 * - A 25 ms setInterval advances a beat-position clock (posBeats) using the
 *   live BPM, and schedules every note whose start falls inside a ~120 ms
 *   lookahead window via engine.playNote(midi, dur, when, velocity).
 * - Notes sharing a start time form a "group": groups of 3+ get the classic
 *   sub-octave root doubling and the mood's strum/roll stagger, so chords
 *   keep the fat, humanised sound of the old engine. On Bass, a group plays
 *   as just its root an octave down.
 * - Pause freezes posBeats; resume continues mid-chord. Loop wraps the clock.
 *   Live BPM changes take effect on the next tick (≤25 ms).
 * - The playhead position is published module-level (getPlayheadBeats) so the
 *   piano roll can animate at rAF rate without React re-renders.
 * - currentChordIndex is derived from the chord windows at the playhead, so
 *   chord cards highlight exactly as before.
 */
import { useCallback, useEffect, useRef } from 'react'
import { useStore } from '@/store/useStore'
import {
  ensureAudioReady,
  playNote,
  stopAllNotes,
  setVolume,
  switchInstrument,
  getChordRoll,
} from '@/lib/audio/engine'
import { startMetronome, stopMetronome } from '@/lib/audio/metronome'
import { chordWindows, totalBeatsOf, type ChordWindow } from '@/lib/roll/notes'
import type { NoteEvent } from '@/types'

const SCHED_INTERVAL_MS = 25
const LOOKAHEAD_SEC = 0.12
/** Extra beats after the last note before a non-looping run stops. */
const TAIL_BEATS = 0.25

// ── Shared playhead clock (read by the piano roll at rAF rate) ──────────────
// Lives on globalThis rather than module scope: bundler chunk splitting or
// HMR can instantiate this module more than once, and a plain module `let`
// would leave readers on a dead copy (playhead frozen at 0).
interface PlayheadSlot { beats: number; total: number }
const _playhead: PlayheadSlot =
  ((globalThis as unknown as { __chordcraftPlayhead?: PlayheadSlot }).__chordcraftPlayhead ??= {
    beats: 0,
    total: 0,
  })
export function getPlayheadBeats(): { beats: number; total: number } {
  return { beats: _playhead.beats, total: _playhead.total }
}

export function useTransport() {
  const {
    bpm, volume, instrument,
    beatsPerChord, loopEnabled, metronomeEnabled,
    isPlaying, isPaused,
    setPlaying, setPaused, setCurrentChordIndex,
  } = useStore()
  const progression = useStore(s => s.progression)
  const noteEvents  = useStore(s => s.noteEvents)

  // Refs keep the scheduler free of stale closures.
  const notesRef      = useRef<NoteEvent[]>([])       // sorted by start
  const windowsRef    = useRef<ChordWindow[]>([])
  const totalRef      = useRef(0)
  const bpmRef        = useRef(bpm)
  const volumeRef     = useRef(volume)
  const instrumentRef = useRef(instrument)
  const loopRef       = useRef(loopEnabled)
  const metronomeRef  = useRef(metronomeEnabled)
  const isPlayingRef  = useRef(isPlaying)

  const timerRef      = useRef<ReturnType<typeof setInterval> | null>(null)
  const posBeatsRef   = useRef(0)      // absolute beats since play start (unwrapped)
  const lastNowRef    = useRef(0)      // performance.now() of the last tick
  const idxRef        = useRef(0)      // pointer into notesRef for scheduling
  const occBaseRef    = useRef(0)      // beat offset of the current loop pass
  const curWinRef     = useRef(-1)
  const startingRef   = useRef(false)

  useEffect(() => { loopRef.current = loopEnabled },          [loopEnabled])
  useEffect(() => { metronomeRef.current = metronomeEnabled },[metronomeEnabled])
  useEffect(() => { isPlayingRef.current = isPlaying },       [isPlaying])

  // Sync instrument changes immediately.
  useEffect(() => {
    instrumentRef.current = instrument
    switchInstrument(instrument)
  }, [instrument])

  // Sync volume immediately.
  useEffect(() => {
    volumeRef.current = volume
    setVolume(volume / 100)
  }, [volume])

  // ── Timeline sync: notes / windows / totals follow the store live ────────
  useEffect(() => {
    notesRef.current = [...noteEvents].sort((a, b) => a.start - b.start || a.midi - b.midi)
    windowsRef.current = chordWindows(progression, beatsPerChord)
    const total = Math.max(
      totalBeatsOf(windowsRef.current),
      ...notesRef.current.map(n => n.start + n.duration),
      0,
    )
    totalRef.current = total
    _playhead.total = total
    // Mid-play edits: re-aim the scheduling pointer at the playhead so new
    // notes are picked up and deleted ones aren't retriggered.
    if (timerRef.current !== null) _rebuildPointer()
  }, [noteEvents, progression, beatsPerChord])

  // ── Live BPM: the clock reads bpmRef each tick; just re-time the click ───
  useEffect(() => {
    bpmRef.current = bpm
    if (isPlayingRef.current && metronomeRef.current) startMetronome(bpm, useStore.getState().beatsPerBar)
  }, [bpm])

  // ── Metronome toggle (transport-tied: clicks only while playing) ─────────
  useEffect(() => {
    metronomeRef.current = metronomeEnabled
    if (metronomeEnabled && isPlayingRef.current) {
      startMetronome(bpmRef.current, useStore.getState().beatsPerBar)
    } else {
      stopMetronome()
    }
  }, [metronomeEnabled])

  // ── Scheduler internals ───────────────────────────────────────────────────

  function _rebuildPointer() {
    const total = totalRef.current
    const pos = posBeatsRef.current
    occBaseRef.current = loopRef.current && total > 0 ? Math.floor(pos / total) * total : 0
    const posInPass = pos - occBaseRef.current
    const notes = notesRef.current
    let i = 0
    while (i < notes.length && notes[i].start < posInPass - 1e-6) i++
    idxRef.current = i
  }

  /** Play one same-start group of notes with doubling + strum articulation. */
  function _playGroup(group: NoteEvent[], whenSec: number) {
    const spb = 60 / bpmRef.current
    const rollSec = getChordRoll() / 1000
    const sorted = [...group].sort((a, b) => a.midi - b.midi)
    const isChord = sorted.length >= 3

    if (instrumentRef.current === 'Bass') {
      // Bass condenses chords to the root an octave down; single notes drop too.
      const src = isChord ? [sorted[0]] : sorted
      src.forEach(n => playNote(n.midi - 12, n.duration * spb * 0.9, whenSec, n.velocity))
      return
    }

    if (isChord) {
      // Sub-octave root doubling for a fuller foundation (as playChord did).
      const root = sorted[0]
      playNote(root.midi - 12, root.duration * spb * 0.9, whenSec, root.velocity)
    }
    sorted.forEach((n, i) =>
      playNote(n.midi, n.duration * spb * 0.9, whenSec + i * rollSec, n.velocity),
    )
  }

  const _clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  function _finish() {
    _clearTimer()
    stopAllNotes()
    stopMetronome()
    posBeatsRef.current = 0
    _playhead.beats = 0
    curWinRef.current = -1
    setCurrentChordIndex(-1)
    setPlaying(false)
    setPaused(false)
  }

  function _tick() {
    const now = performance.now()
    const bpmNow = bpmRef.current
    const total = totalRef.current
    const loop = loopRef.current
    const notes = notesRef.current

    posBeatsRef.current += ((now - lastNowRef.current) / 1000) * (bpmNow / 60)
    lastNowRef.current = now
    const pos = posBeatsRef.current

    if (total <= 0) { _finish(); return }

    // End of a non-looping run (small tail so the last chord isn't clipped).
    if (!loop && pos >= total + TAIL_BEATS) { _finish(); return }

    // Schedule everything starting inside the lookahead horizon.
    const horizon = pos + LOOKAHEAD_SEC * (bpmNow / 60)
    while (notes.length) {
      if (idxRef.current >= notes.length) {
        if (!loop) break
        occBaseRef.current += total
        idxRef.current = 0
      }
      const i = idxRef.current
      const absStart = occBaseRef.current + notes[i].start
      if (absStart >= horizon) break
      // Collect the same-start group.
      let j = i
      while (j < notes.length && Math.abs(notes[j].start - notes[i].start) < 1e-6) j++
      const whenSec = Math.max(0, (absStart - pos) * (60 / bpmNow))
      _playGroup(notes.slice(i, j), whenSec)
      idxRef.current = j
    }

    // Publish the playhead + derive the highlighted chord window.
    const posLoop = loop ? pos % total : Math.min(pos, total)
    _playhead.beats = posLoop
    const windows = windowsRef.current
    let win = -1
    for (let k = 0; k < windows.length; k++) {
      if (posLoop >= windows[k].start - 1e-6 && posLoop < windows[k].start + windows[k].beats - 1e-6) {
        win = k
        break
      }
    }
    if (win !== curWinRef.current) {
      curWinRef.current = win
      setCurrentChordIndex(win)
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  const play = useCallback(async () => {
    if (!notesRef.current.length && totalRef.current <= 0) return
    // Re-entrancy guard: a second Play/Space during the async audio init
    // would double-start the scheduler.
    if (startingRef.current || timerRef.current !== null) return
    startingRef.current = true

    try {
      useStore.getState().setAudioLoading(true)
      try {
        await ensureAudioReady(instrumentRef.current)
      } finally {
        useStore.getState().setAudioLoading(false)
      }
      setVolume(volumeRef.current / 100)

      // Resume from pause preserves position; fresh start (or a pause that
      // landed past the end) begins at 0.
      if (!isPaused || posBeatsRef.current >= totalRef.current) {
        posBeatsRef.current = 0
      }
      lastNowRef.current = performance.now()
      _rebuildPointer()

      timerRef.current = setInterval(_tick, SCHED_INTERVAL_MS)
      _tick() // fire the first notes immediately

      setPlaying(true)
      setPaused(false)

      if (metronomeRef.current) {
        startMetronome(bpmRef.current, useStore.getState().beatsPerBar)
      }
    } finally {
      startingRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPaused, setPlaying, setPaused, setCurrentChordIndex])

  const pause = useCallback(() => {
    _clearTimer()
    stopAllNotes()
    stopMetronome()
    // posBeatsRef keeps the position for resume; playhead stays parked.
    setPlaying(false)
    setPaused(true)
  }, [_clearTimer, setPlaying, setPaused])

  const stop = useCallback(() => {
    _clearTimer()
    stopAllNotes()
    stopMetronome()
    posBeatsRef.current = 0
    _playhead.beats = 0
    curWinRef.current = -1
    setPlaying(false)
    setPaused(false)
    setCurrentChordIndex(-1)
  }, [_clearTimer, setPlaying, setPaused, setCurrentChordIndex])

  // ── Space-bar + M keyboard shortcuts ─────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if (e.code === 'Space') {
        e.preventDefault()
        const state = useStore.getState()
        if (state.isPlaying) pause()
        else play()
      }

      if (e.code === 'KeyM') {
        e.preventDefault()
        const state = useStore.getState()
        state.setMetronomeEnabled(!state.metronomeEnabled)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [play, pause])

  // ── External stop (e.g. loadProgression resets isPlaying + isPaused) ─────
  useEffect(() => {
    if (!isPlaying && !isPaused && timerRef.current !== null) {
      _clearTimer()
      stopAllNotes()
      stopMetronome()
      posBeatsRef.current = 0
      _playhead.beats = 0
      curWinRef.current = -1
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, isPaused])

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => () => { _clearTimer(); stopMetronome() }, [_clearTimer])

  return { play, pause, stop, isPlaying, isPaused }
}
