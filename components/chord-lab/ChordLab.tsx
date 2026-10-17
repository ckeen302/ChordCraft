'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Shuffle, ChevronDown, Download, Copy, ArrowRight, Music, Sparkles, Dices,
  Loader2, History, Trash2, Undo2, Redo2, Bookmark, BookmarkPlus, X, Check,
} from 'lucide-react'
import { ChordStrip } from './ChordStrip'
import { PianoRoll } from '@/components/piano/PianoRoll'
import { useStore } from '@/store/useStore'
import {
  generateSmartRich,
  generateRandom,
  generateFromTemplate,
  TEMPLATE_NAMES,
  MOOD_LABELS,
  type Mood,
} from '@/lib/theory/progressions'
import { KEY_NAMES } from '@/lib/theory/keys'
import { parseChords, detectChord } from '@/lib/theory/chords'
import { voiceLeadProgression } from '@/lib/theory/voicing'
import { transposeProgression, transposeKeyName, keyPrefersFlats } from '@/lib/theory/transpose'
import { analyzeProgression } from '@/lib/theory/analysis'
import { setChordRoll } from '@/lib/audio/engine'
import {
  chordsToNotes, chordWindows, detectWindowChords, deleteWindowNotes,
  newNoteId, totalBeatsOf, type ChordWindow,
} from '@/lib/roll/notes'
import { downloadMidiFromNotes, GM_PROGRAM } from '@/lib/midi/export'
import { copyToClipboard, progressionToString } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type { InstrumentName, NoteEvent, ParsedChord } from '@/types'

const INSTRUMENTS: InstrumentName[] = [
  'Piano', 'Electric Piano', 'Pad', 'Synth Lead', 'Organ',
  'Guitar', 'Strings', 'Bass', 'Harp', 'Bell', 'Brass',
]

const MOODS = Object.entries(MOOD_LABELS) as [Mood, string][]

const MOOD_DESCRIPTIONS: Record<Mood, string> = {
  uplifting:   'Axis anthems (I–V–vi–IV), Mixolydian bVII lifts, add9 shimmer — "Don\'t Stop Believin\'", "Let It Be", stadium EDM.',
  melancholic: 'The sad-pop loop, Andalusian descents, and the "saddest move" IV→iv ("Creep", "In My Life"). Slow, low, unresolved.',
  dreamy:      'Lydian I–II floats ("Dreams", "Teenage Dream"), plagal drift, maj7 on everything. No dominant pull — weightless.',
  romantic:    'Standards turnarounds, the "All of Me" yearning loop, III7 drama, half-cadence longing. maj7 and 9ths throughout.',
  nostalgic:   'Doo-wop changes ("Stand By Me", "Blue Moon"), vintage 6ths, the golden III7 mediant, and the sepia IV→iv fade.',
  tense:       'Phrygian bII stabs, Herrmann\'s "Hitchcock chord" (mΔ7), Psycho dim7 drift. Thriller unease that refuses to resolve.',
  jazz:        'ii–V–I engines, tritone subs, backdoor cadences, secondary-dominant chains. Everything wears 7ths, 9ths, and 6ths.',
  epic:        'The minor axis ("Numb"), the Mario cadence bVI–bVII–I, battle loops — trailer-sized, ending unresolved on VII.',
  aggressive:  'Phrygian i–bII slams, metal i–VI–VII loops, punk I–IV–V at 140+ BPM. Raw triads, no ornaments.',
}

// ─── Progression history (persisted, last 10 generations) ───────────────────

interface HistoryEntry {
  symbols: string[]
  key: string
  ts: number
  /** Per-chord durations (harmonic rhythm), when the entry carried one. */
  beats?: (number | undefined)[]
}

const HISTORY_KEY = 'chordcraft-history'
const HISTORY_MAX = 10

function readHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

// ─── Saved progressions (persisted, user-named favourites) ───────────────────

interface SavedProg {
  id: string
  name: string
  key: string
  ts: number
  /** Full chords — exact voicings, symbols, and beats round-trip losslessly. */
  chords: ParsedChord[]
  /** Exact note timeline (piano-roll edits). Older saves may lack it. */
  notes?: NoteEvent[]
}

const SAVED_KEY = 'chordcraft-saved'
const SAVED_MAX = 30

function readSaved(): SavedProg[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY)
    const list = raw ? JSON.parse(raw) : []
    if (!Array.isArray(list)) return []
    return list.filter((s: SavedProg) =>
      s && typeof s.id === 'string' && typeof s.name === 'string' &&
      Array.isArray(s.chords) &&
      s.chords.every(c => c && typeof c.symbol === 'string' &&
        Array.isArray(c.notes) && c.notes.every(n => typeof n === 'number')),
    )
  } catch {
    return []
  }
}

function persistSaved(list: SavedProg[]) {
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(list)) } catch { /* storage full */ }
}

// ─── Undo/redo snapshots ─────────────────────────────────────────────────────

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

function SelectField({
  label, value, onChange, children, icon,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  children: React.ReactNode
  icon?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] text-text-muted font-semibold uppercase tracking-[2px]">{label}</label>
      <div className="relative flex items-center">
        {icon && <span className="absolute left-2.5 text-text-muted pointer-events-none">{icon}</span>}
        <select
          value={value}
          // Blur after choosing so Space returns to play/pause instead of
          // reopening the dropdown (focused selects swallow the shortcut).
          onChange={e => { onChange(e.target.value); e.target.blur() }}
          className={cn(
            'appearance-none w-full bg-bg-raised border border-border rounded-xl',
            'text-sm text-text pr-8 py-2 cursor-pointer',
            'focus:outline-none focus:border-accent/50',
            icon ? 'pl-7' : 'pl-3',
          )}
        >
          {children}
        </select>
        <ChevronDown size={12} className="absolute right-2.5 text-text-muted pointer-events-none" />
      </div>
    </div>
  )
}

export function ChordLab({ active = true }: { active?: boolean }) {
  const {
    loadProgression, progression: storeProgression,
    source, bpm, setBpm,
    instrument, setInstrument,
  } = useStore()

  // The lab stays mounted while the Songs tab is shown — its shortcuts must
  // not fire from the other tab.
  const activeRef = useRef(active)
  activeRef.current = active

  const [selectedKey, setSelectedKey] = useState('C Major')
  const [mode, setMode]               = useState<'smart' | 'random' | string>('smart')
  // Default is 'random' — a fresh mood is rolled on every generate; picking
  // a specific mood pins it (like the old behaviour) until Random is chosen again.
  const [mood, setMood]               = useState<Mood | 'random'>('random')
  const [rolledMood, setRolledMood]   = useState<Mood | null>(null)
  const [length, setLength]           = useState(4)
  const [excludeDim, setExcludeDim]   = useState(false)
  const [chromatic, setChromatic]     = useState(false)
  const [autoVibe, setAutoVibe]       = useState(true)
  const [romans, setRomans]           = useState<string[]>([])
  const [patternName, setPatternName] = useState('')
  const [localChords, setLocalChords] = useState<ParsedChord[]>([])
  const [localNotes, setLocalNotes]   = useState<NoteEvent[]>([])
  const [generating, setGenerating]   = useState(false)
  const [copyLabel, setCopyLabel]     = useState('Copy')
  const [error, setError]             = useState<string | null>(null)
  const [history, setHistory]         = useState<HistoryEntry[]>([])

  // Undo/redo stacks
  const [past, setPast]     = useState<Snapshot[]>([])
  const [future, setFuture] = useState<Snapshot[]>([])

  // Saved progressions
  const [saved, setSaved]       = useState<SavedProg[]>([])
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState('')

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
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)) } catch { /* storage full */ }
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
    try { localStorage.removeItem(HISTORY_KEY) } catch { /* ignore */ }
  }

  // ── Saved progressions ─────────────────────────────────────────────────────

  function handleSaveConfirm() {
    if (!localChords.length) return
    const fallback = `${selectedKey} · ${localChords.map(c => c.symbol).slice(0, 4).join('–')}`
    const entry: SavedProg = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: saveName.trim() || fallback,
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
    setSaveOpen(false)
    setSaveName('')
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

  // ── Analysis ───────────────────────────────────────────────────────────────

  const analysis = useMemo(
    () => (localChords.length >= 2
      ? analyzeProgression(localChords, selectedKey, patternName || undefined)
      : null),
    [localChords, selectedKey, patternName],
  )

  // ── Generate / export ──────────────────────────────────────────────────────

  const isSmart  = mode === 'smart'
  const isRandom = mode === 'random'

  const isLoaded =
    localChords.length > 0 &&
    source.startsWith('Chord Lab') &&
    storeProgression.length === localChords.length &&
    storeProgression[0]?.symbol === localChords[0]?.symbol

  function handleGenerate() {
    setError(null)
    setGenerating(true)
    try {
      let chords: ParsedChord[]
      let nextRomans: string[] = []
      let nextPattern = ''
      let nextRolledMood: Mood | null = null
      if (isSmart) {
        // 'random' rolls a fresh mood every generate; a pinned mood repeats it.
        const effectiveMood: Mood = mood === 'random'
          ? MOODS[Math.floor(Math.random() * MOODS.length)][0]
          : mood
        nextRolledMood = mood === 'random' ? effectiveMood : null

        const result = generateSmartRich(selectedKey, {
          mood: effectiveMood, length,
          excludeDiminished: excludeDim,
          chromaticColor: chromatic,
        })
        chords = result.chords
        nextRomans = result.romans
        nextPattern = result.patternName
        // Mood = harmony + rhythm + tempo + timbre + articulation. With
        // auto-vibe off, strip the harmonic rhythm so the transport's global
        // beats-per-chord stays in control.
        if (autoVibe) {
          setBpm(result.bpm)
          setChordRoll(result.rollMs)
          // The mood's timbre applies only until the user picks an instrument
          // themselves — an explicit choice always wins.
          if (!useStore.getState().instrumentTouched) setInstrument(result.instrument)
        } else {
          chords = chords.map(c => ({ ...c, beats: undefined }))
          setChordRoll(12)
        }
      } else {
        chords = isRandom
          ? generateRandom(selectedKey, length, excludeDim)
          : generateFromTemplate(selectedKey, mode)
      }

      if (!chords.length) {
        setError('Generation produced no playable chords — try again.')
        return
      }
      pushUndo()
      setRomans(nextRomans)
      setPatternName(nextPattern)
      setRolledMood(nextRolledMood)
      setLocalChords(chords)
      setLocalNotes(chordsToNotes(chords, useStore.getState().beatsPerChord))
      loadProgression(chords, `Chord Lab · ${selectedKey}`)
      pushHistory(chords, selectedKey)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setGenerating(false)
    }
  }

  async function handleCopy() {
    if (!localChords.length) return
    const ok = await copyToClipboard(progressionToString(localChords.map(c => c.symbol)))
    if (ok) {
      setCopyLabel('Copied!')
      setTimeout(() => setCopyLabel('Copy'), 2000)
    }
  }

  async function handleExport() {
    if (!localNotes.length) return
    await downloadMidiFromNotes(
      localNotes,
      bpm,
      `chordcraft-${selectedKey.replace(/\s+/g, '-').toLowerCase()}`,
      GM_PROGRAM[instrument],
    )
  }

  return (
    <div className="flex h-full min-h-0">

      {/* ── Left panel: Controls ─────────────────────────────────────────── */}
      {/* Generate is the app's core action, so it's pinned in its own footer
          below — never scrolled out of view, no matter how tall the mood
          picker / saved / recent lists get. Everything else scrolls above it. */}
      <div className="w-72 flex-shrink-0 flex flex-col min-h-0 border-r border-border bg-bg-panel">
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-5 p-6">

        <div>
          <h2 className="text-lg font-extrabold text-text">Chord Lab</h2>
          <p className="text-text-muted text-xs mt-0.5 leading-relaxed">
            Musically-informed progressions.
          </p>
        </div>

        <SelectField label="Key" value={selectedKey} onChange={setSelectedKey}>
          {KEY_NAMES.map(k => <option key={k} value={k}>{k}</option>)}
        </SelectField>

        <SelectField label="Mode" value={mode} onChange={setMode}>
          <option value="smart">✦ Smart Generate</option>
          <option value="random">🎲 Fully Random</option>
          <optgroup label="Classic Templates">
            {TEMPLATE_NAMES.map(t => <option key={t} value={t}>{t}</option>)}
          </optgroup>
        </SelectField>

        <SelectField
          label="Instrument"
          value={instrument}
          onChange={v => useStore.getState().chooseInstrument(v as InstrumentName)}
          icon={<Music size={12} />}
        >
          {INSTRUMENTS.map(i => <option key={i} value={i}>{i}</option>)}
        </SelectField>

        {/* Smart-mode panel */}
        {isSmart && (
          <div className="flex flex-col gap-4 p-3.5 rounded-xl border border-accent/20 bg-accent/5">
            <div className="flex items-center gap-2">
              <Sparkles size={12} className="text-accent" />
              <span className="text-[10px] font-bold text-accent uppercase tracking-[2px]">
                Harmony Engine
              </span>
            </div>

            {/* Mood — Random by default; pin a specific mood if you want it. */}
            <div className="flex flex-col gap-2">
              <span className="text-[10px] text-text-muted font-semibold uppercase tracking-[2px]">Mood</span>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setMood('random')}
                  title="Roll a fresh mood — harmony, tempo, and timbre — every time you generate."
                  className={cn(
                    'flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors cursor-pointer',
                    mood === 'random'
                      ? 'bg-accent border-accent text-bg-deep'
                      : 'bg-bg-raised border-border text-text-muted hover:text-text',
                  )}
                >
                  <Dices size={11} />
                  Random
                </button>
                {MOODS.map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => setMood(id)}
                    className={cn(
                      'px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors cursor-pointer',
                      mood === id
                        ? 'bg-accent border-accent text-bg-deep'
                        : 'bg-bg-raised border-border text-text-muted hover:text-text',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-text-dim italic leading-relaxed">
                {mood === 'random'
                  ? (rolledMood
                      ? `Rolled ${MOOD_LABELS[rolledMood]} — ${MOOD_DESCRIPTIONS[rolledMood]}`
                      : 'Each generate rolls a fresh mood — harmony, tempo, and timbre all follow it.')
                  : MOOD_DESCRIPTIONS[mood]}
              </p>
            </div>

            {/* Auto vibe: mood sets tempo + instrument too */}
            <button
              onClick={() => {
                const next = !autoVibe
                setAutoVibe(next)
                // Re-enabling is an explicit opt-in to mood timbres again.
                if (next) useStore.getState().setInstrumentTouched(false)
              }}
              title="Each mood has a researched tempo range and timbre — generating sets the transport BPM and instrument to match. Picking an instrument yourself always overrides the mood's suggestion."
              className={cn(
                'w-full py-1.5 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer',
                autoVibe
                  ? 'bg-accent/15 border-accent/40 text-accent'
                  : 'bg-bg-raised border-border text-text-muted hover:text-text',
              )}
            >
              {autoVibe ? '✓ Auto tempo & sound' : 'Auto tempo & sound'}
            </button>

            {/* Chromatic colour (secondary dominants) */}
            <button
              onClick={() => setChromatic(v => !v)}
              title="Swap one chord for the secondary dominant (V7) of the chord after it — adds a colour chord from outside the key."
              className={cn(
                'w-full py-1.5 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer',
                chromatic
                  ? 'bg-accent/15 border-accent/40 text-accent'
                  : 'bg-bg-raised border-border text-text-muted hover:text-text',
              )}
            >
              {chromatic ? '✓ Chromatic colour (V7/x)' : 'Chromatic colour (V7/x)'}
            </button>
          </div>
        )}

        {/* Random-mode panel */}
        {isRandom && (
          <div className="flex flex-col gap-2 p-3.5 rounded-xl border border-border bg-bg-raised/50">
            <div className="flex items-center gap-2">
              <Dices size={12} className="text-text-muted" />
              <span className="text-[10px] font-bold text-text-muted uppercase tracking-[2px]">
                Pure Chance
              </span>
            </div>
            <p className="text-[11px] text-text-dim italic leading-relaxed">
              No music theory rules — every chord in the key is equally likely.
              Great for happy accidents; use Smart Generate for progressions
              that resolve.
            </p>
          </div>
        )}

        {/* Length + Avoid dim (Smart and Random only) */}
        {(isSmart || isRandom) && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] text-text-muted font-semibold uppercase tracking-[2px]">Length</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setLength(l => Math.max(2, l - 1))}
                  className="w-7 h-7 flex items-center justify-center rounded-lg bg-bg-raised border border-border text-text-muted hover:text-text cursor-pointer text-sm"
                >−</button>
                <span className="w-6 text-center font-mono text-sm text-text font-bold">{length}</span>
                <button
                  onClick={() => setLength(l => Math.min(12, l + 1))}
                  className="w-7 h-7 flex items-center justify-center rounded-lg bg-bg-raised border border-border text-text-muted hover:text-text cursor-pointer text-sm"
                >+</button>
                <span className="text-[10px] text-text-dim ml-1">chords</span>
              </div>
            </div>

            <button
              onClick={() => setExcludeDim(v => !v)}
              className={cn(
                'w-full py-1.5 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer',
                excludeDim
                  ? 'bg-accent/15 border-accent/40 text-accent'
                  : 'bg-bg-raised border-border text-text-muted hover:text-text',
              )}
            >
              {excludeDim ? '✓ Avoiding °dim chords' : 'Avoid °dim chords'}
            </button>
          </div>
        )}

        {error && <p className="text-red-400 text-xs">{error}</p>}

        {/* Saved progressions */}
        {saved.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="flex items-center gap-1.5 text-[10px] text-text-muted font-semibold uppercase tracking-[2px]">
              <Bookmark size={11} />
              Saved
            </span>
            <div className="flex flex-col gap-1">
              {saved.map(s => (
                <div key={s.id} className="group relative">
                  <button
                    onClick={() => loadSaved(s)}
                    title={`${s.chords.map(c => c.symbol).join(' – ')} (${s.key})`}
                    className={cn(
                      'flex flex-col items-start gap-0.5 w-full px-2.5 py-1.5 rounded-lg border border-border bg-bg-raised/50',
                      'hover:border-accent/40 hover:bg-bg-raised cursor-pointer text-left transition-colors',
                    )}
                  >
                    <span className="text-[11px] font-semibold text-text truncate w-full pr-5">
                      {s.name}
                    </span>
                    <span className="text-[10px] font-mono text-text-dim truncate w-full">
                      {s.chords.map(c => c.symbol).join(' – ')}
                    </span>
                  </button>
                  <button
                    onClick={() => deleteSaved(s.id)}
                    title={`Delete "${s.name}"`}
                    className="absolute right-2 top-2 hidden group-hover:block text-text-dim hover:text-red-400 cursor-pointer"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent progressions */}
        {history.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[10px] text-text-muted font-semibold uppercase tracking-[2px]">
                <History size={11} />
                Recent
              </span>
              <button
                onClick={clearHistory}
                title="Clear history"
                className="text-text-dim hover:text-red-400 cursor-pointer"
              >
                <Trash2 size={11} />
              </button>
            </div>
            <div className="flex flex-col gap-1">
              {history.map(entry => (
                <button
                  key={entry.ts}
                  onClick={() => recallHistory(entry)}
                  title={`${entry.symbols.join(' – ')} (${entry.key})`}
                  className={cn(
                    'flex flex-col items-start gap-0.5 px-2.5 py-1.5 rounded-lg border border-border bg-bg-raised/50',
                    'hover:border-accent/40 hover:bg-bg-raised cursor-pointer text-left transition-colors',
                  )}
                >
                  <span className="text-[11px] font-mono text-text truncate w-full">
                    {entry.symbols.join(' – ')}
                  </span>
                  <span className="text-[9px] text-text-dim uppercase tracking-wider">{entry.key}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

        {/* Pinned Generate footer — the app's core action, always reachable
            without scrolling regardless of how tall the panel above gets. */}
        <div className="flex-shrink-0 p-4 border-t border-border bg-bg-panel">
          <button
            onClick={handleGenerate}
            disabled={generating}
            className={cn(
              'flex items-center justify-center gap-2 w-full py-2.5 rounded-xl',
              'bg-accent hover:bg-accent-hover text-bg-deep font-bold text-sm',
              'transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-wait',
            )}
          >
            {generating
              ? <Loader2 size={14} className="animate-spin" />
              : isSmart
                ? <Sparkles size={14} />
                : isRandom
                  ? <Dices size={14} />
                  : <Shuffle size={14} />}
            {generating ? 'Generating…' : 'Generate'}
          </button>
        </div>
      </div>

      {/* ── Right panel: Output ──────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto p-6 gap-6">

        {/* Progression strip — or empty hint */}
        {localChords.length > 0 ? (
          <div>
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <p className="text-[10px] uppercase tracking-[2px] text-text-muted font-semibold">
                Progression — {selectedKey}
                {romans.length > 0 && (
                  <span className="ml-2 text-accent font-mono normal-case tracking-normal">
                    ({romans.join(' – ')})
                  </span>
                )}
              </p>
              {patternName && (
                <span className="px-2 py-0.5 rounded-full bg-accent/10 border border-accent/25 text-[10px] text-accent">
                  {patternName}
                </span>
              )}
              {rolledMood && (
                <span
                  title="Rolled by Random mood"
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-bg-raised border border-border text-[10px] text-text-muted"
                >
                  <Dices size={9} />
                  {MOOD_LABELS[rolledMood]}
                </span>
              )}

              {/* Transpose */}
              <div className="ml-auto flex items-center gap-1">
                <span className="text-[10px] text-text-dim uppercase tracking-wider mr-0.5">Transpose</span>
                <button
                  onClick={() => transpose(-1)}
                  title="Down a semitone"
                  className="w-7 h-7 flex items-center justify-center rounded-lg bg-bg-raised border border-border text-text-muted hover:text-text hover:border-accent/40 cursor-pointer text-sm font-mono"
                >♭</button>
                <button
                  onClick={() => transpose(1)}
                  title="Up a semitone"
                  className="w-7 h-7 flex items-center justify-center rounded-lg bg-bg-raised border border-border text-text-muted hover:text-text hover:border-accent/40 cursor-pointer text-sm font-mono"
                >♯</button>
              </div>
            </div>
            <ChordStrip chords={localChords} onDelete={deleteChord} />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <Sparkles size={24} className="text-text-dim" />
            <p className="text-text-muted text-sm">No progression yet</p>
            <p className="text-text-dim text-xs max-w-xs">
              Pick a key and mood on the left, then hit{' '}
              <strong className="text-accent">Generate</strong>.
            </p>
          </div>
        )}

        {/* MIDI piano roll — always visible, click to edit */}
        <div>
          <div className="flex items-center mb-3">
            <p className="text-[10px] uppercase tracking-[2px] text-text-muted font-semibold">
              Piano Roll
              <span className="ml-2 normal-case tracking-normal font-normal text-text-dim">
                — click to add/remove notes, even while playing
              </span>
            </p>

            {/* Undo / redo — always reachable, even after undoing to empty */}
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={undo}
                disabled={!past.length}
                title="Undo (⌘Z)"
                className="w-7 h-7 flex items-center justify-center rounded-lg bg-bg-raised border border-border text-text-muted hover:text-text hover:border-accent/40 cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:text-text-muted disabled:hover:border-border"
              >
                <Undo2 size={13} />
              </button>
              <button
                onClick={redo}
                disabled={!future.length}
                title="Redo (⇧⌘Z)"
                className="w-7 h-7 flex items-center justify-center rounded-lg bg-bg-raised border border-border text-text-muted hover:text-text hover:border-accent/40 cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:text-text-muted disabled:hover:border-border"
              >
                <Redo2 size={13} />
              </button>
            </div>
          </div>
          <PianoRoll
            chords={localChords}
            notes={localNotes}
            onNotesChange={handleRollChange}
            onDeleteWindow={deleteChord}
            onAppendWindow={appendChordSlot}
          />
        </div>

        {localChords.length > 0 && (
          <>
            {/* Chord analysis */}
            <div>
              <p className="text-[10px] uppercase tracking-[2px] text-text-muted font-semibold mb-3">
                Chord Details
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {localChords.map((chord, i) => (
                  <div
                    key={i}
                    className="flex flex-col gap-1 p-3 rounded-xl bg-bg-raised border border-border"
                  >
                    <span className="text-xs text-text-dim font-mono">#{i + 1}</span>
                    <span className="text-lg font-extrabold text-text leading-none">{chord.root}</span>
                    <span className="text-[11px] text-text-muted">{chord.displayQuality || 'major'}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Harmonic analysis — instant, rule-based */}
            {analysis && (
              <div>
                <p className="text-[10px] uppercase tracking-[2px] text-text-muted font-semibold mb-3">
                  Analysis
                </p>
                <div className="p-4 rounded-xl bg-bg-raised border border-border">
                  <p className="text-sm text-text-muted leading-relaxed">{analysis.summary}</p>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {!isLoaded ? (
                <button
                  onClick={() => useStore.getState().loadProgressionWithNotes(localChords, localNotes, `Chord Lab · ${selectedKey}`)}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-bg-deep font-semibold text-sm hover:bg-accent-hover cursor-pointer transition-colors"
                >
                  <ArrowRight size={13} />
                  Send to Transport
                </button>
              ) : (
                <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-accent/10 border border-accent/25 text-accent text-xs font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse inline-block" />
                  Loaded in transport
                </span>
              )}
              <button
                onClick={handleExport}
                className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border text-text-muted hover:text-text hover:border-border-bright text-sm cursor-pointer transition-colors"
              >
                <Download size={13} />
                Export MIDI
              </button>
              <button
                onClick={handleCopy}
                className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border text-text-muted hover:text-text hover:border-border-bright text-sm cursor-pointer transition-colors"
              >
                <Copy size={13} />
                {copyLabel}
              </button>

              {/* Save as favourite */}
              {saveOpen ? (
                <div className="flex items-center gap-1.5">
                  <input
                    autoFocus
                    value={saveName}
                    onChange={e => setSaveName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleSaveConfirm()
                      if (e.key === 'Escape') { setSaveOpen(false); setSaveName('') }
                    }}
                    placeholder="Name this progression…"
                    className="w-48 bg-bg-raised border border-accent/40 rounded-xl text-sm text-text px-3 py-2 focus:outline-none focus:border-accent/70 placeholder:text-text-dim"
                  />
                  <button
                    onClick={handleSaveConfirm}
                    title="Save"
                    className="w-9 h-9 flex items-center justify-center rounded-xl bg-accent text-bg-deep hover:bg-accent-hover cursor-pointer transition-colors"
                  >
                    <Check size={14} />
                  </button>
                  <button
                    onClick={() => { setSaveOpen(false); setSaveName('') }}
                    title="Cancel"
                    className="w-9 h-9 flex items-center justify-center rounded-xl border border-border text-text-muted hover:text-text cursor-pointer transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setSaveOpen(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border text-text-muted hover:text-text hover:border-border-bright text-sm cursor-pointer transition-colors"
                >
                  <BookmarkPlus size={13} />
                  Save
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
