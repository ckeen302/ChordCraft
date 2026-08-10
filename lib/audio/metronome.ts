/**
 * Metronome module.
 *
 * Schedules beat clicks using setInterval (wall-clock accuracy is sufficient
 * for a practice tool at this precision). Beat 1 of each bar is accented.
 *
 * Uses `playMetronomeClick` from the engine so the AudioContext is shared.
 */
import { playMetronomeClick, warmUpAudio } from './engine'

let _intervalId:  ReturnType<typeof setInterval> | null = null
let _beatCounter  = 0
let _beatsPerBar  = 4

/**
 * Start the metronome at `bpm`, accenting beat 1 of each `beatsPerBar`-beat
 * bar (3 for 3/4 waltzes, 2/4 pulses for 6/8 and 12/8 songs).
 * Safe to call while already running (restarts).
 */
export function startMetronome(bpm: number, beatsPerBar = 4): void {
  stopMetronome()
  if (typeof window === 'undefined') return
  _beatsPerBar = Math.max(1, Math.round(beatsPerBar))

  // Ensure Tone is loaded + the AudioContext resumed (called from a user
  // gesture, so this is safe). Clicks stay silent until it's ready.
  warmUpAudio()

  _beatCounter = 0
  const beatMs = 60_000 / Math.max(1, bpm)

  const tick = () => {
    const isAccent = (_beatCounter % _beatsPerBar) === 0
    playMetronomeClick(isAccent)
    _beatCounter++
  }

  tick() // immediate first click
  _intervalId = setInterval(tick, beatMs)
}

/** Stop the metronome. */
export function stopMetronome(): void {
  if (_intervalId !== null) {
    clearInterval(_intervalId)
    _intervalId = null
  }
  _beatCounter = 0
}

/** Returns true if the metronome is currently ticking. */
export function isMetronomeRunning(): boolean {
  return _intervalId !== null
}
