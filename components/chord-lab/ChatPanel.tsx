'use client'

/**
 * ChatPanel — describe a progression in plain English and the chord
 * transformer writes it into the piano roll. Follow-ups refine it.
 * An optional in-browser LLM copilot reads free-form requests; without it
 * (or when it slips) the rules parser answers instantly.
 */
import { useEffect, useRef, useState } from 'react'
import { Cpu, Loader2, MessageSquare, Send, Sparkles, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { COPILOT_MODELS, downloadMb, modelsFor, type Backend } from '@/lib/chat/llm/engine'

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  /** Who read the request (shown only while the copilot is on). */
  source?: 'llm' | 'rules'
  /** Why the copilot's answer was set aside. */
  fallback?: string
}

export interface CopilotState {
  status: 'off' | 'loading' | 'ready' | 'error'
  modelId: string
  backend?: Backend
  loaded?: number
  total?: number
  error?: string
}

const SUGGESTIONS = [
  'sad lo-fi in A minor, 8 chords',
  'epic movie trailer',
  'smooth jazz on rhodes',
  'make it darker',
  'make bar 3 more surprising',
  'another one',
]

const COPILOT_SUGGESTIONS = [
  'something like Radiohead\'s bridges but brighter',
  'a rainy-day coffee shop vibe',
  'make bar 2 tenser',
  'villain entrance music',
  'slow it down, put it on strings',
  'another one',
]

const mb = (bytes: number) => Math.round(bytes / 1e6)

function CopilotBar({
  state, onEnable, onDisable,
}: {
  state: CopilotState
  onEnable: (modelId: string) => void
  onDisable: () => void
}) {
  const [modelId, setModelId] = useState(state.modelId)
  const backend = state.backend
  const model = COPILOT_MODELS.find(m => m.id === (state.status === 'off' || state.status === 'error' ? modelId : state.modelId))!
  const onGpu = backend?.device === 'webgpu'
  const options = backend ? modelsFor(backend) : []
  const size = backend && downloadMb(model, backend)

  if (state.status === 'ready') {
    return (
      <div className="flex items-center gap-2 text-[11px] text-text-muted">
        <Sparkles size={11} className="text-accent" />
        <span>
          <span className="text-text font-medium">AI copilot on</span> · {model.label} · {onGpu ? 'WebGPU' : 'CPU (WASM)'}
        </span>
        <button onClick={onDisable} className="ml-auto flex items-center gap-1 hover:text-text cursor-pointer" title="Turn the copilot off">
          <X size={11} /> Turn off
        </button>
      </div>
    )
  }
  if (state.status === 'loading') {
    const pct = state.total ? Math.min(100, (100 * (state.loaded ?? 0)) / state.total) : 0
    return (
      <div className="flex flex-col gap-1.5 text-[11px] text-text-muted">
        <div className="flex items-center gap-2">
          <Loader2 size={11} className="animate-spin text-accent" />
          <span>
            Loading {model.label}{state.total ? ` — ${mb(state.loaded ?? 0)} / ${mb(state.total)} MB` : '…'}
            {' '}(cached after the first time)
          </span>
          <button onClick={onDisable} className="ml-auto hover:text-text cursor-pointer">Cancel</button>
        </div>
        <div className="h-1 rounded-full bg-bg-panel overflow-hidden">
          <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
      <Sparkles size={11} className="text-accent" />
      <span>
        <span className="text-text font-medium">AI copilot</span> — an LLM that runs in your browser and reads free-form requests.
      </span>
      {state.status === 'error' && <span className="text-red-400">Couldn&apos;t load it ({state.error}).</span>}
      {backend && !onGpu && (
        <span className="flex items-center gap-1"><Cpu size={11} /> No WebGPU here: it runs on the CPU, so replies take a while.</span>
      )}
      <div className="flex items-center gap-1.5 ml-auto">
        {options.length > 1 && (
          <select
            value={modelId}
            onChange={e => setModelId(e.target.value)}
            aria-label="Copilot model"
            className="bg-bg-panel border border-border rounded-lg text-[11px] text-text px-1.5 py-1 cursor-pointer"
          >
            {options.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        )}
        <button
          onClick={() => onEnable(model.id)}
          disabled={!backend || !size}
          className="px-2.5 py-1 rounded-lg border border-accent/40 text-accent hover:bg-accent/10 cursor-pointer disabled:opacity-40"
        >
          {state.status === 'error' ? 'Retry' : 'Enable'}{size ? ` · ${size >= 1000 ? `${(size / 1000).toFixed(1)} GB` : `${size} MB`} download` : ''}
        </button>
      </div>
    </div>
  )
}

export function ChatPanel({
  messages, busy, onSend, copilot, onEnableCopilot, onDisableCopilot,
}: {
  messages: ChatMessage[]
  busy: boolean
  onSend: (text: string) => void
  copilot: CopilotState
  onEnableCopilot: (modelId: string) => void
  onDisableCopilot: () => void
}) {
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  function send(text: string) {
    const t = text.trim()
    if (!t || busy) return
    onSend(t)
    setDraft('')
  }

  return (
    <div className="flex flex-col rounded-xl border border-accent/25 bg-bg-raised/60">
      <div className="flex items-center gap-2 px-3.5 pt-3">
        <MessageSquare size={12} className="text-accent" />
        <span className="text-[10px] font-bold text-accent uppercase tracking-[2px]">Chord Chat</span>
        <span className="text-[10px] text-text-dim">— describe it, the AI writes it into the piano roll</span>
      </div>

      {messages.length > 0 && (
        <div ref={listRef} className="flex flex-col gap-2 px-3.5 pt-3 max-h-56 overflow-y-auto" aria-live="polite">
          {messages.map((m, i) => (
            <div
              key={i}
              className={cn(
                'max-w-[85%] px-3 py-2 rounded-xl text-[12.5px] leading-relaxed',
                m.role === 'user'
                  ? 'self-end bg-accent text-bg-deep font-medium'
                  : 'self-start bg-bg-panel border border-border text-text',
              )}
            >
              {m.text}
              {m.source && (
                <span
                  title={m.fallback ? `Copilot answer set aside: ${m.fallback}` : undefined}
                  className="block mt-1 text-[9.5px] uppercase tracking-[1.5px] text-text-dim"
                >
                  {m.source === 'llm' ? 'via AI copilot' : m.fallback ? 'via rules (copilot fallback)' : 'via rules'}
                </span>
              )}
            </div>
          ))}
          {busy && (
            <div className="self-start flex items-center gap-2 px-3 py-2 rounded-xl bg-bg-panel border border-border text-[12px] text-text-muted">
              <Loader2 size={12} className="animate-spin" /> {copilot.status === 'ready' ? 'thinking…' : 'writing chords…'}
            </div>
          )}
        </div>
      )}

      <div className="px-3.5 pt-3">
        <CopilotBar state={copilot} onEnable={onEnableCopilot} onDisable={onDisableCopilot} />
      </div>

      <form
        onSubmit={e => { e.preventDefault(); send(draft) }}
        className="flex items-center gap-2 p-3"
      >
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder='e.g. "dreamy chords in Eb major, slow, on pads"'
          aria-label="Describe a chord progression"
          className="flex-1 bg-bg-panel border border-border rounded-xl text-sm text-text px-3 py-2 focus:outline-none focus:border-accent/60 placeholder:text-text-dim"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          title="Send"
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-accent text-bg-deep hover:bg-accent-hover cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        </button>
      </form>

      <div className="flex flex-wrap gap-1.5 px-3 pb-3 -mt-1">
        {(copilot.status === 'ready' ? COPILOT_SUGGESTIONS : SUGGESTIONS).map(s => (
          <button
            key={s}
            onClick={() => send(s)}
            disabled={busy}
            className="px-2.5 py-1 rounded-full text-[11px] border border-border bg-bg-panel text-text-muted hover:text-text hover:border-accent/40 cursor-pointer transition-colors disabled:opacity-40"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}
