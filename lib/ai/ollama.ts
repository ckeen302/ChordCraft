/**
 * Minimal Ollama client — free, local AI (https://ollama.com).
 *
 * The browser calls Ollama's HTTP API on localhost:11434 directly; Ollama
 * allows localhost origins by default, so no proxy or API key is needed.
 * Every failure mode resolves to { ok: false } with a human-readable hint —
 * the app never hard-depends on Ollama being installed or running.
 */

const OLLAMA_URL = 'http://127.0.0.1:11434'

export type OllamaResult =
  | { ok: true; text: string; model: string }
  | { ok: false; hint: string }

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: ctl.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** Ask the first installed chat model for a completion. */
export async function ollamaGenerate(prompt: string): Promise<OllamaResult> {
  // 1. Is Ollama running, and does it have a usable (non-embedding) model?
  let model: string
  try {
    const res = await fetchWithTimeout(`${OLLAMA_URL}/api/tags`, {}, 3000)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const models: { name: string }[] = (data.models ?? []).filter(
      (m: { name: string }) => !m.name.includes('embed'),
    )
    if (!models.length) {
      return { ok: false, hint: 'Ollama is running but has no chat models. In a terminal, run: ollama pull llama3.2' }
    }
    model = models[0].name
  } catch {
    return {
      ok: false,
      hint: 'Ollama not detected. Install the free app from ollama.com, run "ollama pull llama3.2", then try again.',
    }
  }

  // 2. Generate. The first call after startup can be slow while the model
  //    loads into memory, so the timeout is generous.
  try {
    const res = await fetchWithTimeout(
      `${OLLAMA_URL}/api/generate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          options: { temperature: 0.4, num_predict: 220 },
        }),
      },
      90_000,
    )
    if (!res.ok) {
      return { ok: false, hint: `Ollama error (HTTP ${res.status}) — try restarting the Ollama app.` }
    }
    const data = await res.json()
    const text = String(data.response ?? '').trim()
    if (!text) return { ok: false, hint: 'Ollama returned an empty response — try again.' }
    return { ok: true, text, model }
  } catch {
    return { ok: false, hint: 'Ollama took too long or dropped the connection — try again.' }
  }
}
