'use client'

/**
 * useProgressionEditor — the Chord Lab's working progression and everything
 * that edits it: undo/redo snapshots, recent-generation history, saved
 * favourites, piano-roll edits, chord-column add/delete, and transpose.
 *
 * Generators (the rule engine today, the AI backend next) hand finished
 * chords to `loadGenerated`; the hook owns undo, history, and keeping the
 * transport in sync, so every source behaves identically.
 */
import { useEffect, useRef, useState } from 'react'
import { useStore } from '@/store/useStore'
import { KEY_NAMES } from '@/lib/theory/keys'
import { parseChords, detectChord } from '@/lib/theory/chords'
import { voiceLeadProgression } from '@/lib/theory/voicing'
import { transposeProgression, transposeKeyName, keyPrefersFlats } from '@/lib/theory/transpose'
import {
  chordsToNotes, chordWindows, detectWindowChords, deleteWindowNotes,
  newNoteId, totalBeatsOf, type ChordWindow,
} from '@/lib/roll/notes'
import {
  readHistory, persistHistory, clearStoredHistory, HISTORY_MAX,
  readSaved, persistSaved, SAVED_MAX,
  type HistoryEntry, type SavedProg,
} from '@/lib/persistence'
import type { Mood } from '@/lib/theory/harmony'
import type { NoteEvent, ParsedChord } from '@/types'

interface Snapshot {
  chords: ParsedChord[]
  notes: NoteEvent[]
  romans: string[]
  patternName: string
  key: string
  /** Which mood actually generated this snapshot, when mood was 'random'. */
  rolledMood: Mood | null
}

const UNDO_MAX = 50

export interface GeneratedProgression {
  chords: ParsedChord[]
  romans?: string[]
  patternName?: string
  rolledMood?: Mood | null
}

export function useProgressionEditor({ active }: { active: boolean }) {
  const loadProgression = useStore(s => s.loadProgression)

  // Keyboard shortcuts must not fire while another tab is shown.
  const activeRef = useRef(active)
  activeRef.current = active

  const [selectedKey, setSelectedKey] = useState('C Major')
  const [rolledMood, setRolledMood]   = useState<Mood | null>(null)
  const [romans, setRomans]           = useState<string[]>([])
  const [patternName, setPatternName] = useState('')
  const [localChords, setLocalChords] = useState<ParsedChord[]>([])
  const [localNotes, setLocalNotes]   = useState<NoteEvent[]>([])
  const [history, setHistory]         = useState<HistoryEntry[]>([])
  const [saved, setSaved]             = useState<SavedProg[]>([])
  const [past, setPast]               = useState<Snapshot[]>([])
  const [future, setFuture]           = useState<Snapshot[]>([])

  // localStorage is browser-only — hydrate after mount.
  useEffect(() => {
    setHistory(readHistory())
    setSaved(readSaved())
  }, [])

  // ── Transport sync ─────────────────────────────────────────────────────────
  // Live-update the transport only when it's playing this lab's progression;
  // otherwise (re)load, which also stops playback of e.g. a Popular Song.
  function syncTransport(chords: ParsedChord[], key: string, notes: NoteEvent[]) {
    const st = useStore.getState()
    if (st.progression.length && st.source.startsWith('Chord Lab')) {
      st.updateProgressionAndNotes(chords, notes)
    } else {
      st.loadProgressionWithNotes(chords, notes, `Chord Lab · ${key}`)
    }
  }

  // ── Undo / redo ────────────────────────────────────────────────────────────

  function snapshot(): Snapshot {
    return { chords: localChords, notes: localNotes, romans, patternName, key: selectedKey, rolledMood }
  }

  /** Push the current state onto the undo stack; every new edit clears redo. */
  function pushUndo() {
    const snap = snapshot()
    setPast(p => [...p.slice(-(UNDO_MAX - 1)), snap])
    setFuture([])
  }

  function applySnapshot(s: Snapshot) {
    setLocalChords(s.chords)
    setLocalNotes(s.notes)
    setRomans(s.romans)
    setPatternName(s.patternName)
    setSelectedKey(s.key)
    setRolledMood(s.rolledMood)
    syncTransport(s.chords, s.key, s.notes)
  }

  function undo() {
    if (!past.length) return
    setFuture(f => [...f, snapshot()])
    applySnapshot(past[past.length - 1])
    setPast(past.slice(0, -1))
  }

  function redo() {
    if (!future.length) return
    setPast(p => [...p, snapshot()])
    applySnapshot(future[future.length - 1])
    setFuture(future.slice(0, -1))
  }

  // ⌘Z / Ctrl+Z and ⇧⌘Z / Ctrl+Y — refs keep the handler closure fresh.
  const undoRef = useRef(undo)
  const redoRef = useRef(redo)
  undoRef.current = undo
  redoRef.current = redo
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!activeRef.current) return
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.code === 'KeyZ' && !e.shiftKey) { e.preventDefault(); undoRef.current() }
      else if ((e.code === 'KeyZ' && e.shiftKey) || e.code === 'KeyY') { e.preventDefault(); redoRef.current() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  // ── History ────────────────────────────────────────────────────────────────

  function pushHistory(chords: ParsedChord[], key: string) {
    const symbols = chords.map(c => c.symbol)
    const beats = chords.map(c => c.beats)
    setHistory(prev => {
      const next = [
        { symbols, key, ts: Date.now(), beats },
        ...prev.filter(h => h.symbols.join('|') !== symbols.join('|')),
      ].slice(0, HISTORY_MAX)
      persistHistory(next)
      return next
    })
  }

  function recallHistory(entry: HistoryEntry) {
    const chords = voiceLeadProgression(parseChords(entry.symbols))
      .map((c, i) => ({ ...c, beats: entry.beats?.[i] }))
    if (!chords.length) return
    pushUndo()
    const notes = chordsToNotes(chords, useStore.getState().beatsPerChord)
    setSelectedKey(entry.key)
    setLocalChords(chords)
    setLocalNotes(notes)
    setRomans([])
    setPatternName('')
    setRolledMood(null)
    loadProgression(chords, `Chord Lab · ${entry.key}`)
  }

  function clearHistory() {
    setHistory([])
    clearStoredHistory()
  }

  // ── Generated progressions ─────────────────────────────────────────────────

  /** Load a freshly generated progression: undoable, logged, and sent to the transport. */
  function loadGenerated({ chords, romans = [], patternName = '', rolledMood = null }: GeneratedProgression) {
    pushUndo()
    setRomans(romans)
    setPatternName(patternName)
    setRolledMood(rolledMood)
    setLocalChords(chords)
    setLocalNotes(chordsToNotes(chords, useStore.getState().beatsPerChord))
    loadProgression(chords, `Chord Lab · ${selectedKey}`)
    pushHistory(chords, selectedKey)
  }

  // ── Saved progressions ─────────────────────────────────────────────────────

  function saveCurrent(name: string) {
    if (!localChords.length) return
    const fallback = `${selectedKey} · ${localChords.map(c => c.symbol).slice(0, 4).join('–')}`
    const entry: SavedProg = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: name.trim() || fallback,
      key: selectedKey,
      ts: Date.now(),
      chords: localChords,
      notes: localNotes,
    }
    setSaved(prev => {
      const next = [entry, ...prev].slice(0, SAVED_MAX)
      persistSaved(next)
      return next
    })
  }

  function deleteSaved(id: string) {
    setSaved(prev => {
      const next = prev.filter(s => s.id !== id)
      persistSaved(next)
      return next
    })
  }

  function loadSaved(s: SavedProg) {
    if (!s.chords.length) return
    pushUndo()
    const notes = Array.isArray(s.notes) && s.notes.length
      ? s.notes
      : chordsToNotes(s.chords, useStore.getState().beatsPerChord)
    if (KEY_NAMES.includes(s.key)) setSelectedKey(s.key)
    setLocalChords(s.chords)
    setLocalNotes(notes)
    setRomans([])
    setPatternName('')
    setRolledMood(null)
    useStore.getState().loadProgressionWithNotes(s.chords, notes, `Chord Lab · ${s.key}`)
  }

  // ── Editing ────────────────────────────────────────────────────────────────

  /**
   * Piano-roll edits: notes are the truth; chord columns are relabelled by
   * detection, and the live transport follows without stopping.
   */
  function handleRollChange(notes: NoteEvent[], windows: ChordWindow[]) {
    pushUndo()
    const detected = detectWindowChords(notes, windows)
    setLocalNotes(notes)
    setLocalChords(detected)
    setRomans([])          // hand-edited — analysis labels no longer apply
    setPatternName('')
    setRolledMood(null)
    syncTransport(detected, selectedKey, notes)
  }

  /** Remove one chord column (× on a card or roll header); notes shift left. */
  function deleteChord(i: number) {
    pushUndo()
    const windows = chordWindows(localChords, useStore.getState().beatsPerChord)
    const nextNotes  = deleteWindowNotes(localNotes, windows, i)
    const nextChords = localChords.filter((_, j) => j !== i)
    const nextRomans = romans.length === localChords.length
      ? romans.filter((_, j) => j !== i)
      : []
    setLocalChords(nextChords)
    setLocalNotes(nextNotes)
    setRomans(nextRomans)
    if (!nextChords.length) setPatternName('')
    syncTransport(nextChords, selectedKey, nextNotes)
  }

  /** The roll's + strip: append a slot repeating the last chord (or C major). */
  function appendChordSlot() {
    pushUndo()
    const bpc = useStore.getState().beatsPerChord
    const windows = chordWindows(localChords, bpc)
    const total = totalBeatsOf(windows)
    const beats = windows.length ? windows[windows.length - 1].beats : bpc
    const last = localChords[localChords.length - 1]
    const template = last?.notes.length ? last.notes : [60, 64, 67]
    const fresh: NoteEvent[] = template.map(midi => ({
      id: newNoteId(), midi, start: total, duration: beats, velocity: 0.78,
    }))
    const nextNotes = [...localNotes, ...fresh]
    const nextChords = [...localChords, { ...detectChord(template), beats }]
    setLocalChords(nextChords)
    setLocalNotes(nextNotes)
    setRomans([])
    setPatternName('')
    syncTransport(nextChords, selectedKey, nextNotes)
  }

  /** Shift everything by ±1 semitone; voicings, beats, and romans survive. */
  function transpose(semitones: number) {
    if (!localChords.length) return
    const newKey = transposeKeyName(selectedKey, semitones)
    const next = transposeProgression(localChords, semitones, keyPrefersFlats(newKey))
    // Keep the whole progression inside a sane playable register.
    const all = next.flatMap(c => c.notes)
    if (all.length && (Math.min(...all) < 24 || Math.max(...all) > 108)) return
    pushUndo()
    const nextNotes = localNotes.map(n => ({ ...n, midi: n.midi + semitones }))
    setLocalChords(next)
    setLocalNotes(nextNotes)
    setSelectedKey(newKey)
    syncTransport(next, newKey, nextNotes)
  }

  return {
    selectedKey, setSelectedKey,
    localChords, localNotes, romans, patternName, rolledMood,
    history, saved,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    undo, redo,
    loadGenerated,
    recallHistory, clearHistory,
    saveCurrent, deleteSaved, loadSaved,
    handleRollChange, deleteChord, appendChordSlot, transpose,
  }
}
