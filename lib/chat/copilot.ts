/**
 * Route a chat message through the LLM copilot when it's loaded, and through
 * the rules parser otherwise — or whenever the LLM fails, times out, or
 * produces a tool call that doesn't validate. The chat always gets a
 * ParsedRequest either way.
 */
import { parseRequest, type ChatSettings, type ParsedRequest } from './parse'
import { buildMessages, PREFILL, type ChatTurn } from './prompt'
import { parseToolCall, toolCallToRequest } from './toolcall'

/** Run the LLM: chat messages + assistant prefill → generated continuation. */
export type CompleteFn = (messages: ChatTurn[], prefill: string) => Promise<string>

export interface Interpretation {
  request: ParsedRequest
  source: 'llm' | 'rules'
  /** Why the LLM's answer wasn't used (when it was tried). */
  fallback?: string
  /** Raw model output, for debugging. */
  raw?: string
}

export async function interpret(
  text: string,
  prev: ChatSettings,
  { chords, complete, fewShot = true, timeoutMs = 60_000 }: {
    chords: string[]; complete?: CompleteFn | null; fewShot?: boolean; timeoutMs?: number
  },
): Promise<Interpretation> {
  const rules = () => parseRequest(text, prev)
  if (!complete) return { request: rules(), source: 'rules' }

  let raw: string
  try {
    raw = PREFILL + await withTimeout(complete(buildMessages(text, prev, chords, { examples: fewShot }), PREFILL), timeoutMs)
  } catch (e) {
    return { request: rules(), source: 'rules', fallback: (e as Error).message }
  }
  const parsed = parseToolCall(raw, { chordCount: chords.length })
  if (!parsed.ok) return { request: rules(), source: 'rules', fallback: parsed.errors.join('; '), raw }

  const request = toolCallToRequest(parsed.call, prev)
  // A small model sometimes punts on a request the rules parser understands.
  if (request.question) {
    const r = rules()
    if (!r.unknown && !r.help) return { request: r, source: 'rules', fallback: 'the model asked to clarify a request the rules parser understood', raw }
  }
  return { request, source: 'llm', raw }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`the model took longer than ${Math.round(ms / 1000)} s`)), ms)
    p.then(v => { clearTimeout(t); resolve(v) }, e => { clearTimeout(t); reject(e) })
  })
}
