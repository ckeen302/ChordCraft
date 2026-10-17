import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from './parse'
import { extractJson, parseToolCall, TOOL_CALL_SCHEMA, toolCallToRequest, validateSchema } from './toolcall'

const ctx = { chordCount: 4 }
const parse = (raw: unknown, c = ctx) => parseToolCall(typeof raw === 'string' ? raw : JSON.stringify(raw), c)

describe('extractJson', () => {
  it('finds the object inside fences and chatter', () => {
    expect(extractJson('Sure!\n```json\n{"tool": "help"}\n```')).toBe('{"tool": "help"}')
    expect(extractJson('{"tool": "generate", "say": "a } in a string"} trailing')).toBe('{"tool": "generate", "say": "a } in a string"}')
    expect(extractJson('{"tool": "generate"')).toBeNull()
    expect(extractJson('no json here')).toBeNull()
  })
})

describe('TOOL_CALL_SCHEMA', () => {
  const v = (x: unknown) => validateSchema(x, TOOL_CALL_SCHEMA as never)
  it('accepts well-formed calls', () => {
    expect(v({ tool: 'generate', mood: 'dreamy', key: 'Eb Major', length: 8, bpm: 90, instrument: 'Pad', genre: 'alternative' })).toEqual([])
    expect(v({ tool: 'reharmonize', bar: 3, intent: 'surprising' })).toEqual([])
    expect(v({ tool: 'transpose', semitones: -2 })).toEqual([])
  })
  it('rejects bad types, enums, ranges and extra fields', () => {
    expect(v({ tool: 'compose' })[0]).toMatch(/\$\.tool must be one of/)
    expect(v({ tool: 'generate', mood: 'sleepy' })[0]).toMatch(/\$\.mood/)
    expect(v({ tool: 'generate', length: 2.5 })).toContain('$.length must be an integer')
    expect(v({ tool: 'generate', bpm: 400 })).toContain('$.bpm must be ≤ 240')
    expect(v({ tool: 'generate', resolve: 'yes' })).toContain('$.resolve must be a boolean')
    expect(v({ tool: 'generate', reason: 'x' })).toContain('$.reason is not allowed')
    expect(v({ mood: 'jazz' })).toContain('$.tool is required')
    expect(v([])).toEqual(['$ must be an object'])
  })
  it('enforces per-tool required fields', () => {
    expect(v({ tool: 'transpose' })).toContain('$.semitones is required')
    expect(v({ tool: 'reharmonize', bar: 2 })).toContain('$.intent is required')
    expect(v({ tool: 'clarify' })).toContain('$.say is required')
  })
})

describe('parseToolCall', () => {
  it('normalises harmless variations', () => {
    const r = parse({ tool: 'Generate', mood: 'Sad', key: 'a minor', length: '8', bpm: 300, instrument: 'rhodes', resolve: 'true', reason: 'because' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.call).toEqual({ tool: 'generate', mood: 'melancholic', key: 'A Minor', length: 8, bpm: 240, instrument: 'Electric Piano', resolve: true })
    expect(r.warnings).toEqual(['dropped unknown field "reason"'])
  })
  it('spells keys canonically', () => {
    for (const [given, want] of [['Db minor', 'C# Minor'], ['F#', 'F# Major'], ['Bbm', 'Bb Minor']]) {
      const r = parse({ tool: 'generate', key: given })
      expect(r.ok && r.call.key).toBe(want)
    }
  })
  it('drops invalid optional fields but keeps the rest of the call', () => {
    const r = parse({ tool: 'generate', mood: 'dreamy', key: 'H major', instrument: 'kazoo' })
    expect(r).toEqual({
      ok: true, call: { tool: 'generate', mood: 'dreamy' },
      warnings: ['dropped invalid key "H major"', 'dropped invalid instrument "kazoo"'],
    })
    const g = parse({ tool: 'generate', mood: 'Pop', genre: undefined })
    expect(g).toMatchObject({ ok: true, call: { tool: 'generate', genre: 'pop' } })
  })
  it('rejects what it cannot repair', () => {
    expect(parse('I think you want something sad')).toEqual({ ok: false, errors: ['no JSON object in the model output'] })
    expect(parse('{"tool": "generate", mood: dreamy}').ok).toBe(false)
    expect(parse({ tool: 'compose', mood: 'dreamy' }).ok).toBe(false)
    expect(parse({ tool: 'reharmonize', bar: 2, intent: 'louder' }).ok).toBe(false)
    expect(parse({ tool: 'transpose', semitones: 'up' }).ok).toBe(false)
  })
  it('checks calls against the current progression', () => {
    expect(parse({ tool: 'reharmonize', bar: 6, intent: 'darker' })).toMatchObject({ ok: false, errors: [expect.stringMatching(/bar 6/)] })
    expect(parse({ tool: 'transpose', semitones: 2 }, { chordCount: 0 }).ok).toBe(false)
    expect(parse({ tool: 'transpose', semitones: 0 }).ok).toBe(false)
  })
})

describe('toolCallToRequest', () => {
  const prev = { ...DEFAULT_SETTINGS, key: 'D Major', keyPinned: true, mood: 'uplifting' as const, bpm: 100 }
  it('generate merges into the previous settings', () => {
    const r = toolCallToRequest({ tool: 'generate', mood: 'dreamy', genre: 'alternative', say: 'Floaty.' }, prev)
    expect(r.keepChords).toBe(false)
    expect(r.settings).toMatchObject({ mood: 'dreamy', genre: 'alternative', key: 'D Major', keyPinned: false, bpm: 100 })
    expect(r.say).toBe('Floaty.')
  })
  it('a named key is pinned', () => {
    expect(toolCallToRequest({ tool: 'generate', mood: 'tense', key: 'F Minor' }, prev).settings).toMatchObject({ key: 'F Minor', keyPinned: true })
  })
  it('adjust keeps the chords unless it touches harmony', () => {
    expect(toolCallToRequest({ tool: 'adjust', bpm: 72, instrument: 'Strings' }, prev)).toMatchObject({ keepChords: true, settings: { bpm: 72, instrument: 'Strings' } })
    expect(toolCallToRequest({ tool: 'adjust', mood: 'jazz' }, prev).keepChords).toBe(false)
  })
  it('maps the edit tools', () => {
    expect(toolCallToRequest({ tool: 'transpose', semitones: -1 }, prev)).toMatchObject({ transpose: -1, notes: ['transposed down a semitone'] })
    expect(toolCallToRequest({ tool: 'reharmonize', bar: 3, intent: 'surprising' }, prev).reharmonize).toEqual({ index: 2, intent: 'surprising' })
    expect(toolCallToRequest({ tool: 'clarify', say: 'What mood?' }, prev).question).toBe('What mood?')
    expect(toolCallToRequest({ tool: 'help' }, prev).help).toBe(true)
  })
})
