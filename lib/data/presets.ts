/**
 * Preset Finder data access — the "what preset is that?" library.
 *
 * The library lives in SQLite (backend/db/presets.sqlite), fed by the
 * r/findthepreset ingest job (backend/chordcraft/presets). The site reads it
 * one of two ways, with the same query semantics:
 *
 *  - API mode — when NEXT_PUBLIC_API_URL points at the FastAPI backend, every
 *    search/filter/page is a GET /v1/presets request (SQLite FTS5 search).
 *  - Snapshot mode — otherwise (the default deploy, which has no backend), the
 *    site fetches public/data/presets.json, a snapshot exported from the same
 *    database, once, and runs the query in the browser.
 *
 * Status:
 *  - 'confirmed'  — official/creator-stated (e.g. factory-bank authorship)
 *  - 'community'  — an identification by producers on forums, in remakes or
 *                   in showcase videos. Treat it as a strong lead, not gospel.
 */

export interface PresetEntry {
  id: string
  artist: string
  /** The song or sound the identification is about. */
  context: string
  /** The synth/VST. */
  vst: string
  /** Preset or patch name. */
  preset: string
  notes: string
  status: 'confirmed' | 'community'
  sourceUrl: string
  sourceLabel: string
}

export type PresetSource = 'Reddit' | 'YouTube' | 'Web'
export const PRESET_SOURCES: PresetSource[] = ['Reddit', 'YouTube', 'Web']

/** Where an entry's identification comes from, derived from its source URL. */
export function presetSource(p: Pick<PresetEntry, 'sourceUrl'>): PresetSource {
  const host = new URL(p.sourceUrl).hostname
  if (host.endsWith('reddit.com')) return 'Reddit'
  if (host.endsWith('youtube.com') || host === 'youtu.be') return 'YouTube'
  return 'Web'
}

export interface PresetQuery {
  q?: string
  vst?: string | null
  source?: PresetSource | null
  offset?: number
  limit?: number
}

export interface PresetPage {
  total: number
  items: PresetEntry[]
}

export interface PresetFacets {
  total: number
  /** Every VST with its entry count, most-used first. */
  vsts: { vst: string; count: number }[]
}

/** The JSON written by `python -m chordcraft.presets export`. */
export interface PresetSnapshot {
  generatedAt: string
  count: number
  vsts: { vst: string; count: number }[]
  presets: PresetEntry[]
}

const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '')
const SNAPSHOT_URL = '/data/presets.json'

const words = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').match(/\w+/g) ?? []

/**
 * Run a query against the snapshot. Mirrors the API: every search word must
 * prefix-match a word in artist/context/vst/preset (like the FTS5 index),
 * results ordered by artist then id.
 */
export function queryPresets(presets: PresetEntry[], query: PresetQuery): PresetPage {
  const terms = words(query.q ?? '')
  const matches = presets.filter(p => {
    if (query.vst && p.vst !== query.vst) return false
    if (query.source && presetSource(p) !== query.source) return false
    if (!terms.length) return true
    const haystack = words(`${p.artist} ${p.context} ${p.vst} ${p.preset}`)
    return terms.every(t => haystack.some(w => w.startsWith(t)))
  })
  matches.sort((a, b) =>
    a.artist.localeCompare(b.artist, 'en', { sensitivity: 'base' }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const offset = query.offset ?? 0
  return { total: matches.length, items: matches.slice(offset, offset + (query.limit ?? 50)) }
}

let snapshot: Promise<PresetSnapshot> | null = null

function loadSnapshot(): Promise<PresetSnapshot> {
  snapshot ??= fetch(SNAPSHOT_URL).then(r => {
    if (!r.ok) throw new Error(`Preset snapshot failed to load (${r.status})`)
    return r.json() as Promise<PresetSnapshot>
  })
  // A failed load shouldn't be cached forever — let the next call retry.
  snapshot.catch(() => { snapshot = null })
  return snapshot
}

async function api<T>(path: string): Promise<T> {
  const r = await fetch(`${API_URL}${path}`)
  if (!r.ok) throw new Error(`Preset API error ${r.status}`)
  return r.json() as Promise<T>
}

export async function fetchPresets(query: PresetQuery): Promise<PresetPage> {
  if (!API_URL) return queryPresets((await loadSnapshot()).presets, query)
  const params = new URLSearchParams({ offset: String(query.offset ?? 0), limit: String(query.limit ?? 50) })
  if (query.q?.trim()) params.set('q', query.q.trim())
  if (query.vst) params.set('vst', query.vst)
  if (query.source) params.set('source', query.source)
  return api<PresetPage>(`/v1/presets?${params}`)
}

export async function fetchPresetFacets(): Promise<PresetFacets> {
  if (!API_URL) {
    const s = await loadSnapshot()
    return { total: s.count, vsts: s.vsts }
  }
  return api<PresetFacets>('/v1/presets/facets')
}

/** 'api' or 'snapshot' — shown in the tab's provenance note. */
export const PRESET_BACKEND: 'api' | 'snapshot' = API_URL ? 'api' : 'snapshot'
