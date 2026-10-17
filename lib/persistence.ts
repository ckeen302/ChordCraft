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
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
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

export function persistSaved(list: SavedProg[]) {
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(list)) } catch { /* storage full */ }
}
