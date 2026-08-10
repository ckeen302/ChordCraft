/**
 * Voice leading — the difference between a chord chart and a performance.
 *
 * parseChord() builds every chord in root position around middle C, so raw
 * progressions leap around (G up to F, down to Am…). Real players connect
 * chords with minimal motion: common tones stay put, the other voices move
 * to their nearest chord tone. This module re-voices a progression that way:
 *
 *  - The bass anchor (notes[0] — the root, or the slash bass) is preserved,
 *    so the audio engine's sub-octave doubling and the Bass instrument keep
 *    working, and the harmonic identity is untouched.
 *  - Upper voices are placed in the octave nearest the previous chord's
 *    voices (classic keyboard-style comping: steady left hand, smooth right).
 *  - Dense extensions (9ths) drop the 5th from the upper structure — the
 *    standard jazz voicing trade.
 */
import type { ParsedChord } from '@/types'

const UPPER_LO = 60   // C4 — lowest allowed upper voice
const UPPER_HI = 83   // B5 — highest allowed upper voice

/** Place pitch class `pc` in the octave whose midi value is closest to `target`. */
function nearestOctave(pc: number, target: number): number {
  let best = -1
  let bestD = Infinity
  for (let n = UPPER_LO + ((pc - UPPER_LO) % 12 + 12) % 12; n <= UPPER_HI; n += 12) {
    const d = Math.abs(n - target)
    if (d < bestD) { bestD = d; best = n }
  }
  return best
}

/**
 * Re-voice a progression with smooth voice leading. Pure: returns new chords,
 * carrying over every other field (symbol, quality, beats…).
 */
export function voiceLeadProgression(chords: ParsedChord[]): ParsedChord[] {
  let prevUpper: number[] | null = null

  return chords.map(ch => {
    if (ch.notes.length < 2) return ch   // rests / single notes stay put

    const bass = ch.notes[0]
    const bassPc = bass % 12
    let pcs = [...new Set(ch.notes.slice(1).map(n => n % 12))]

    // 9th-chord upper structures: drop the 5th (root+7), keep 3-7-9 colour.
    if (pcs.length > 3) {
      const fifth = (bassPc + 7) % 12
      const trimmed = pcs.filter(pc => pc !== fifth)
      if (trimmed.length >= 3) pcs = trimmed
    }

    let upper: number[]
    if (!prevUpper) {
      // First chord: close position directly above the bass anchor.
      upper = pcs
        .map(pc => {
          let n = bass + (((pc - bassPc) % 12) + 12) % 12
          if (n <= bass) n += 12
          return n
        })
        .sort((a, b) => a - b)
    } else {
      const prev = prevUpper
      const used = new Set<number>()
      upper = pcs
        .map(pc => {
          // Move each voice to its nearest previous position…
          const target = prev.reduce(
            (best, p) => {
              const cand = nearestOctave(pc, p)
              const d = Math.abs(cand - p)
              return d < best.d ? { n: cand, d } : best
            },
            { n: nearestOctave(pc, prev[0]), d: Infinity },
          ).n
          return target
        })
        .map(n => {
          // …resolving collisions upward, then downward.
          let v = n
          while (used.has(v) && v + 12 <= UPPER_HI) v += 12
          while (used.has(v) && v - 12 >= UPPER_LO) v -= 12
          used.add(v)
          return v
        })
        .sort((a, b) => a - b)
    }

    prevUpper = upper
    return { ...ch, notes: [bass, ...upper] }
  })
}
