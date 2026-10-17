'use client'

/**
 * ChatPanel — describe a progression in plain English and the chord
 * transformer writes it into the piano roll. Follow-ups refine it.
 */
import { useEffect, useRef, useState } from 'react'
import { Loader2, MessageSquare, Send } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
}

const SUGGESTIONS = [
  'sad lo-fi in A minor, 8 chords',
  'epic movie trailer',
  'smooth jazz on rhodes',
  'make it darker',
  'faster',
  'another one',
]

export function ChatPanel({
  messages, busy, onSend,
}: {
  messages: ChatMessage[]
  busy: boolean
  onSend: (text: string) => void
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
            </div>
          ))}
          {busy && (
            <div className="self-start flex items-center gap-2 px-3 py-2 rounded-xl bg-bg-panel border border-border text-[12px] text-text-muted">
              <Loader2 size={12} className="animate-spin" /> writing chords…
            </div>
          )}
        </div>
      )}

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
        {SUGGESTIONS.map(s => (
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
