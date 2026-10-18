'use client'

/**
 * ChordCraftApp
 *
 * Root client component. Dynamically imported with `ssr: false` from app/page.tsx
 * to keep Tone.js and all browser-only code out of the SSR bundle.
 */
import { useState } from 'react'
import { Music2, Disc3, SlidersHorizontal } from 'lucide-react'
import { TransportBar } from './layout/TransportBar'
import { SettingsPanel } from './layout/SettingsPanel'
import { ShortcutsHelp } from './layout/ShortcutsHelp'
import { ChordLab } from './chord-lab/ChordLab'
import { PopularSongs } from './songs/PopularSongs'
import { PresetLibrary } from './presets/PresetLibrary'
import { cn } from '@/lib/utils'

type Tab = 'lab' | 'songs' | 'presets'

const TABS: { id: Tab; label: string; icon: typeof Music2 }[] = [
  { id: 'lab',     label: 'Generator',     icon: Music2 },
  { id: 'songs',   label: 'Popular Songs', icon: Disc3 },
  { id: 'presets', label: 'Preset Finder', icon: SlidersHorizontal },
]

export default function ChordCraftApp() {
  const [tab, setTab] = useState<Tab>('lab')

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-bg-deep text-text">
      {/* Slim brand header with tab nav */}
      <header className="flex items-center justify-between gap-2 px-3 sm:px-6 py-2.5 border-b border-border bg-bg-panel flex-shrink-0">
        <div className="flex items-baseline gap-3">
          <h1 className="text-base sm:text-lg font-extrabold tracking-widest text-text uppercase leading-none">
            Chord<span className="text-accent">Craft</span>
          </h1>
          <p className="text-[9px] tracking-[3px] uppercase text-text-muted hidden sm:block">
            progression studio
          </p>
        </div>

        {/* Tabs */}
        <nav className="flex items-center gap-1 bg-bg-raised rounded-xl p-1 border border-border">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              aria-label={label}
              title={label}
              className={cn(
                'flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer',
                tab === id
                  ? 'bg-accent text-bg-deep'
                  : 'text-text-muted hover:text-text',
              )}
            >
              <Icon size={13} />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <p className="text-[11px] text-text-dim hidden md:block">
            <kbd className="px-1 py-0.5 rounded bg-bg-raised border border-border font-mono text-[10px] text-text-muted">
              Space
            </kbd>{' '}
            to play
          </p>
          <ShortcutsHelp />
          <SettingsPanel />
        </div>
      </header>

      {/* Stage — both panels stay mounted so switching tabs never loses
          state (progression, undo history, selected song); the inactive one
          is just hidden. */}
      <main className="flex-1 min-h-0 overflow-hidden">
        <div className={cn('h-full', tab !== 'lab' && 'hidden')}>
          <ChordLab active={tab === 'lab'} />
        </div>
        <div className={cn('h-full', tab !== 'songs' && 'hidden')}>
          <PopularSongs />
        </div>
        <div className={cn('h-full', tab !== 'presets' && 'hidden')}>
          <PresetLibrary />
        </div>
      </main>

      {/* Sticky DAW transport bar */}
      <TransportBar />
    </div>
  )
}
