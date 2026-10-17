/**
 * Client for the ChordCraft backend (FastAPI, `backend/`).
 *
 * The URL comes from NEXT_PUBLIC_API_URL; without it, production builds use
 * the Hugging Face Space and development uses http://localhost:8000. Every call
 * fails soft: the generator UI falls back to the in-browser rule engine when
 * the backend or its model is unavailable.
 */
import type { ChordQuality, InstrumentName, ParsedChord } from '@/types'
import { QUALITY_INTERVALS } from '@/lib/theory/chords'

const DEFAULT_API_URL = process.env.NODE_ENV === 'production'
  ? 'https://ckeen302-chordcraft-api.hf.space'
  : 'http://localhost:8000'

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL).replace(/\/+$/, '')

const INSTRUMENTS: InstrumentName[] = [
  'Piano', 'Electric Piano', 'Pad', 'Synth Lead', 'Organ',
  'Guitar', 'Strings', 'Bass', 'Harp', 'Bell', 'Brass',
]

export interface ApiChord {
  symbol: string
  root: string
  quality: string
  notes: number[]
  displayQuality: string
  beats?: number | null
}

export interface ApiGenerateRequest {
  key: string
  mood: string
  length: number
  excludeDiminished?: boolean
  seed?: number
  engine?: 'auto' | 'model' | 'rules'
}

export interface ApiGenerateResponse {
  engine: 'rules' | 'model'
  key: string
  mood: string
  chords: ApiChord[]
  romans: string[]
  patternName: string
  bpm: number
  instrument: string
  rollMs: number
}

export class ApiError extends Error {}

async function request<T>(path: string, init?: RequestInit, timeoutMs = 8000): Promise<T> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, signal: ctl.signal })
  } catch {
    throw new ApiError(`Can't reach the ChordCraft backend at ${API_URL}.`)
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const body = await res.json()
      if (typeof body?.detail === 'string') detail = body.detail
    } catch { /* non-JSON error body */ }
    throw new ApiError(detail)
  }
  return res.json() as Promise<T>
}

/** Is the backend up, and is the trained chord model loaded? */
export async function checkBackend(): Promise<{ online: boolean; model: boolean }> {
  try {
    const body = await request<{ status: string; model?: boolean }>('/health', undefined, 3000)
    return { online: body.status === 'ok', model: body.model === true }
  } catch {
    return { online: false, model: false }
  }
}

export function generateProgression(req: ApiGenerateRequest): Promise<ApiGenerateResponse> {
  return request<ApiGenerateResponse>('/v1/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
}

/** Validate API chords into the app's ParsedChord shape (drops anything malformed). */
export function toParsedChords(chords: ApiChord[]): ParsedChord[] {
  return chords.flatMap(c => {
    if (
      typeof c?.symbol !== 'string' || typeof c.root !== 'string' ||
      !Object.hasOwn(QUALITY_INTERVALS, c.quality) ||
      !Array.isArray(c.notes) || !c.notes.length || !c.notes.every(n => Number.isInteger(n) && n >= 0 && n <= 127)
    ) return []
    const beats = typeof c.beats === 'number' && c.beats > 0 ? c.beats : undefined
    return [{
      symbol: c.symbol,
      root: c.root,
      quality: c.quality as ChordQuality,
      notes: c.notes,
      displayQuality: typeof c.displayQuality === 'string' ? c.displayQuality : '',
      beats,
    }]
  })
}

export function asInstrument(name: string): InstrumentName | null {
  return (INSTRUMENTS as string[]).includes(name) ? (name as InstrumentName) : null
}
