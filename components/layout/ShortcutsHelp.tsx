'use client'

/**
 * ShortcutsHelp — a keyboard icon in the header that opens a cheat-sheet of
 * every shortcut and piano-roll gesture in the app.
 */
import { useEffect, useState } from 'react'
import { Keyboard, X } from 'lucide-react'

const GLOBAL: [string, string][] = [
  ['Space', 'Play / pause'],
  ['M', 'Metronome on/off'],
  ['⌘Z / Ctrl+Z', 'Undo'],
  ['⇧⌘Z / Ctrl+Y', 'Redo'],
]

const ROLL: [string, string][] = [
  ['Click empty cell', 'Draw a note (drag right to set length)'],
  ['Drag a note', 'Move — the whole selection follows'],
  ['Drag right edge', 'Resize'],
  ['Right-click / drag', 'Erase'],
  ['⌘drag', 'Box-select'],
  ['⇧click', 'Add / remove from selection'],
  ['⌘A', 'Select all'],
  ['⌘C / ⌘X / ⌘V', 'Copy / cut / paste'],
  ['⌘B', 'Duplicate selection to the right'],
  ['Delete', 'Delete selection'],
  ['Esc', 'Clear selection'],
  ['Velocity lane', 'Drag bars to set loudness'],
]

function Row({ keys, action }: { keys: string; action: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <kbd className="px-1.5 py-0.5 rounded bg-bg-raised border border-border font-mono text-[11px] text-text-muted whitespace-nowrap">
        {keys}
      </kbd>
      <span className="text-xs text-text-muted text-right">{action}</span>
    </div>
  )
}

export function ShortcutsHelp() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open])

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Keyboard shortcuts"
        className="w-8 h-8 flex items-center justify-center rounded-lg border border-border bg-bg-raised text-text-muted hover:text-text hover:border-border-bright cursor-pointer transition-colors"
      >
        <Keyboard size={14} />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setOpen(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-[360px] max-h-[80vh] overflow-y-auto rounded-2xl border border-border bg-bg-panel p-5 flex flex-col gap-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-text uppercase tracking-widest">Shortcuts</h3>
              <button
                onClick={() => setOpen(false)}
                title="Close"
                className="text-text-dim hover:text-text cursor-pointer"
              >
                <X size={15} />
              </button>
            </div>

            <div className="flex flex-col gap-1.5">
              <p className="text-[10px] uppercase tracking-[2px] text-text-dim font-semibold">Transport</p>
              {GLOBAL.map(([k, a]) => <Row key={k} keys={k} action={a} />)}
            </div>

            <div className="flex flex-col gap-1.5">
              <p className="text-[10px] uppercase tracking-[2px] text-text-dim font-semibold">Piano roll</p>
              {ROLL.map(([k, a]) => <Row key={k} keys={k} action={a} />)}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
