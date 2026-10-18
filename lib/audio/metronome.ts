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
let _timeoutId:   ReturnType<typeof setTimeout> | null = null
let _beatCounter  = 0
let _beatsPerBar  = 4

/**
 * Start the metronome at `bpm`, accenting beat 1 of each `beatsPerBar`-beat
 * bar (3 for 3/4 waltzes, 2/4 pulses for 6/8 and 12/8 songs).
 * Safe to call while already running (restarts).
 */
export function startMetronome(bpm: number, beatsPerBar = 4, phaseBeats = 0): void {
  stopMetronome()
  if (typeof window === 'undefined') return
  _beatsPerBar = Math.max(1, Math.round(beatsPerBar))

  // Ensure Tone is loaded + the AudioContext resumed (called from a user
  // gesture, so this is safe). Clicks stay silent until it's ready.
  warmUpAudio()

  const beatMs = 60_000 / Math.max(1, bpm)

  // Stay on the transport's beat grid: `phaseBeats` is where playback is now, so
  // the next click lands on the next whole beat (with the right bar accent)
  // instead of restarting the count on a tempo change or a mid-beat resume.
  const nextBeat = Math.ceil(phaseBeats - 1e-6)
  _beatCounter = nextBeat

  const tick = () => {
    const isAccent = (_beatCounter % _beatsPerBar) === 0
    playMetronomeClick(isAccent)
    _beatCounter++
  }
  const begin = () => {
    _timeoutId = null
    tick()
    _intervalId = setInterval(tick, beatMs)
  }

  const delayMs = (nextBeat - phaseBeats) * beatMs
  if (delayMs < 1) begin()
  else _timeoutId = setTimeout(begin, delayMs)
}

/** Stop the metronome. */
export function stopMetronome(): void {
  if (_intervalId !== null) {
    clearInterval(_intervalId)
    _intervalId = null
  }
  if (_timeoutId !== null) {
    clearTimeout(_timeoutId)
    _timeoutId = null
  }
  _beatCounter = 0
}

/** Returns true if the metronome is currently ticking. */
export function isMetronomeRunning(): boolean {
  return _intervalId !== null || _timeoutId !== null
}
