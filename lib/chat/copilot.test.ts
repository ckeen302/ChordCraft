import { describe, expect, it } from 'vitest'
import { interpret, type CompleteFn } from './copilot'
import { DEFAULT_SETTINGS } from './parse'
import { PREFILL } from './prompt'

/** A fake LLM that returns a fixed continuation of the prefill. */
const says = (continuation: string): CompleteFn => async () => continuation
const chords = ['C', 'G', 'Am', 'F']

describe('interpret', () => {
  it('uses the rules parser when no copilot is loaded', async () => {
    const r = await interpret('sad lofi in A minor', DEFAULT_SETTINGS, { chords })
    expect(r).toMatchObject({ source: 'rules', request: { settings: { key: 'A Minor' } } })
    expect(r.fallback).toBeUndefined()
  })

  it('uses a valid LLM tool call', async () => {
    const complete = says('generate", "mood": "dreamy", "genre": "alternative", "say": "Floaty alt-rock."}')
    const r = await interpret("like Radiohead's bridges but brighter", DEFAULT_SETTINGS, { chords, complete })
    expect(r.source).toBe('llm')
    expect(r.request.settings).toMatchObject({ mood: 'dreamy', genre: 'alternative' })
    expect(r.request.say).toBe('Floaty alt-rock.')
  })

  it('sends the prompt with the current chords and the prefill', async () => {
    let seen: Parameters<CompleteFn> | null = null
    const complete: CompleteFn = async (...args) => { seen = args; return 'help"}' }
    await interpret('what can you do', DEFAULT_SETTINGS, { chords, complete })
    expect(seen![1]).toBe(PREFILL)
    expect(seen![0][0].content).toContain('Chords: 1:C 2:G 3:Am 4:F')
    expect(seen![0].at(-1)).toEqual({ role: 'user', content: 'what can you do' })
  })

  it.each([
    ['invalid JSON', says('generate", mood: dreamy}'), /invalid JSON/],
    ['a schema violation', says('generate", "mood": "sleepy"}'), /\$\.mood/],
    ['an impossible edit', says('reharmonize", "bar": 9, "intent": "darker"}'), /bar 9/],
    ['a crash', (async () => { throw new Error('GPU device lost') }) as CompleteFn, /GPU device lost/],
  ])('falls back to rules on %s', async (_, complete, reason) => {
    const r = await interpret('make it darker', DEFAULT_SETTINGS, { chords, complete })
    expect(r.source).toBe('rules')
    expect(r.fallback).toMatch(reason)
    expect(r.request.settings.mood).toBe('tense')
  })

  it('falls back to rules on a timeout', async () => {
    const complete: CompleteFn = () => new Promise(() => {})
    const r = await interpret('faster', { ...DEFAULT_SETTINGS, bpm: 100 }, { chords, complete, timeoutMs: 10 })
    expect(r).toMatchObject({ source: 'rules', request: { settings: { bpm: 125 } } })
    expect(r.fallback).toMatch(/longer than/)
  })

  it('prefers rules when the model punts on something the rules understand', async () => {
    const r = await interpret('epic movie trailer', DEFAULT_SETTINGS, { chords, complete: says('clarify", "say": "What do you mean?"}') })
    expect(r).toMatchObject({ source: 'rules', request: { settings: { mood: 'epic' } } })
  })

  it('keeps a clarifying question for off-topic messages', async () => {
    const r = await interpret('asdf qwerty', DEFAULT_SETTINGS, { chords, complete: says('clarify", "say": "What kind of progression?"}') })
    expect(r).toMatchObject({ source: 'llm', request: { question: 'What kind of progression?' } })
  })
})

describe('few-shot prompting', () => {
  it('drops the examples for fine-tuned models', async () => {
    const lengths: number[] = []
    const complete: CompleteFn = async msgs => { lengths.push(msgs.length); return 'help"}' }
    await interpret('help me', DEFAULT_SETTINGS, { chords, complete })
    await interpret('help me', DEFAULT_SETTINGS, { chords, complete, fewShot: false })
    expect(lengths[0]).toBeGreaterThan(2)
    expect(lengths[1]).toBe(2)
  })
})
