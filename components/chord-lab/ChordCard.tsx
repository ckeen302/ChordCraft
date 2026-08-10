'use client'

import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ensureAudioReady, playChord } from '@/lib/audio/engine'
import { useStore } from '@/store/useStore'
import type { ParsedChord } from '@/types'

interface ChordCardProps {
  chord: ParsedChord
  isActive?: boolean
  /** When true, clicking the card plays a short preview of that chord. */
  interactive?: boolean
  /** When provided, an × appears on hover to remove this chord. */
  onDelete?: () => void
  className?: string
}

export function ChordCard({
  chord,
  isActive = false,
  interactive = false,
  onDelete,
  className,
}: ChordCardProps) {
  const instrument = useStore(s => s.instrument)

  async function handleClick() {
    if (!interactive) return
    await ensureAudioReady(instrument)
    playChord(chord.notes, 1.2)
  }

  return (
    <div
      onClick={handleClick}
      title={interactive ? `Preview ${chord.symbol}` : undefined}
      className={cn(
        'group relative flex flex-col items-center justify-center',
        'w-[88px] h-[100px] rounded-2xl select-none transition-all duration-150',
        'bg-bg-card border border-border',
        isActive && ['bg-accent border-accent', 'animate-pulse-glow'],
        interactive && 'cursor-pointer hover:border-accent/50 hover:bg-bg-raised',
        className,
      )}
    >
      {onDelete && (
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          title={`Remove ${chord.symbol}`}
          className={cn(
            'absolute -top-1.5 -right-1.5 z-10 hidden group-hover:flex',
            'w-5 h-5 items-center justify-center rounded-full',
            'bg-bg-raised border border-border text-text-dim',
            'hover:text-red-400 hover:border-red-400/50 cursor-pointer',
          )}
        >
          <X size={10} />
        </button>
      )}

      <span
        className={cn(
          'font-mono font-extrabold leading-none tracking-tight',
          chord.root.length === 2 ? 'text-2xl' : 'text-3xl',
          isActive ? 'text-bg-deep' : 'text-text',
        )}
      >
        {chord.root}
      </span>

      {/* Only render the quality badge when there is something to show.
          Major chords have displayQuality = '' — the root alone is sufficient. */}
      {chord.displayQuality && (
        <span
          className={cn(
            'font-mono text-xs font-semibold mt-1 leading-none',
            isActive ? 'text-bg-deep/70' : 'text-accent',
          )}
        >
          {chord.displayQuality}
        </span>
      )}
    </div>
  )
}
