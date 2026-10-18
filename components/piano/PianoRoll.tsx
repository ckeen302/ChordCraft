'use client'

/**
 * PianoRoll — FL Studio-style MIDI note editor.
 *
 * Notes are free NoteEvents (own start, length, velocity) rather than chord
 * blocks. Chord columns remain as the header/grid structure (windows), and
 * the parent relabels them via chord detection after every edit.
 *
 * Interactions (editable mode):
 *   - Left-click empty cell        → draw a note (pencil); drag right to set length
 *   - Drag a note                  → move (pitch + time, snapped); moves the whole selection
 *   - Drag a note's right edge     → resize (whole selection)
 *   - Right-click / right-drag     → erase
 *   - ⌘/Ctrl+drag on empty space   → marquee (box) selection
 *   - Shift+click                  → add/remove note from selection
 *   - Delete/Backspace             → delete selection · Esc → clear selection
 *   - ⌘A select all · ⌘C/⌘X/⌘V copy/cut/paste · ⌘B duplicate selection right
 *   - Velocity lane (bottom)       → drag bars to set per-note velocity
 *   - Toolbar: snap grid (1/4·1/2·1·off) and horizontal zoom
 *
 * Read-only mode (no onNotesChange): renders chord blocks fitted to width,
 * with the playhead — used by the Popular Songs tab.
 *
 * The playhead is driven by the transport's beat clock (getPlayheadBeats) at
 * rAF rate, so it stays truthful through pause/resume and live BPM changes.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useStore } from '@/store/useStore'
import { getPlayheadBeats } from '@/hooks/useTransport'
import { playChord } from '@/lib/audio/engine'
import {
  chordWindows, chordsToNotes, extendWindows, newNoteId, totalBeatsOf, ROLL_HI_MIDI, ROLL_LO_MIDI,
  type ChordWindow,
} from '@/lib/roll/notes'
import { cn } from '@/lib/utils'
import type { NoteEvent, ParsedChord } from '@/types'

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const IS_BLACK   = [false, true, false, true, false, false, true, false, true, false, true, false]

const ROW_H    = 14    // px per pitch lane
const GUTTER_W = 48    // px key gutter
const HEADER_H = 22    // px chord-symbol header
const VEL_H    = 56    // px velocity lane
const GRID_H   = 336   // px visible grid height (scrolls vertically)
const HI_MIDI  = ROLL_HI_MIDI   // B7
const LO_MIDI  = ROLL_LO_MIDI   // C1
const EDGE_PX  = 7     // resize handle width on a note's right edge
const EPS = 1e-6

const SNAP_OPTIONS: { label: string; beats: number }[] = [
  { label: '1/4', beats: 0.25 },
  { label: '1/2', beats: 0.5 },
  { label: '1',   beats: 1 },
  { label: 'Off', beats: 0 },
]

/** Module-level clipboard — survives regenerations, shared across rolls. */
let _clipboard: { midi: number; startRel: number; duration: number; velocity: number }[] = []

type DragMode = 'create' | 'move' | 'resize' | 'erase' | 'marquee' | 'velocity'

interface DragState {
  mode: DragMode
  startBeat: number
  startMidi: number
  /** Notes as they were when the gesture began. */
  orig: NoteEvent[]
  /** Id of the note anchoring the gesture (created/grabbed). */
  anchorId?: string
  moved: boolean
  lastPreviewMidi?: number
  changed: boolean            // erase mode: something was actually deleted
  velTargets?: string[]       // velocity mode: ids being adjusted
}

interface PianoRollProps {
  chords: ParsedChord[]
  /** Note timeline. When omitted, block notes are derived from the chords. */
  notes?: NoteEvent[]
  /** Present = editable. Receives the full timeline + (possibly grown) windows. */
  onNotesChange?: (notes: NoteEvent[], windows: ChordWindow[]) => void
  /** Header × — remove a chord column (parent shifts notes). */
  onDeleteWindow?: (index: number) => void
  /** Right-side + strip — append a chord slot. */
  onAppendWindow?: () => void
  /** Whether the transport is playing this roll's progression (tabs stay mounted). */
  live?: boolean
  className?: string
}

export function PianoRoll({
  chords, notes, onNotesChange, onDeleteWindow, onAppendWindow, live = true, className,
}: PianoRollProps) {
  const beatsPerChord     = useStore(s => s.beatsPerChord)
  // Another tab's progression playing must not move this roll's playhead or highlights.
  const currentChordIndex = useStore(s => (live ? s.currentChordIndex : -1))
  const isPlaying         = useStore(s => live && s.isPlaying)
  const isPaused          = useStore(s => live && s.isPaused)
  const editable = !!onNotesChange

  // ── Timeline ──────────────────────────────────────────────────────────────
  const derivedNotes = useMemo(
    () => notes ?? chordsToNotes(chords, beatsPerChord),
    [notes, chords, beatsPerChord],
  )
  const [draft, setDraft] = useState<NoteEvent[] | null>(null)
  const displayNotes = draft ?? derivedNotes

  const baseWindows = useMemo(
    () => chordWindows(chords, beatsPerChord),
    [chords, beatsPerChord],
  )
  const endOfNotes = displayNotes.reduce((m, n) => Math.max(m, n.start + n.duration), 0)
  const windows = useMemo(
    () => extendWindows(baseWindows, endOfNotes, beatsPerChord),
    [baseWindows, endOfNotes, beatsPerChord],
  )
  const totalBeats = Math.max(totalBeatsOf(windows), beatsPerChord)

  // ── View state ────────────────────────────────────────────────────────────
  const [ppb, setPpb]           = useState(36)   // px per beat (editable zoom)
  const [containerW, setContainerW] = useState(0)
  const [snapBeats, setSnap]    = useState(0.25)
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [marquee, setMarquee]   = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const [cursor, setCursor]     = useState('cell')

  // The grid always fills the panel (FL-style endless grid), progression or
  // not: editable mode pads the timeline out to the container width at the
  // current zoom; read-only mode fits the content to the width.
  const availW = Math.max(0, containerW - GUTTER_W - 2)
  let pxPerBeat: number
  let canvasBeats: number
  if (editable) {
    pxPerBeat = ppb
    canvasBeats = Math.max(totalBeats + Math.max(4, beatsPerChord * 2), availW / ppb)
  } else {
    const viewBeats = Math.max(totalBeats, 8)
    pxPerBeat = availW > 0 ? Math.max(6, availW / viewBeats) : 36
    canvasBeats = viewBeats
  }
  const contentW  = Math.max(1, Math.round(canvasBeats * pxPerBeat))
  const gridH     = (HI_MIDI - LO_MIDI + 1) * ROW_H

  const gridRef   = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const dragRef   = useRef<DragState | null>(null)
  const hoverRef  = useRef(false)
  const lastDurRef = useRef(1)
  const lastVelRef = useRef(0.78)
  // Write-through mirrors of draft/marquee: mouse handlers read + commit from
  // these so no state-updater ever has side effects (React forbids updating
  // the parent from inside another component's render phase).
  const draftRef   = useRef<NoteEvent[] | null>(null)
  const marqueeRef = useRef<{ x1: number; y1: number; x2: number; y2: number } | null>(null)

  // Refs mirroring state for window-level listeners.
  const notesNowRef = useRef(displayNotes)
  notesNowRef.current = displayNotes
  const selectionRef = useRef(selection)
  selectionRef.current = selection
  const snapRef = useRef(snapBeats)
  snapRef.current = snapBeats
  const ppbRef = useRef(pxPerBeat)
  ppbRef.current = pxPerBeat

  // Track the panel width so the grid always spans it exactly.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setContainerW(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Auto-scroll vertically to centre the content — but only when the content
  // is genuinely new (generation/load replaces every note id). Edits keep
  // most ids, and re-centering mid-edit would yank the view around.
  const prevIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const ids = new Set(derivedNotes.map(n => n.id))
    const prev = prevIdsRef.current
    prevIdsRef.current = ids
    let overlap = 0
    for (const id of ids) if (prev.has(id)) overlap++
    const isNewContent = prev.size === 0 || overlap < ids.size * 0.5
    if (!isNewContent || dragRef.current) return
    const el = scrollRef.current
    if (!el) return
    const pitches = derivedNotes.map(n => n.midi)
    // Empty roll: park the view around middle C so the (centred) hint shows.
    const centre = pitches.length
      ? (Math.min(...pitches) + Math.max(...pitches)) / 2
      : 66
    const target = (HI_MIDI - centre) * ROW_H - GRID_H / 2
    el.scrollTop = Math.max(0, Math.min(gridH - GRID_H, target))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derivedNotes])

  // ── Geometry helpers ──────────────────────────────────────────────────────

  const snapFloor = (v: number) => {
    const s = snapRef.current
    return s > 0 ? Math.floor(v / s + EPS) * s : v
  }
  const snapRound = (v: number) => {
    const s = snapRef.current
    return s > 0 ? Math.round(v / s) * s : v
  }
  const minDur = () => (snapRef.current > 0 ? snapRef.current : 0.125)

  /** Mouse event → grid-space beat/midi/px. */
  function locate(e: { clientX: number; clientY: number }) {
    const rect = gridRef.current!.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    return { x, y, beat: x / ppbRef.current, midi: HI_MIDI - Math.floor(y / ROW_H) }
  }

  function hitNote(beat: number, midi: number): NoteEvent | undefined {
    const list = notesNowRef.current
    return list.findLast(n => n.midi === midi && beat >= n.start - EPS && beat < n.start + n.duration - EPS)
  }

  function previewPitch(midi: number) {
    try { playChord([midi], 0.3) } catch { /* audio not ready */ }
  }

  function updateDraft(next: NoteEvent[] | null) {
    draftRef.current = next
    setDraft(next)
  }

  function updateMarquee(next: { x1: number; y1: number; x2: number; y2: number } | null) {
    marqueeRef.current = next
    setMarquee(next)
  }

  // ── Commit ────────────────────────────────────────────────────────────────

  const commit = useCallback((next: NoteEvent[]) => {
    if (!onNotesChange) return
    const clean = next.filter(n => n.duration > EPS && n.midi >= LO_MIDI && n.midi <= HI_MIDI)
    const end = clean.reduce((m, n) => Math.max(m, n.start + n.duration), 0)
    onNotesChange(clean, extendWindows(baseWindows, end, beatsPerChord))
  }, [onNotesChange, baseWindows, beatsPerChord])
  const commitRef = useRef(commit)
  commitRef.current = commit

  // ── Drag machinery (window-level listeners live for one gesture) ─────────

  const onWindowMove = useCallback((e: MouseEvent) => {
    const d = dragRef.current
    if (!d || !gridRef.current) return
    const { x, y, beat, midi } = locate(e)
    d.moved = true

    if (d.mode === 'marquee') {
      const m = marqueeRef.current
      if (m) updateMarquee({ ...m, x2: x, y2: y })
      return
    }

    if (d.mode === 'erase') {
      const hit = hitNote(beat, midi)
      if (hit) {
        d.changed = true
        updateDraft((draftRef.current ?? d.orig).filter(n => n.id !== hit.id))
      }
      return
    }

    if (d.mode === 'create') {
      const anchor = d.orig.find(n => n.id === d.anchorId)!
      const s = snapRef.current
      const raw = beat - anchor.start
      const dur = Math.max(minDur(), s > 0 ? Math.ceil(raw / s - EPS) * s : raw)
      lastDurRef.current = dur
      updateDraft(d.orig.map(n => (n.id === d.anchorId ? { ...n, duration: dur } : n)))
      return
    }

    if (d.mode === 'move') {
      const sel = selectionRef.current
      // Clamp the whole selection as one block, so hitting an edge doesn't
      // squash a chord's notes onto each other.
      const moving = d.orig.filter(n => sel.has(n.id))
      const minStart = Math.min(...moving.map(n => n.start))
      const minMidi = Math.min(...moving.map(n => n.midi))
      const maxMidi = Math.max(...moving.map(n => n.midi))
      const dBeat = Math.max(-minStart, snapRound(beat - d.startBeat))
      const dMidi = Math.max(LO_MIDI - minMidi, Math.min(HI_MIDI - maxMidi, midi - d.startMidi))
      updateDraft(d.orig.map(n => (sel.has(n.id) ? { ...n, start: n.start + dBeat, midi: n.midi + dMidi } : n)))
      if (dMidi !== d.lastPreviewMidi) {
        d.lastPreviewMidi = dMidi
        const anchor = d.orig.find(n => n.id === d.anchorId)
        if (anchor) previewPitch(anchor.midi + dMidi)
      }
      return
    }

    if (d.mode === 'resize') {
      const dBeat = snapRound(beat - d.startBeat)
      const sel = selectionRef.current
      const anchor = d.orig.find(n => n.id === d.anchorId)
      updateDraft(d.orig.map(n => {
        if (!sel.has(n.id)) return n
        return { ...n, duration: Math.max(minDur(), n.duration + dBeat) }
      }))
      if (anchor) lastDurRef.current = Math.max(minDur(), anchor.duration + dBeat)
      return
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onWindowUp = useCallback(() => {
    const d = dragRef.current
    dragRef.current = null
    window.removeEventListener('mousemove', onWindowMove)
    window.removeEventListener('mouseup', onWindowUp)
    if (!d) return

    if (d.mode === 'marquee') {
      const m = marqueeRef.current
      if (m) {
        const [bx1, bx2] = [Math.min(m.x1, m.x2), Math.max(m.x1, m.x2)]
        const [by1, by2] = [Math.min(m.y1, m.y2), Math.max(m.y1, m.y2)]
        const ppbNow = ppbRef.current
        const hitIds = notesNowRef.current
          .filter(n => {
            const nx1 = n.start * ppbNow
            const nx2 = (n.start + n.duration) * ppbNow
            const ny1 = (HI_MIDI - n.midi) * ROW_H
            const ny2 = ny1 + ROW_H
            return nx1 < bx2 && nx2 > bx1 && ny1 < by2 && ny2 > by1
          })
          .map(n => n.id)
        setSelection(new Set(hitIds))
      }
      updateMarquee(null)
      return
    }

    const final = draftRef.current
    const changed =
      (d.mode === 'create') ||
      (d.mode === 'erase' && d.changed) ||
      ((d.mode === 'move' || d.mode === 'resize') && d.moved && final !== null)
    updateDraft(null)
    if (changed && final) commitRef.current(final)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onWindowMove])

  function beginDrag(d: DragState) {
    dragRef.current = d
    window.addEventListener('mousemove', onWindowMove)
    window.addEventListener('mouseup', onWindowUp)
  }

  // ── Grid mouse handling (all note interaction is delegated here) ─────────

  function handleGridMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (!editable) return
    const { x, y, beat, midi } = locate(e)
    if (midi < LO_MIDI || midi > HI_MIDI || beat < 0) return
    const list = notesNowRef.current

    // Right button: eraser.
    if (e.button === 2) {
      e.preventDefault()
      const hit = hitNote(beat, midi)
      const next = hit ? list.filter(n => n.id !== hit.id) : list
      updateDraft(next)
      beginDrag({ mode: 'erase', startBeat: beat, startMidi: midi, orig: next, moved: false, changed: !!hit })
      return
    }
    if (e.button !== 0) return

    // ⌘/Ctrl+drag: marquee selection.
    if (e.metaKey || e.ctrlKey) {
      updateMarquee({ x1: x, y1: y, x2: x, y2: y })
      beginDrag({ mode: 'marquee', startBeat: beat, startMidi: midi, orig: list, moved: false, changed: false })
      return
    }

    const hit = hitNote(beat, midi)
    if (hit) {
      if (e.shiftKey) {
        // Toggle membership, no drag.
        setSelection(prev => {
          const next = new Set(prev)
          if (next.has(hit.id)) next.delete(hit.id)
          else next.add(hit.id)
          return next
        })
        return
      }
      let sel = selectionRef.current
      if (!sel.has(hit.id)) {
        sel = new Set([hit.id])
        setSelection(sel)
        selectionRef.current = sel
      }
      const nearEdge = beat > hit.start + hit.duration - EDGE_PX / ppbRef.current
      beginDrag({
        mode: nearEdge ? 'resize' : 'move',
        startBeat: beat, startMidi: midi,
        orig: list, anchorId: hit.id, moved: false, changed: false,
        lastPreviewMidi: 0,
      })
      return
    }

    // Empty cell: pencil-draw a note.
    const start = Math.max(0, snapFloor(beat))
    const fresh: NoteEvent = {
      id: newNoteId(), midi, start,
      duration: lastDurRef.current,
      velocity: lastVelRef.current,
    }
    const next = [...list, fresh]
    updateDraft(next)
    setSelection(new Set([fresh.id]))
    previewPitch(midi)
    beginDrag({ mode: 'create', startBeat: beat, startMidi: midi, orig: next, anchorId: fresh.id, moved: false, changed: true })
  }

  /** Hover cursor: pencil (cell) on space, move on a note, resize at its edge. */
  function handleGridHover(e: React.MouseEvent<HTMLDivElement>) {
    if (!editable || dragRef.current) return
    const { beat, midi } = locate(e)
    const hit = hitNote(beat, midi)
    const next = !hit
      ? 'cell'
      : beat > hit.start + hit.duration - EDGE_PX / ppbRef.current ? 'ew-resize' : 'move'
    if (next !== cursor) setCursor(next)
  }

  // ── Velocity lane ─────────────────────────────────────────────────────────

  function velFromY(y: number): number {
    return Math.max(0.05, Math.min(1, 1 - (y - 2) / (VEL_H - 6)))
  }

  function handleVelMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (!editable || e.button !== 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const beat = (e.clientX - rect.left) / ppbRef.current
    const vel  = velFromY(e.clientY - rect.top)
    const list = notesNowRef.current
    const under = list.filter(n => beat >= n.start - 0.05 && beat < n.start + n.duration)
    if (!under.length) return
    const sel = selectionRef.current
    const anchor = under.find(n => sel.has(n.id)) ?? under[under.length - 1]
    const targets = sel.has(anchor.id) ? [...sel] : [anchor.id]
    lastVelRef.current = vel
    updateDraft(list.map(n => (targets.includes(n.id) ? { ...n, velocity: vel } : n)))
    const d: DragState = {
      mode: 'velocity', startBeat: beat, startMidi: 0,
      orig: list, moved: false, changed: true, velTargets: targets,
    }
    dragRef.current = d
    const move = (ev: MouseEvent) => {
      const v = velFromY(ev.clientY - rect.top)
      lastVelRef.current = v
      updateDraft(d.orig.map(n => (d.velTargets!.includes(n.id) ? { ...n, velocity: v } : n)))
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      dragRef.current = null
      const final = draftRef.current
      updateDraft(null)
      if (final) commitRef.current(final)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // ── Keyboard: delete, select-all, copy/cut/paste/duplicate ───────────────

  useEffect(() => {
    if (!editable) return
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const sel = selectionRef.current
      const list = notesNowRef.current
      const mod = e.metaKey || e.ctrlKey

      // Hidden roll (other tab shown) must never react to keys.
      if (gridRef.current?.offsetParent === null) return

      if ((e.key === 'Delete' || e.key === 'Backspace') && sel.size) {
        e.preventDefault()
        commitRef.current(list.filter(n => !sel.has(n.id)))
        setSelection(new Set())
        return
      }
      if (e.key === 'Escape' && sel.size) {
        setSelection(new Set())
        return
      }
      if (!mod || !hoverRef.current) return

      if (e.code === 'KeyA') {
        e.preventDefault()
        setSelection(new Set(list.map(n => n.id)))
      } else if (e.code === 'KeyC' && sel.size) {
        e.preventDefault()
        const picked = list.filter(n => sel.has(n.id))
        const base = Math.min(...picked.map(n => n.start))
        _clipboard = picked.map(n => ({ midi: n.midi, startRel: n.start - base, duration: n.duration, velocity: n.velocity }))
      } else if (e.code === 'KeyX' && sel.size) {
        e.preventDefault()
        const picked = list.filter(n => sel.has(n.id))
        const base = Math.min(...picked.map(n => n.start))
        _clipboard = picked.map(n => ({ midi: n.midi, startRel: n.start - base, duration: n.duration, velocity: n.velocity }))
        commitRef.current(list.filter(n => !sel.has(n.id)))
        setSelection(new Set())
      } else if (e.code === 'KeyV' && _clipboard.length) {
        e.preventDefault()
        // Paste in place (at the clipboard's original offset from its base,
        // relative to the current selection start — or at 0 if none).
        const picked = list.filter(n => sel.has(n.id))
        const base = picked.length ? Math.min(...picked.map(n => n.start)) : 0
        const pasted = _clipboard.map(c => ({
          id: newNoteId(), midi: c.midi, start: base + c.startRel,
          duration: c.duration, velocity: c.velocity,
        }))
        commitRef.current([...list, ...pasted])
        setSelection(new Set(pasted.map(n => n.id)))
      } else if (e.code === 'KeyB' && sel.size) {
        // FL's Ctrl+B: duplicate the selection immediately after itself.
        e.preventDefault()
        const picked = list.filter(n => sel.has(n.id))
        const from = Math.min(...picked.map(n => n.start))
        const to   = Math.max(...picked.map(n => n.start + n.duration))
        const span = Math.max(to - from, snapRef.current || 0.25)
        const dup = picked.map(n => ({ ...n, id: newNoteId(), start: n.start + span }))
        commitRef.current([...list, ...dup])
        setSelection(new Set(dup.map(n => n.id)))
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [editable])

  // ── Playhead: rAF loop reading the transport's beat clock ────────────────
  const playheadRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = playheadRef.current
    if (!el) return
    if (!isPlaying && !isPaused) {
      el.style.opacity = '0'
      return
    }
    el.style.opacity = '1'
    let raf = 0
    const draw = () => {
      const { beats } = getPlayheadBeats()
      el.style.left = `${beats * ppbRef.current}px`
    }
    const step = () => {
      draw()
      if (isPlaying && useStore.getState().isPlaying) raf = requestAnimationFrame(step)
    }
    step()
    // rAF is suspended in hidden/backgrounded tabs — a coarse interval keeps
    // the playhead honest there, and takes over seamlessly on re-focus.
    const fallback = setInterval(() => {
      if (useStore.getState().isPlaying) draw()
    }, 120)
    return () => { cancelAnimationFrame(raf); clearInterval(fallback) }
  }, [isPlaying, isPaused])

  // ── Render ────────────────────────────────────────────────────────────────

  const rows: number[] = []
  for (let m = HI_MIDI; m >= LO_MIDI; m--) rows.push(m)

  const activeNotes = currentChordIndex >= 0 && chords[currentChordIndex]
    ? new Set(chords[currentChordIndex].notes)
    : new Set<number>()

  const selectedCount = selection.size

  return (
    <div
      className={cn('flex flex-col w-full select-none overflow-hidden rounded-xl border border-border bg-[#0a0c11]', className)}
      aria-label="MIDI piano roll"
      onMouseEnter={() => { hoverRef.current = true }}
      onMouseLeave={() => { hoverRef.current = false }}
    >
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      {editable && (
        <div className="flex items-center gap-3 px-2.5 py-1.5 border-b border-border bg-[#0d1017]">
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] uppercase tracking-[2px] text-text-dim font-semibold">Snap</span>
            <div className="flex rounded-md overflow-hidden border border-border">
              {SNAP_OPTIONS.map(o => (
                <button
                  key={o.label}
                  onClick={() => setSnap(o.beats)}
                  className={cn(
                    'px-2 h-5.5 py-0.5 text-[10px] font-mono font-semibold cursor-pointer transition-colors',
                    snapBeats === o.beats
                      ? 'bg-accent text-bg-deep'
                      : 'bg-bg-raised text-text-muted hover:text-text',
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setPpb(p => Math.max(12, Math.round(p / 1.25)))}
              title="Zoom out"
              className="w-5 h-5 flex items-center justify-center rounded bg-bg-raised border border-border text-text-muted hover:text-text cursor-pointer"
            >
              <ZoomOut size={10} />
            </button>
            <button
              onClick={() => setPpb(p => Math.min(96, Math.round(p * 1.25)))}
              title="Zoom in"
              className="w-5 h-5 flex items-center justify-center rounded bg-bg-raised border border-border text-text-muted hover:text-text cursor-pointer"
            >
              <ZoomIn size={10} />
            </button>
          </div>

          {selectedCount > 0 && (
            <span className="text-[10px] text-accent font-mono">{selectedCount} selected</span>
          )}

          <span className="ml-auto text-[9px] text-text-dim hidden lg:block">
            draw · drag to move · edge to resize · right-click erase · ⌘drag select · ⌘B duplicate
          </span>
        </div>
      )}

      <div className="flex">
        {/* ── Scrollable canvas: header + gutter + grid + velocity lane ─── */}
        <div
          ref={scrollRef}
          className="flex-1 min-w-0 overflow-auto overscroll-contain"
          style={{ maxHeight: HEADER_H + GRID_H + (editable ? VEL_H : 0) }}
        >
          <div style={{ width: GUTTER_W + contentW, position: 'relative' }}>

            {/* Header strip (sticky top) */}
            <div
              className="flex sticky top-0 z-30"
              style={{ height: HEADER_H }}
            >
              <div
                className="sticky left-0 z-40 flex-shrink-0 bg-[#0d1017] border-b border-r border-border"
                style={{ width: GUTTER_W }}
              />
              <div className="relative bg-[#0d1017] border-b border-border" style={{ width: contentW }}>
                {windows.map((w, ci) => (
                  <div
                    key={ci}
                    style={{ left: w.start * pxPerBeat, width: w.beats * pxPerBeat }}
                    className={cn(
                      'group absolute top-0 bottom-0 flex items-center justify-center text-[10px] font-mono font-semibold border-r border-[#1a1f2b]',
                      ci === currentChordIndex ? 'text-accent' : 'text-text-muted',
                    )}
                  >
                    <span className="truncate px-1">{chords[ci]?.symbol ?? '·'}</span>
                    {editable && onDeleteWindow && ci < chords.length && (
                      <button
                        onClick={() => onDeleteWindow(ci)}
                        title={`Remove ${chords[ci].symbol}`}
                        className="absolute right-0.5 hidden group-hover:flex items-center justify-center w-3.5 h-3.5 rounded bg-bg-raised text-text-dim hover:text-red-400 cursor-pointer"
                      >
                        <X size={9} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Body: gutter (sticky left) + note grid */}
            <div className="flex">
              <div
                className="sticky left-0 z-20 flex-shrink-0 flex flex-col border-r border-border"
                style={{ width: GUTTER_W }}
              >
                {rows.map(midi => {
                  const semitone = midi % 12
                  const black    = IS_BLACK[semitone]
                  const active   = activeNotes.has(midi)
                  const isC      = semitone === 0
                  return (
                    <div
                      key={midi}
                      style={{ height: ROW_H }}
                      className={cn(
                        'flex items-center justify-end pr-1.5 text-[8px] font-mono leading-none border-b border-black/40',
                        black ? 'bg-[#161a24]' : 'bg-[#e8edf2]',
                        active && 'bg-accent text-bg-deep font-bold',
                        !active && (black ? 'text-text-dim' : 'text-[#5a6272]'),
                      )}
                    >
                      {isC && `C${Math.floor(midi / 12) - 1}`}
                    </div>
                  )
                })}
              </div>

              <div
                ref={gridRef}
                className="relative"
                style={{ width: contentW, height: gridH, cursor: editable ? cursor : undefined }}
                onMouseDown={handleGridMouseDown}
                onMouseMove={handleGridHover}
                onContextMenu={e => e.preventDefault()}
                title={editable ? undefined : undefined}
              >
                {/* Pitch lanes */}
                {rows.map(midi => (
                  <div
                    key={midi}
                    style={{ height: ROW_H }}
                    className={cn(
                      'border-b border-black/30',
                      IS_BLACK[midi % 12] ? 'bg-[#0d1017]' : 'bg-[#12151d]',
                      midi % 12 === 0 && 'border-b-[#252b3a]',
                    )}
                  />
                ))}

                {/* Beat gridlines (strong at window boundaries) */}
                {Array.from({ length: Math.ceil(canvasBeats) + 1 }, (_, b) => (
                  <div
                    key={b}
                    className={cn(
                      'absolute top-0 bottom-0 w-px pointer-events-none',
                      windows.some(w => Math.abs(w.start - b) < EPS) ? 'bg-[#2a3142]' : 'bg-[#1a1f2b]',
                    )}
                    style={{ left: b * pxPerBeat }}
                  />
                ))}
                {/* Sub-beat gridlines when zoomed in enough */}
                {editable && snapBeats > 0 && snapBeats < 1 && pxPerBeat * snapBeats >= 10 &&
                  Array.from({ length: Math.ceil(canvasBeats / snapBeats) }, (_, i) => {
                    const b = i * snapBeats
                    if (Math.abs(b - Math.round(b)) < EPS) return null
                    return (
                      <div
                        key={`s${i}`}
                        className="absolute top-0 bottom-0 w-px pointer-events-none bg-[#141824]"
                        style={{ left: b * pxPerBeat }}
                      />
                    )
                  })}

                {/* End-of-progression marker */}
                {chords.length > 0 && (
                  <div
                    className="absolute top-0 bottom-0 w-px pointer-events-none bg-accent/25"
                    style={{ left: totalBeats * pxPerBeat }}
                  />
                )}

                {/* Empty-state hint (grid stays fully usable) */}
                {!displayNotes.length && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <p className="text-text-dim text-xs">
                      {editable
                        ? 'Draw notes anywhere — or hit Generate for a progression'
                        : 'Pick a song to see its MIDI here'}
                    </p>
                  </div>
                )}

                {/* Notes */}
                {displayNotes.map(n => {
                  const row = HI_MIDI - n.midi
                  if (row < 0 || row > HI_MIDI - LO_MIDI) return null
                  const isSel = selection.has(n.id)
                  return (
                    <div
                      key={n.id}
                      className={cn(
                        'absolute rounded-[3px] border pointer-events-none',
                        isSel
                          ? 'bg-accent border-white/80 shadow-[0_0_8px_rgba(0,229,160,0.5)] z-10'
                          : 'bg-accent/45 border-accent/70',
                      )}
                      style={{
                        left:   n.start * pxPerBeat + 1,
                        width:  Math.max(3, n.duration * pxPerBeat - 2),
                        top:    row * ROW_H + 1,
                        height: ROW_H - 2,
                        opacity: 0.45 + n.velocity * 0.55,
                      }}
                    />
                  )
                })}

                {/* Marquee rectangle */}
                {marquee && (
                  <div
                    className="absolute border border-accent/70 bg-accent/10 pointer-events-none z-20"
                    style={{
                      left:   Math.min(marquee.x1, marquee.x2),
                      top:    Math.min(marquee.y1, marquee.y2),
                      width:  Math.abs(marquee.x2 - marquee.x1),
                      height: Math.abs(marquee.y2 - marquee.y1),
                    }}
                  />
                )}

                {/* Playhead */}
                <div
                  ref={playheadRef}
                  className="absolute top-0 bottom-0 w-[2px] bg-accent shadow-[0_0_8px_rgba(0,229,160,0.8)] opacity-0 z-20 pointer-events-none"
                  style={{ left: 0 }}
                />
              </div>
            </div>

            {/* Velocity lane (sticky bottom) */}
            {editable && (
              <div className="flex sticky bottom-0 z-30" style={{ height: VEL_H }}>
                <div
                  className="sticky left-0 z-40 flex-shrink-0 flex items-center justify-center bg-[#0d1017] border-t border-r border-border"
                  style={{ width: GUTTER_W }}
                >
                  <span className="text-[8px] uppercase tracking-widest text-text-dim rotate-0">vel</span>
                </div>
                <div
                  className="relative bg-[#0b0e14] border-t border-border cursor-ns-resize"
                  style={{ width: contentW }}
                  onMouseDown={handleVelMouseDown}
                >
                  {displayNotes.map(n => {
                    const h = Math.max(2, n.velocity * (VEL_H - 8))
                    const isSel = selection.has(n.id)
                    return (
                      <div key={n.id} className="absolute pointer-events-none" style={{ left: n.start * pxPerBeat + 1, bottom: 0, height: VEL_H }}>
                        <div
                          className={cn('absolute bottom-0 w-[3px] rounded-t', isSel ? 'bg-accent' : 'bg-accent/45')}
                          style={{ height: h }}
                        />
                        <div
                          className={cn('absolute w-[7px] h-[7px] rounded-full -translate-x-[2px]', isSel ? 'bg-accent' : 'bg-accent/60')}
                          style={{ bottom: h - 3 }}
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Right: append-chord strip ──────────────────────────────────── */}
        {editable && onAppendWindow && (
          <button
            onClick={onAppendWindow}
            title="Add a chord slot"
            className={cn(
              'flex-shrink-0 w-7 flex items-center justify-center border-l border-border',
              'text-text-dim hover:text-accent hover:bg-accent/10 cursor-pointer transition-colors',
            )}
          >
            <Plus size={13} />
          </button>
        )}
      </div>
    </div>
  )
}

// Re-export for parents that need window math alongside the roll.
export type { ChordWindow }
export { NOTE_NAMES }
