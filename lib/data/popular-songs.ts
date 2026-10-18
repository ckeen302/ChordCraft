/**
 * Popular-song chord progressions, generated from the songs database.
 *
 * The data lives in backend/db/songs.sqlite and is exported to
 * popular-songs.json (`python -m chordcraft.songs export`). Each progression is
 * converted chord-for-chord from a Hooktheory TheoryTab analysis of the
 * recording, with its real key, tempo, meter and per-chord durations. The
 * tempo is cross-checked against songbpm.com, and the key too where songbpm
 * lists one. Where TheoryTab and songbpm disagree on tempo, a Songsterr tab's
 * tempo map settles it (`tempoSourceUrl`). The chords themselves are confirmed
 * against the notes of a Songsterr transcription (`chordCheckUrl`): every chord
 * of a beat or longer has to fit the notes the tab's rhythm, bass and keys
 * tracks play under it, changing where TheoryTab says it does. The release
 * year is given only when two of MusicBrainz, Wikidata and the original
 * candidate list agree on it (`yearSourceUrl`); otherwise it's null. Every
 * URL lets anyone check an entry.
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
  /** Original release year, or null when the sources don't agree on one. */
  year: number | null
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
  /**
   * songbpm.com page and tempo. It agrees with `bpm` (allowing half/double time)
   * unless `tempoSourceUrl` is set.
   */
  tempoCheckUrl: string
  tempoCheckBpm: number
  /**
   * Set when TheoryTab and songbpm disagreed: the Songsterr tab whose tempo map
   * confirms `bpm`, and the tab's tempo there. `bpm` then agrees with this and
   * with TheoryTab or songbpm.
   */
  tempoSourceUrl?: string
  tempoSourceBpm?: number
  /**
   * songbpm.com's key (Spotify's automatic estimate, often a fifth off): the same
   * key, the relative major/minor, a different key, or not listed.
   */
  keyCheck: 'exact' | 'relative' | 'differs' | 'unavailable'
  /** Songsterr tab whose notes confirm the chords, beat for beat. */
  chordCheckUrl: string
  /** 'same': confirmed in the tab's key; 'transposed': the tab is in another key (songbpm then confirms ours). */
  chordCheckKey: 'same' | 'transposed'
  /** MusicBrainz recording or Wikidata item the year comes from. */
  yearSourceUrl?: string
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
