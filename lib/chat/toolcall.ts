/**
 * The copilot's tool-call contract: the JSON the in-browser LLM must produce,
 * as a JSON Schema, plus the validator that guards it.
 *
 * The LLM never touches the app directly. It emits one JSON object; we
 * normalise harmless variations ("a minor" → "A Minor", "8" → 8, "rhodes" →
 * "Electric Piano"), validate it against TOOL_CALL_SCHEMA, check it against the
 * current progression (no bar 9 in a 4-chord loop), and only then turn it into
 * the same ParsedRequest the rules parser produces. Anything that fails is
 * rejected with reasons, and the chat falls back to the rules parser.
 */
import type { InstrumentName } from '@/types'
import { MOOD_LABELS, type Mood } from '@/lib/theory/harmony'
import { KEY_NAMES } from '@/lib/theory/keys'
import type { ReharmIntent } from '@/lib/ai/generate'
import { detectKey, type ChatSettings, type ParsedRequest } from './parse'

export const TOOLS = ['generate', 'adjust', 'transpose', 'reharmonize', 'help', 'clarify'] as const
export type ToolName = (typeof TOOLS)[number]

export const MOODS = Object.keys(MOOD_LABELS) as Mood[]

/** Genre tokens the chord transformer was trained with. */
export const GENRES = [
  'pop', 'rock', 'country', 'alternative', 'pop rock', 'punk', 'metal', 'rap', 'soul', 'jazz', 'reggae', 'electronic',
] as const

export const INSTRUMENT_NAMES: InstrumentName[] = [
  'Piano', 'Electric Piano', 'Pad', 'Synth Lead', 'Organ', 'Guitar', 'Strings', 'Bass', 'Harp', 'Bell', 'Brass',
]

export const REHARM_INTENTS: ReharmIntent[] = ['surprising', 'darker', 'brighter', 'tenser', 'jazzier', 'simpler', 'resolve']

export const TOOL_CALL_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'ChordChatToolCall',
  type: 'object',
  additionalProperties: false,
  required: ['tool'],
  properties: {
    tool: { enum: TOOLS },
    mood: { enum: MOODS },
    key: { enum: KEY_NAMES },
    genre: { enum: GENRES },
    length: { type: 'integer', minimum: 2, maximum: 16 },
    bpm: { type: 'integer', minimum: 40, maximum: 240 },
    instrument: { enum: INSTRUMENT_NAMES },
    excludeDiminished: { type: 'boolean' },
    resolve: { type: 'boolean' },
    semitones: { type: 'integer', minimum: -12, maximum: 12 },
    bar: { type: 'integer', minimum: 1, maximum: 16 },
    intent: { enum: REHARM_INTENTS },
    say: { type: 'string', maxLength: 280 },
  },
  allOf: [
    { if: { properties: { tool: { const: 'transpose' } } }, then: { required: ['semitones'] } },
    { if: { properties: { tool: { const: 'reharmonize' } } }, then: { required: ['bar', 'intent'] } },
    { if: { properties: { tool: { const: 'clarify' } } }, then: { required: ['say'] } },
  ],
} as const

export interface ToolCall {
  tool: ToolName
  mood?: Mood
  key?: string
  genre?: (typeof GENRES)[number]
  length?: number
  bpm?: number
  instrument?: InstrumentName
  excludeDiminished?: boolean
  resolve?: boolean
  semitones?: number
  bar?: number
  intent?: ReharmIntent
  say?: string
}

// ── A validator for the JSON Schema subset used above ───────────────────────

type Schema = {
  type?: string
  enum?: readonly unknown[]
  const?: unknown
  minimum?: number
  maximum?: number
  maxLength?: number
  required?: readonly string[]
  properties?: Record<string, Schema>
  additionalProperties?: boolean
  allOf?: readonly { if: Schema; then: Schema }[]
}

/** Errors for `value` against `schema` (empty = valid). Supports the keywords TOOL_CALL_SCHEMA uses. */
export function validateSchema(value: unknown, schema: Schema, path = '$'): string[] {
  const errors: string[] = []
  if (schema.const !== undefined && value !== schema.const) errors.push(`${path} must be ${JSON.stringify(schema.const)}`)
  if (schema.enum && !schema.enum.includes(value)) {
    const shown = schema.enum.length > 12 ? `${schema.enum.slice(0, 12).join(', ')}…` : schema.enum.join(', ')
    errors.push(`${path} must be one of ${shown} (got ${JSON.stringify(value)})`)
  }
  switch (schema.type) {
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return [...errors, `${path} must be an object`]
      const obj = value as Record<string, unknown>
      for (const k of schema.required ?? []) if (!(k in obj)) errors.push(`${path}.${k} is required`)
      for (const [k, v] of Object.entries(obj)) {
        const sub = schema.properties?.[k]
        if (sub) errors.push(...validateSchema(v, sub, `${path}.${k}`))
        else if (schema.additionalProperties === false) errors.push(`${path}.${k} is not allowed`)
      }
      for (const { if: cond, then } of schema.allOf ?? []) {
        if (!validateSchema(value, { ...cond, type: 'object' }, path).length) errors.push(...validateSchema(value, { ...then, type: 'object' }, path))
      }
      break
    }
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) errors.push(`${path} must be an integer`)
      break
    case 'boolean':
      if (typeof value !== 'boolean') errors.push(`${path} must be a boolean`)
      break
    case 'string':
      if (typeof value !== 'string') errors.push(`${path} must be a string`)
      else if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path} is longer than ${schema.maxLength}`)
      break
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} must be ≥ ${schema.minimum}`)
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path} must be ≤ ${schema.maximum}`)
  }
  return errors
}

// ── From LLM text to a validated call ───────────────────────────────────────

/** The first balanced {...} object in model output (tolerates code fences and chatter around it). */
export function extractJson(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (ch === '\\') i++
      else if (ch === '"') inString = false
    } else if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1)
  }
  return null
}

const INSTRUMENT_ALIASES: Record<string, InstrumentName> = {
  'rhodes': 'Electric Piano', 'e-piano': 'Electric Piano', 'epiano': 'Electric Piano', 'keys': 'Electric Piano',
  'synth': 'Synth Lead', 'lead': 'Synth Lead', 'pads': 'Pad', 'synth pad': 'Pad',
  'acoustic guitar': 'Guitar', 'electric guitar': 'Guitar', 'violin': 'Strings', 'orchestra': 'Strings',
  'bells': 'Bell', 'horns': 'Brass', 'trumpet': 'Brass',
}

const MOOD_ALIASES: Record<string, Mood> = {
  happy: 'uplifting', bright: 'uplifting', brighter: 'uplifting', hopeful: 'uplifting',
  sad: 'melancholic', sadder: 'melancholic', bittersweet: 'melancholic',
  dark: 'tense', darker: 'tense', scary: 'tense', suspenseful: 'tense',
  chill: 'dreamy', 'lo-fi': 'dreamy', lofi: 'dreamy', ambient: 'dreamy', calm: 'dreamy',
  angry: 'aggressive', heavy: 'aggressive', cinematic: 'epic', heroic: 'epic',
  retro: 'nostalgic', vintage: 'nostalgic', jazzy: 'jazz', love: 'romantic', soulful: 'romantic',
}

/** Fields each tool can't do without; any other invalid field is dropped rather than failing the call. */
const REQUIRED_BY_TOOL: Partial<Record<ToolName, (keyof ToolCall)[]>> = {
  transpose: ['semitones'], reharmonize: ['bar', 'intent'], clarify: ['say'],
}

const INTENT_ALIASES: Record<string, ReharmIntent> = {
  surprise: 'surprising', unexpected: 'surprising', weirder: 'surprising', dark: 'darker', bright: 'brighter',
  tense: 'tenser', tension: 'tenser', jazz: 'jazzier', jazzy: 'jazzier', simple: 'simpler', resolved: 'resolve',
}

const lower = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : v)

const toNumber = (v: unknown) =>
  typeof v === 'string' && /^\s*[+-]?\d+(\.\d+)?\s*$/.test(v) ? Number(v) : v

const clampInt = (v: unknown, lo: number, hi: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : v

/**
 * Smooth over harmless differences before strict validation: case, synonyms,
 * numbers as strings, out-of-range lengths/tempos (clamped, like the rules
 * parser does), null fields and unknown extra fields (dropped). Values that
 * can't be repaired are left as-is so the schema rejects them.
 */
export function normalizeToolCall(raw: unknown): { value: unknown; warnings: string[] } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { value: raw, warnings: [] }
  const warnings: string[] = []
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === null || v === undefined) continue
    if (!(k in TOOL_CALL_SCHEMA.properties)) { warnings.push(`dropped unknown field "${k}"`); continue }
    out[k] = v
  }
  if (out.tool !== undefined) out.tool = lower(out.tool)
  if (out.mood !== undefined) {
    const m = lower(out.mood) as string
    // Small models put genres in the mood slot ("mood": "pop").
    if ((GENRES as readonly string[]).includes(m) && !MOODS.includes(m as Mood)) {
      if (out.genre === undefined) out.genre = m
      delete out.mood
      warnings.push(`moved genre "${m}" out of mood`)
    } else out.mood = MOOD_ALIASES[m] ?? m
  }
  if (out.genre !== undefined) out.genre = lower(out.genre)
  if (out.intent !== undefined) { const i = lower(out.intent) as string; out.intent = INTENT_ALIASES[i] ?? i }
  if (typeof out.key === 'string' && !KEY_NAMES.includes(out.key)) {
    // detectKey needs "major"/"minor" spelled out or an "in" context for bare letters.
    const k = out.key.trim()
    out.key = detectKey(/^[A-Ga-g](#|b)?$/.test(k) ? `${k} major` : k) ?? out.key
  }
  if (typeof out.instrument === 'string') {
    const name = out.instrument.trim().toLowerCase()
    out.instrument = INSTRUMENT_NAMES.find(n => n.toLowerCase() === name) ?? INSTRUMENT_ALIASES[name] ?? out.instrument
  }
  for (const k of ['length', 'bpm', 'semitones', 'bar'] as const) if (out[k] !== undefined) out[k] = toNumber(out[k])
  if (out.length !== undefined) out.length = clampInt(out.length, 2, 16)
  if (out.bpm !== undefined) out.bpm = clampInt(out.bpm, 40, 240)
  for (const k of ['excludeDiminished', 'resolve'] as const) {
    if (out[k] === 'true') out[k] = true
    if (out[k] === 'false') out[k] = false
  }
  if (typeof out.say === 'string') out.say = out.say.trim().slice(0, 280)
  return { value: out, warnings }
}

export type ToolCallResult =
  | { ok: true; call: ToolCall; warnings: string[] }
  | { ok: false; errors: string[] }

/** Parse, normalise and validate model output; `chordCount` is the current progression's length. */
export function parseToolCall(text: string, { chordCount }: { chordCount: number }): ToolCallResult {
  const json = extractJson(text)
  if (!json) return { ok: false, errors: ['no JSON object in the model output'] }
  let raw: unknown
  try { raw = JSON.parse(json) } catch (e) { return { ok: false, errors: [`invalid JSON: ${(e as Error).message}`] } }
  const { value, warnings } = normalizeToolCall(raw)
  const errors = validateSchema(value, TOOL_CALL_SCHEMA as unknown as Schema)
  // Salvage the call: drop optional fields that failed (a bad "instrument"
  // shouldn't sink a good "mood"), but never the tool or what it requires.
  if (errors.length && typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const obj = { ...(value as Record<string, unknown>) }
    const required = new Set<string>(['tool', ...(REQUIRED_BY_TOOL[obj.tool as ToolName] ?? [])])
    const bad = new Set(errors.map(e => e.match(/^\$\.(\w+)/)?.[1]).filter((f): f is string => !!f && f in obj && !required.has(f)))
    if (bad.size) {
      for (const f of bad) { delete obj[f]; warnings.push(`dropped invalid ${f} ${JSON.stringify((value as Record<string, unknown>)[f])}`) }
      // A generate/adjust with every setting dropped would ignore what was asked: reject it.
      const emptied = (obj.tool === 'generate' || obj.tool === 'adjust') && !Object.keys(obj).some(k => k !== 'tool' && k !== 'say')
      if (!emptied && !validateSchema(obj, TOOL_CALL_SCHEMA as unknown as Schema).length) {
        return checkContext(obj as unknown as ToolCall, warnings, chordCount)
      }
    }
  }
  if (errors.length) return { ok: false, errors }
  return checkContext(value as ToolCall, warnings, chordCount)
}

function checkContext(call: ToolCall, warnings: string[], chordCount: number): ToolCallResult {
  if ((call.tool === 'transpose' || call.tool === 'reharmonize') && chordCount === 0) {
    return { ok: false, errors: [`"${call.tool}" needs an existing progression`] }
  }
  if (call.tool === 'reharmonize' && call.bar! > chordCount) {
    return { ok: false, errors: [`bar ${call.bar} doesn't exist (the progression has ${chordCount} chords)`] }
  }
  if (call.tool === 'transpose' && call.semitones === 0) return { ok: false, errors: ['transpose by 0 semitones does nothing'] }
  return { ok: true, call, warnings }
}

// ── From a validated call to the request the chat already knows how to run ──

const CHORD_FIELDS = ['mood', 'key', 'genre', 'length', 'excludeDiminished', 'resolve'] as const

/** Merge a validated call into the previous settings, mirroring parseRequest's semantics. */
export function toolCallToRequest(call: ToolCall, prev: ChatSettings): ParsedRequest {
  const s: ChatSettings = { ...prev }
  const base: ParsedRequest = { settings: s, notes: [], keepChords: true, unknown: false, help: false, say: call.say }

  if (call.tool === 'help') return { ...base, help: true }
  if (call.tool === 'clarify') return { ...base, question: call.say }
  if (call.tool === 'transpose') {
    const n = call.semitones!
    const size = Math.abs(n) === 1 ? 'a semitone' : Math.abs(n) === 2 ? 'a whole step' : `${Math.abs(n)} semitones`
    return { ...base, transpose: n, notes: [`transposed ${n > 0 ? 'up' : 'down'} ${size}`] }
  }

  if (call.bpm !== undefined) s.bpm = call.bpm
  if (call.instrument !== undefined) s.instrument = call.instrument
  if (call.tool === 'reharmonize') {
    return { ...base, reharmonize: { index: call.bar! - 1, intent: call.intent! } }
  }

  // "adjust" that also names chord fields is really a fresh generation.
  const touchesChords = CHORD_FIELDS.some(f => call[f] !== undefined)
  if (call.tool === 'adjust' && !touchesChords) return base

  if (call.mood !== undefined && call.mood !== prev.mood) s.keyPinned = false
  if (call.mood !== undefined) s.mood = call.mood
  if (call.key !== undefined) { s.key = call.key; s.keyPinned = true }
  if (call.genre !== undefined) { s.genre = call.genre; base.notes.push(`${call.genre} feel`) }
  if (call.length !== undefined) s.length = call.length
  if (call.excludeDiminished !== undefined) s.excludeDiminished = call.excludeDiminished
  if (call.resolve !== undefined) s.resolve = call.resolve
  return { ...base, keepChords: false }
}
