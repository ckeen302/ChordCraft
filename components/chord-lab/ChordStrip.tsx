'use client'

import { ChordCard } from './ChordCard'
import { useStore } from '@/store/useStore'
import type { ParsedChord } from '@/types'

interface ChordStripProps {
  chords: ParsedChord[]
  emptyLabel?: string
  /** When true, each chord card can be clicked to preview that chord. */
  interactive?: boolean
  /** When provided, each card shows an × on hover to remove that chord. */
  onDelete?: (index: number) => void
}

export function ChordStrip({
  chords,
  emptyLabel = 'Generate a progression to see chord cards here.',
  interactive = true,
  onDelete,
}: ChordStripProps) {
  const currentChordIndex = useStore(s => s.currentChordIndex)
  const progression       = useStore(s => s.progression)

  const isActiveStrip =
    chords.length > 0 &&
    progression.length === chords.length &&
    chords[0]?.symbol === progression[0]?.symbol

  if (!chords.length) {
    return (
      <div className="flex items-center justify-center h-[120px] rounded-xl border border-dashed border-border text-text-muted text-sm italic">
        {emptyLabel}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 overflow-x-auto pb-2 min-h-[120px]">
      {chords.map((chord, i) => (
        <div key={`${chord.symbol}-${i}`} className="flex items-center gap-3 flex-shrink-0">
          <ChordCard
            chord={chord}
            isActive={isActiveStrip && currentChordIndex === i}
            interactive={interactive}
            onDelete={onDelete ? () => onDelete(i) : undefined}
          />
          {i < chords.length - 1 && (
            <span className="text-text-dim text-lg font-light select-none">›</span>
          )}
        </div>
      ))}
    </div>
  )
}
