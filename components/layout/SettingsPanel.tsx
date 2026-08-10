'use client'

/**
 * SettingsPanel
 *
 * Gear button + modal for persisted defaults (BPM, instrument, beats per
 * chord, volume). Stored in localStorage and applied to the store once on
 * mount, so the app opens the way the user left it configured. Saving also
 * applies immediately.
 */
import { useEffect, useState } from 'react'
import { Settings, X, RotateCcw } from 'lucide-react'
import { useStore } from '@/store/useStore'
import { cn } from '@/lib/utils'
import type { InstrumentName } from '@/types'

const INSTRUMENTS: InstrumentName[] = [
  'Piano', 'Electric Piano', 'Pad', 'Synth Lead', 'Organ',
  'Guitar', 'Strings', 'Bass', 'Harp', 'Bell', 'Brass',
]

const BEATS_OPTIONS: (1 | 2 | 4)[] = [1, 2, 4]
const SETTINGS_KEY = 'chordcraft-settings'

interface AppSettings {
  bpm: number
  instrument: InstrumentName
  beatsPerChord: 1 | 2 | 4
  volume: number
}

const APP_DEFAULTS: AppSettings = { bpm: 100, instrument: 'Piano', beatsPerChord: 2, volume: 80 }

function clampNum(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback
}

/** Read + validate stored settings; null when nothing (valid) is stored. */
function readSettings(): AppSettings | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return null
    const s = JSON.parse(raw)
    return {
      bpm: clampNum(s.bpm, 40, 240, APP_DEFAULTS.bpm),
      volume: clampNum(s.volume, 0, 100, APP_DEFAULTS.volume),
      instrument: INSTRUMENTS.includes(s.instrument) ? s.instrument : APP_DEFAULTS.instrument,
      beatsPerChord: BEATS_OPTIONS.includes(s.beatsPerChord) ? s.beatsPerChord : APP_DEFAULTS.beatsPerChord,
    }
  } catch {
    return null
  }
}

export function SettingsPanel() {
  const { setBpm, setVolume, chooseInstrument, setBeatsPerChord } = useStore()

  const [open, setOpen]   = useState(false)
  const [draft, setDraft] = useState<AppSettings>(APP_DEFAULTS)
  const [bpmText, setBpmText] = useState(String(APP_DEFAULTS.bpm))

  function applyToStore(s: AppSettings) {
    setBpm(s.bpm)
    setVolume(s.volume)
    // A saved default is an explicit choice — moods won't override it.
    chooseInstrument(s.instrument)
    setBeatsPerChord(s.beatsPerChord)
  }

  // Apply persisted defaults once on startup.
  useEffect(() => {
    const stored = readSettings()
    if (stored) applyToStore(stored)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function openPanel() {
    const s = readSettings() ?? APP_DEFAULTS
    setDraft(s)
    setBpmText(String(s.bpm))
    setOpen(true)
  }

  function handleSave() {
    const next = { ...draft, bpm: clampNum(bpmText, 40, 240, draft.bpm) }
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)) } catch { /* storage full */ }
    applyToStore(next)
    setOpen(false)
  }

  function handleReset() {
    try { localStorage.removeItem(SETTINGS_KEY) } catch { /* ignore */ }
    setDraft(APP_DEFAULTS)
    setBpmText(String(APP_DEFAULTS.bpm))
    applyToStore(APP_DEFAULTS)
  }

  // Esc closes the modal.
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open])

  return (
    <>
      <button
        onClick={openPanel}
        title="Settings — default BPM, instrument, beats, volume"
        className="w-8 h-8 flex items-center justify-center rounded-lg border border-border bg-bg-raised text-text-muted hover:text-text hover:border-border-bright cursor-pointer transition-colors"
      >
        <Settings size={14} />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setOpen(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-[340px] rounded-2xl border border-border bg-bg-panel p-5 flex flex-col gap-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-text uppercase tracking-widest">Settings</h3>
              <button
                onClick={() => setOpen(false)}
                title="Close"
                className="text-text-dim hover:text-text cursor-pointer"
              >
                <X size={15} />
              </button>
            </div>
            <p className="text-[11px] text-text-dim leading-relaxed -mt-2">
              Defaults applied every time the app opens. Saving applies them now too.
            </p>

            {/* Default BPM */}
            <div className="flex items-center justify-between gap-3">
              <label className="text-xs text-text-muted font-semibold">Default BPM</label>
              <input
                type="text"
                inputMode="numeric"
                value={bpmText}
                onChange={e => setBpmText(e.target.value)}
                className="w-16 text-center bg-bg-raised border border-border rounded-lg text-sm font-mono text-text py-1.5 focus:outline-none focus:border-accent/60"
                aria-label="Default BPM (40–240)"
              />
            </div>

            {/* Default instrument */}
            <div className="flex items-center justify-between gap-3">
              <label className="text-xs text-text-muted font-semibold">Default instrument</label>
              <select
                value={draft.instrument}
                onChange={e => setDraft(d => ({ ...d, instrument: e.target.value as InstrumentName }))}
                className="bg-bg-raised border border-border rounded-lg text-sm text-text px-2 py-1.5 cursor-pointer focus:outline-none focus:border-accent/60"
              >
                {INSTRUMENTS.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>

            {/* Default beats per chord */}
            <div className="flex items-center justify-between gap-3">
              <label className="text-xs text-text-muted font-semibold">Default beats / chord</label>
              <div className="flex rounded-lg overflow-hidden border border-border">
                {BEATS_OPTIONS.map(b => (
                  <button
                    key={b}
                    onClick={() => setDraft(d => ({ ...d, beatsPerChord: b }))}
                    className={cn(
                      'w-9 h-7 text-xs font-mono font-semibold cursor-pointer transition-colors',
                      draft.beatsPerChord === b
                        ? 'bg-accent text-bg-deep'
                        : 'bg-bg-raised text-text-muted hover:text-text',
                    )}
                  >
                    {b}
                  </button>
                ))}
              </div>
            </div>

            {/* Default volume */}
            <div className="flex items-center justify-between gap-3">
              <label className="text-xs text-text-muted font-semibold">Default volume</label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={draft.volume}
                  onChange={e => setDraft(d => ({ ...d, volume: Number(e.target.value) }))}
                  className="w-24 cursor-pointer h-1"
                  style={{ accentColor: '#00e5a0' }}
                  aria-label="Default volume"
                />
                <span className="text-xs text-text-dim font-mono w-7 text-right">{draft.volume}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={handleSave}
                className="flex-1 py-2 rounded-xl bg-accent hover:bg-accent-hover text-bg-deep font-bold text-sm cursor-pointer transition-colors"
              >
                Save defaults
              </button>
              <button
                onClick={handleReset}
                title="Reset to app defaults (100 BPM, Piano, 2 beats, volume 80)"
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-text-muted hover:text-text text-xs cursor-pointer transition-colors"
              >
                <RotateCcw size={12} />
                Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
