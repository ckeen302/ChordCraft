'use client'

/**
 * PopularSongs
 *
 * Chord progressions from famous songs, converted from Hooktheory TheoryTab
 * analyses (tempo cross-checked on songbpm.com). Loading a song sets the
 * transport to the song's real BPM and per-chord harmonic rhythm, so it plays
 * like the record, and the MIDI download matches beat-for-beat.
 */
import { useState } from 'react'
import { Search, Download, Play, Clock, KeyRound, CheckCircle2, Disc3, ExternalLink } from 'lucide-react'
import { PianoRoll } from '@/components/piano/PianoRoll'
import { useStore } from '@/store/useStore'
import { POPULAR_SONGS, pulsesPerBar, songToParsedChords, type PopularSong } from '@/lib/data/popular-songs'
import { downloadMidi, GM_PROGRAM } from '@/lib/midi/export'
import { setChordRoll } from '@/lib/audio/engine'
import { cn } from '@/lib/utils'

const MODE_LABEL: Record<string, string> = {
  dorian: 'Dorian', phrygian: 'Phrygian', lydian: 'Lydian', mixolydian: 'Mixolydian',
  locrian: 'Locrian', harmonicMinor: 'Harmonic minor', phrygianDominant: 'Phrygian dominant',
}

/** How another source's tempo reading relates to ours when it counts a different pulse. */
function pulseNote(song: PopularSong, check: number): string {
  const r = check / song.bpm
  if (Math.abs(r - 1) <= 0.04) return ''
  if (Math.abs(r - 2) <= 0.08) return ', counted in double time'
  if (Math.abs(r - 0.5) <= 0.02) return ', counted in half time'
  return OTHER_PULSE
}

const OTHER_PULSE = ', counted in a different pulse'

/** "D Mixolydian" for modal songs, otherwise the plain key. */
function keyLabel(song: PopularSong): string {
  const mode = MODE_LABEL[song.mode]
  return mode ? `${song.key.split(' ')[0]} ${mode}` : song.key
}

export function PopularSongs() {
  const { loadProgression, setBpm, setBeatsPerBar, source, instrument } = useStore()
  const [query, setQuery]       = useState('')
  const [selected, setSelected] = useState<PopularSong | null>(null)

  const q = query.trim().toLowerCase()
  const songs = q
    ? POPULAR_SONGS.filter(s =>
        s.title.toLowerCase().includes(q) ||
        s.artist.toLowerCase().includes(q) ||
        s.key.toLowerCase().includes(q))
    : POPULAR_SONGS

  const selectedChords = selected ? songToParsedChords(selected) : []
  const songbpmNote = selected ? pulseNote(selected, selected.tempoCheckBpm) : ''
  // Only overridden songs can disagree with songbpm; the rest passed its check at ingest.
  const songbpmDiffers = !!selected?.tempoSourceUrl && songbpmNote === OTHER_PULSE
  const isLoaded = (song: PopularSong) => source === `${song.title} — ${song.artist}`

  function loadSong(song: PopularSong) {
    setSelected(song)
    const chords = songToParsedChords(song)
    if (!chords.length) return
    loadProgression(chords, `${song.title} — ${song.artist}`)
    setBpm(song.bpm)   // play at the record's tempo
    setBeatsPerBar(pulsesPerBar(song.timeSignature))   // metronome accents follow the meter
    setChordRoll(20)   // natural light strum for song playback
  }

  async function exportSong(song: PopularSong) {
    const chords = songToParsedChords(song)
    if (!chords.length) return
    await downloadMidi(
      chords,
      song.bpm,
      `${song.title} - ${song.artist}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      4,
      GM_PROGRAM[instrument],
      song.timeSignature,
    )
  }

  return (
    <div className="flex h-full min-h-0">

      {/* ── Left: song list ─────────────────────────────────────────────── */}
      <div className="w-96 flex-shrink-0 flex flex-col border-r border-border bg-bg-panel">
        <div className="p-5 pb-3">
          <h2 className="text-lg font-extrabold text-text">Popular Songs</h2>
          <p className="text-text-muted text-xs mt-0.5 leading-relaxed">
            {POPULAR_SONGS.length} progressions from Hooktheory TheoryTab, with real key, tempo and rhythm.
          </p>
          <div className="relative mt-3">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim pointer-events-none" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search title, artist, key…"
              className={cn(
                'w-full bg-bg-raised border border-border rounded-xl',
                'text-sm text-text pl-9 pr-3 py-2',
                'focus:outline-none focus:border-accent/50 placeholder:text-text-dim',
              )}
            />
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-4 flex flex-col gap-1.5">
          {songs.map(song => {
            const active = selected?.id === song.id
            return (
              <button
                key={song.id}
                onClick={() => loadSong(song)}
                className={cn(
                  'flex flex-col gap-1 px-3.5 py-2.5 rounded-xl border text-left cursor-pointer transition-colors',
                  active
                    ? 'bg-accent/10 border-accent/40'
                    : 'bg-bg-raised/40 border-border hover:border-border-bright hover:bg-bg-raised',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={cn('text-sm font-bold truncate', active ? 'text-accent' : 'text-text')}>
                    {song.title}
                  </span>
                  <span className="text-[10px] text-text-dim font-mono flex-shrink-0">{song.year}</span>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-text-muted">
                  <span className="truncate">{song.artist}</span>
                  <span className="ml-auto flex items-center gap-1 flex-shrink-0 font-mono text-[10px]">
                    <KeyRound size={9} className="text-text-dim" />{keyLabel(song)}
                  </span>
                  <span className="flex items-center gap-1 flex-shrink-0 font-mono text-[10px]">
                    <Clock size={9} className="text-text-dim" />{song.bpm}
                  </span>
                </div>
                <span className="text-[10px] font-mono text-text-dim truncate">
                  {song.chords.map(c => c.symbol).join(' · ')}
                </span>
              </button>
            )
          })}
          {!songs.length && (
            <p className="text-text-dim text-xs italic text-center py-8">No songs match “{query}”.</p>
          )}
        </div>
      </div>

      {/* ── Right: selected song detail ─────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto p-6 gap-6">
        {selected ? (
          <>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h3 className="text-2xl font-extrabold text-text leading-tight">{selected.title}</h3>
                <p className="text-text-muted text-sm mt-0.5">
                  {selected.artist} · {selected.year}
                </p>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <span className="px-2 py-0.5 rounded-full bg-bg-raised border border-border text-[11px] font-mono text-text-muted">
                    {keyLabel(selected)}
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-bg-raised border border-border text-[11px] font-mono text-text-muted">
                    {selected.bpm} BPM
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-bg-raised border border-border text-[11px] font-mono text-text-muted">
                    {selected.timeSignature}
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-accent/10 border border-accent/25 text-[11px] text-accent">
                    {selected.section}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {isLoaded(selected) ? (
                  <span className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-accent/10 border border-accent/25 text-accent text-xs font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse inline-block" />
                    Loaded — hit Space
                  </span>
                ) : (
                  <button
                    onClick={() => loadSong(selected)}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-bg-deep font-semibold text-sm hover:bg-accent-hover cursor-pointer transition-colors"
                  >
                    <Play size={13} />
                    Load
                  </button>
                )}
                <button
                  onClick={() => exportSong(selected)}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border text-text-muted hover:text-text hover:border-border-bright text-sm cursor-pointer transition-colors"
                >
                  <Download size={13} />
                  Download MIDI
                </button>
              </div>
            </div>

            {/* MIDI roll — sized by the song's real harmonic rhythm */}
            <div>
              <p className="text-[10px] uppercase tracking-[2px] text-text-muted font-semibold mb-3">
                {selected.section} — one cycle, column width = chord duration
              </p>
              <PianoRoll chords={selectedChords} />
            </div>

            {/* Chord/rhythm table */}
            <div>
              <p className="text-[10px] uppercase tracking-[2px] text-text-muted font-semibold mb-3">
                Chords &amp; Rhythm
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {selected.chords.map((c, i) => (
                  <div key={i} className="flex flex-col gap-0.5 p-3 rounded-xl bg-bg-raised border border-border">
                    <span className="text-xs text-text-dim font-mono">#{i + 1}</span>
                    <span className="text-lg font-extrabold text-text leading-none">{c.symbol}</span>
                    <span className="text-[11px] text-text-muted">{c.beats} beats</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5 text-[11px] text-text-dim">
              <p className="flex items-center gap-1.5">
                <CheckCircle2 size={12} className="text-accent flex-shrink-0" />
                Chords, rhythm, key and tempo from the
                <a href={selected.sourceUrl} target="_blank" rel="noopener noreferrer"
                   className="inline-flex items-center gap-1 text-accent hover:underline">
                  Hooktheory TheoryTab analysis <ExternalLink size={10} />
                </a>
              </p>
              {selected.tempoSourceUrl && (
                <p className="flex items-center gap-1.5">
                  <CheckCircle2 size={12} className="text-accent flex-shrink-0" />
                  Tempo settled by the
                  <a href={selected.tempoSourceUrl} target="_blank" rel="noopener noreferrer"
                     className="inline-flex items-center gap-1 text-accent hover:underline">
                    Songsterr tab ({selected.tempoSourceBpm} BPM{pulseNote(selected, selected.tempoSourceBpm!)})
                    <ExternalLink size={10} />
                  </a>
                </p>
              )}
              <p className="flex items-center gap-1.5">
                <CheckCircle2 size={12} className="text-accent flex-shrink-0" />
                {songbpmDiffers ? 'Tempo differs from' : 'Tempo confirmed by'}
                <a href={selected.tempoCheckUrl} target="_blank" rel="noopener noreferrer"
                   className="inline-flex items-center gap-1 text-accent hover:underline">
                  songbpm.com ({selected.tempoCheckBpm} BPM{songbpmDiffers ? '' : songbpmNote})
                  <ExternalLink size={10} />
                </a>
                {selected.keyCheck === 'exact' && <span>· same key</span>}
                {selected.keyCheck === 'relative' && <span>· relative key</span>}
              </p>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center">
            <Disc3 size={24} className="text-text-dim" />
            <p className="text-text-muted text-sm">Pick a song</p>
            <p className="text-text-dim text-xs max-w-xs">
              Loads at the record&apos;s real key, tempo, and chord rhythm — then play it,
              tweak it on the roll, or download the MIDI.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
