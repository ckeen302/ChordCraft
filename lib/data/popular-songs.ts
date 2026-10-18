/**
 * Popular-song chord progressions, generated from the songs database.
 *
 * The data lives in backend/db/songs.sqlite and is exported to
 * popular-songs.json (`python -m chordcraft.songs export`). Each progression is
 * converted chord-for-chord from a Hooktheory TheoryTab analysis of the
 * recording, with its real key, tempo, meter and per-chord durations. The
 * tempo is cross-checked against songbpm.com, and the key too where songbpm
 * lists one. `sourceUrl` and `tempoCheckUrl` let anyone check an entry.
 *
 * `beats` counts the meter's pulse: quarter notes in x/4, dotted quarters in
 * x/8. Playback and MIDI export follow those durations at `bpm`.
 */
import { parseChord } from '@/lib/theory/chords'
import { voiceLeadProgression } from '@/lib/theory/voicing'
import type { ParsedChord } from '@/types'
import songs from './popular-songs.json'

export interface SongChord {
  symbol: string
  beats: number
}

export interface PopularSong {
  id: string
  title: string
  artist: string
  year: number
  /** One of the app's 24 keys: the tonic, plus Major or Minor by the mode's brightness. */
  key: string
  /** TheoryTab's scale for the section: major, minor, dorian, mixolydian, ... */
  mode: string
  bpm: number
  timeSignature: string
  section: string
  /** The Hooktheory TheoryTab page the chords, rhythm, key and tempo come from. */
  sourceUrl: string
  youtubeId: string | null
  /** songbpm.com page whose tempo agrees with `bpm` (allowing half/double time). */
  tempoCheckUrl: string
  tempoCheckBpm: number
  /**
   * songbpm.com's key (Spotify's automatic estimate, often a fifth off): the same
   * key, the relative major/minor, a different key, or not listed.
   */
  keyCheck: 'exact' | 'relative' | 'differs' | 'unavailable'
  chords: SongChord[]
}

export const POPULAR_SONGS = songs as PopularSong[]

/** Metronome pulses per bar: n in n/4, n/3 dotted-quarter pulses in n/8. */
export function pulsesPerBar(timeSignature: string): number {
  const [n, d] = timeSignature.split('/').map(Number)
  return d === 8 && n % 3 === 0 ? n / 3 : n
}

/** Parse a song's chords into playable ParsedChords carrying real durations. */
export function songToParsedChords(song: PopularSong): ParsedChord[] {
  const parsed = song.chords.flatMap(({ symbol, beats }) => {
    try {
      return [{ ...parseChord(symbol), beats }]
    } catch {
      return []
    }
  })
  // Smooth voice leading — the same harmony, connected like played hands.
  return voiceLeadProgression(parsed)
}
