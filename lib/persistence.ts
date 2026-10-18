/**
 * localStorage persistence for the generator: recent-generation history and
 * user-named saved progressions. Every reader validates and degrades to an
 * empty list, so corrupt or foreign storage can never crash the app.
 */
import type { NoteEvent, ParsedChord } from '@/types'

// ─── Progression history (last 10 generations) ───────────────────────────────

export interface HistoryEntry {
  symbols: string[]
  key: string
  ts: number
  /** Per-chord durations (harmonic rhythm), when the entry carried one. */
  beats?: (number | undefined)[]
}

const HISTORY_KEY = 'chordcraft-history'
export const HISTORY_MAX = 10

export function readHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    const list = raw ? JSON.parse(raw) : []
    if (!Array.isArray(list)) return []
    return list.filter((e: HistoryEntry) =>
      e && typeof e.key === 'string' && Array.isArray(e.symbols) &&
      e.symbols.length > 0 && e.symbols.every(s => typeof s === 'string'),
    )
  } catch {
    return []
  }
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/** Saved note timelines must be fully numeric, or the transport's length becomes NaN. */
function validNotes(notes: unknown): notes is NoteEvent[] {
  return Array.isArray(notes) && notes.every(n =>
    n && typeof n.id === 'string' && finite(n.midi) && finite(n.start) && n.start >= 0 &&
    finite(n.duration) && n.duration > 0 && finite(n.velocity))
}

export function persistHistory(list: HistoryEntry[]) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)) } catch { /* storage full */ }
}

export function clearStoredHistory() {
  try { localStorage.removeItem(HISTORY_KEY) } catch { /* ignore */ }
}

// ─── Saved progressions (user-named favourites) ──────────────────────────────

export interface SavedProg {
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
export const SAVED_MAX = 30

export function readSaved(): SavedProg[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY)
    const list = raw ? JSON.parse(raw) : []
    if (!Array.isArray(list)) return []
    return list
      .filter((s: SavedProg) =>
        s && typeof s.id === 'string' && typeof s.name === 'string' && typeof s.key === 'string' &&
        Array.isArray(s.chords) &&
        s.chords.every(c => c && typeof c.symbol === 'string' &&
          Array.isArray(c.notes) && c.notes.every(finite)),
      )
      .map((s: SavedProg) => (s.notes === undefined || validNotes(s.notes) ? s : { ...s, notes: undefined }))
  } catch {
    return []
  }
}

export function persistSaved(list: SavedProg[]) {
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(list)) } catch { /* storage full */ }
}
