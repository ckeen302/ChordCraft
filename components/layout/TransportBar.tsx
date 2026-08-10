'use client'

import { useState, useEffect, useRef } from 'react'
import { Play, Pause, Square, Music, Repeat, Timer, Loader2 } from 'lucide-react'
import { useStore } from '@/store/useStore'
import { useTransport } from '@/hooks/useTransport'
import { cn } from '@/lib/utils'
import type { InstrumentName } from '@/types'

const INSTRUMENTS: InstrumentName[] = [
  'Piano', 'Electric Piano', 'Pad', 'Synth Lead', 'Organ',
  'Guitar', 'Strings', 'Bass', 'Harp', 'Bell', 'Brass',
]

const BEATS_OPTIONS: (1 | 2 | 4)[] = [1, 2, 4]

// ─── BPM input (local string state so user can type freely) ─────────────────

function BpmControl({ bpm, setBpm }: { bpm: number; setBpm: (v: number) => void }) {
  const [localValue, setLocalValue] = useState(String(bpm))
  const lastValidRef = useRef(bpm)

  // Keep in sync when store changes externally (e.g. keyboard or slider)
  useEffect(() => {
    setLocalValue(String(bpm))
    lastValidRef.current = bpm
  }, [bpm])

  function commit(raw: string) {
    const n = parseInt(raw, 10)
    if (!isNaN(n) && n >= 40 && n <= 240) {
      lastValidRef.current = n
      setBpm(n)
      setLocalValue(String(n))
    } else {
      // Revert to last valid
      setLocalValue(String(lastValidRef.current))
    }
  }

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => { const v = Math.max(40, bpm - 5); setBpm(v); setLocalValue(String(v)) }}
        className="w-6 h-6 flex items-center justify-center rounded bg-bg-raised border border-border text-text-muted hover:text-text cursor-pointer text-sm leading-none"
        aria-label="Decrease BPM"
      >−</button>
      <input
        type="text"
        inputMode="numeric"
        value={localValue}
        onChange={e => setLocalValue(e.target.value)}
        onBlur={e => commit(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') commit((e.target as HTMLInputElement).value) }}
        className={cn(
          'w-12 text-center bg-bg-raised border border-border rounded-lg',
          'text-sm font-mono font-semibold text-text py-1',
          'focus:outline-none focus:border-accent/60',
        )}
        aria-label="BPM"
      />
      <button
        onClick={() => { const v = Math.min(240, bpm + 5); setBpm(v); setLocalValue(String(v)) }}
        className="w-6 h-6 flex items-center justify-center rounded bg-bg-raised border border-border text-text-muted hover:text-text cursor-pointer text-sm leading-none"
        aria-label="Increase BPM"
      >+</button>
    </div>
  )
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TransportBar() {
  const { play, pause, stop, isPlaying, isPaused } = useTransport()

  const {
    progression, source, currentChordIndex,
    bpm, setBpm,
    volume, setVolume,
    instrument, chooseInstrument,
    beatsPerChord, setBeatsPerChord,
    loopEnabled, setLoopEnabled,
    metronomeEnabled, setMetronomeEnabled,
    audioLoading,
  } = useStore()

  const currentChord = currentChordIndex >= 0 ? progression[currentChordIndex] : null
  const hasProgression = progression.length > 0

  // Derived play/pause button state
  const playLabel  = audioLoading ? 'Loading instrument…' : isPlaying ? 'Pause' : (isPaused ? 'Resume' : 'Play')
  const PlayIcon   = audioLoading ? Loader2 : isPlaying ? Pause : Play
  const shortcut   = isPlaying ? '' : isPaused ? '' : ' (Space)'

  function handlePlayPause() {
    if (isPlaying) pause()
    else play()
  }

  return (
    <footer className="flex-shrink-0 bg-bg-panel border-t border-border">
      {/* BPM slider — full width strip with live value centred above it */}
      <div className="px-6 pt-2 pb-0">
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-text-dim font-mono w-6 text-right">40</span>
          <div className="relative flex-1">
            {/* Live BPM badge — floats above the slider thumb */}
            <div
              className="absolute -top-5 pointer-events-none"
              style={{
                left: `calc(${((bpm - 40) / (240 - 40)) * 100}% - 16px)`,
              }}
            >
              <span className="text-[11px] font-mono font-bold text-accent bg-bg-raised border border-accent/30 rounded px-1 py-0.5 leading-none whitespace-nowrap">
                {bpm}
              </span>
            </div>
            <input
              type="range"
              min={40}
              max={240}
              value={bpm}
              onChange={e => setBpm(Number(e.target.value))}
              className="w-full h-1 cursor-pointer"
              style={{ accentColor: '#00e5a0' }}
              aria-label="BPM slider"
            />
          </div>
          <span className="text-[10px] text-text-dim font-mono w-6">240</span>
        </div>
      </div>

      {/* Main transport row — wraps on narrow windows instead of clipping */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 min-h-[76px]">

        {/* ── Playback controls ─────────────────────────────────────────── */}
        <div className="flex items-center gap-2">
          {/* Play / Pause */}
          <button
            onClick={handlePlayPause}
            disabled={!hasProgression}
            title={`${playLabel}${shortcut}`}
            className={cn(
              'w-11 h-11 rounded-full flex items-center justify-center transition-all cursor-pointer',
              !hasProgression
                ? 'bg-bg-raised text-text-dim cursor-not-allowed'
                : isPlaying
                  ? 'bg-accent/90 hover:bg-accent text-bg-deep shadow-glow-sm'
                  : isPaused
                    ? 'bg-accent/40 hover:bg-accent text-bg-deep border border-accent/60'
                    : 'bg-accent hover:bg-accent-hover text-bg-deep',
            )}
          >
            <PlayIcon
              size={16}
              fill={audioLoading ? 'none' : 'currentColor'}
              className={audioLoading ? 'animate-spin' : isPlaying ? '' : 'translate-x-0.5'}
            />
          </button>

          {/* Stop */}
          <button
            onClick={stop}
            disabled={!isPlaying && !isPaused}
            title="Stop"
            className={cn(
              'w-9 h-9 rounded-full flex items-center justify-center transition-all cursor-pointer',
              !isPlaying && !isPaused
                ? 'bg-bg-raised text-text-dim cursor-not-allowed'
                : 'bg-bg-raised border border-border text-text hover:border-accent/60 hover:text-accent',
            )}
          >
            <Square size={13} fill="currentColor" />
          </button>
        </div>

        {/* ── Now playing ───────────────────────────────────────────────── */}
        <div className="w-44 lg:w-52 min-w-0">
          <p className="text-sm font-semibold text-text truncate leading-tight">
            {source || 'Nothing loaded'}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-xs text-text-muted font-mono truncate">
              {currentChord
                ? <span className="text-accent font-bold">{currentChord.symbol}</span>
                : progression.length > 0
                  ? <span>{progression.map(c => c.symbol).join(' · ')}</span>
                  : <span className="italic">—</span>}
            </p>
            {progression.length > 0 && currentChordIndex >= 0 && (
              <span className="text-[10px] text-text-dim font-mono flex-shrink-0">
                {currentChordIndex + 1}/{progression.length}
              </span>
            )}
          </div>
        </div>

        <div className="flex-1" />

        {/* ── Loop & Metronome toggles ───────────────────────────────────── */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setLoopEnabled(!loopEnabled)}
            title={loopEnabled ? 'Loop on (click to disable)' : 'Loop off (click to enable)'}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium cursor-pointer transition-colors',
              loopEnabled
                ? 'bg-accent/15 border-accent/40 text-accent'
                : 'bg-bg-raised border-border text-text-muted hover:text-text',
            )}
          >
            <Repeat size={12} />
            Loop
          </button>

          <button
            onClick={() => setMetronomeEnabled(!metronomeEnabled)}
            title={`Metronome ${metronomeEnabled ? 'on' : 'off'} (M)`}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium cursor-pointer transition-colors',
              metronomeEnabled
                ? 'bg-accent/15 border-accent/40 text-accent'
                : 'bg-bg-raised border-border text-text-muted hover:text-text',
            )}
          >
            <Timer size={12} />
            Click
          </button>
        </div>

        {/* ── Beats per chord ───────────────────────────────────────────── */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-text-muted">Beats</span>
          <div className="flex rounded-lg overflow-hidden border border-border">
            {BEATS_OPTIONS.map(b => (
              <button
                key={b}
                onClick={() => setBeatsPerChord(b)}
                className={cn(
                  'w-8 h-7 text-xs font-mono font-semibold cursor-pointer transition-colors',
                  beatsPerChord === b
                    ? 'bg-accent text-bg-deep'
                    : 'bg-bg-raised text-text-muted hover:text-text',
                )}
              >
                {b}
              </button>
            ))}
          </div>
        </div>

        {/* ── Instrument ────────────────────────────────────────────────── */}
        <div className="flex items-center gap-1.5">
          <Music size={12} className="text-text-muted flex-shrink-0" />
          <select
            value={instrument}
            // Blur after choosing so Space returns to play/pause instead of
            // reopening the dropdown; choose* marks the pick as the user's.
            onChange={e => { chooseInstrument(e.target.value as InstrumentName); e.target.blur() }}
            className={cn(
              'bg-bg-raised border border-border rounded-lg',
              'text-sm text-text px-2 py-1.5 cursor-pointer',
              'focus:outline-none focus:border-accent/60',
            )}
          >
            {INSTRUMENTS.map(i => <option key={i} value={i}>{i}</option>)}
          </select>
        </div>

        {/* ── BPM ───────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-text-muted">BPM</span>
          <BpmControl bpm={bpm} setBpm={setBpm} />
        </div>

        {/* ── Volume ────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-text-muted">Vol</span>
          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            onChange={e => setVolume(Number(e.target.value))}
            className="w-20 cursor-pointer h-1"
            style={{ accentColor: '#00e5a0' }}
            aria-label="Volume"
          />
          <span className="text-xs text-text-dim font-mono w-7 text-right">{volume}</span>
        </div>
      </div>
    </footer>
  )
}
