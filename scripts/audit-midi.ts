/**
 * MIDI accuracy audit: export each sampled song exactly as the "Download MIDI" button does,
 * read the file back, and compare it chord by chord with TheoryTab's raw section data
 * (pitch classes, onsets, durations, tempo) produced by the backend's audit dump.
 *
 *   (cd backend && uv run python scripts/audit_expected.py 685 ../expected.json)
 *   npx tsx scripts/audit-midi.ts expected.json
 */
import { readFileSync } from 'node:fs'
import { Midi } from '@tonejs/midi'
import { POPULAR_SONGS, songToParsedChords } from '../lib/data/popular-songs'
import { buildMidiBytes } from '../lib/midi/export'

interface RawChord { pcs: number[]; inv: number; start: number; beats: number }
interface Expected { id: string; title: string; artist: string; section: string; rawBpm: number; unit: number; raw: RawChord[] }

async function main() {
const expected: Expected[] = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const byId = new Map(POPULAR_SONGS.map(s => [s.id, s]))
let clean = 0
for (const e of expected) {
  const song = byId.get(e.id)!
  const midi = new Midi(await buildMidiBytes(songToParsedChords(song), song.bpm, 4, 0, song.timeSignature))
  const notes = midi.tracks[0].notes
  const onsets = [...new Set(notes.map(n => n.ticks))].sort((a, b) => a - b)
  const [num, den] = song.timeSignature.split('/').map(Number)
  const qpb = den === 8 && num % 3 === 0 ? 1.5 : 1
  const ppq = midi.header.ppq
  const problems: string[] = []

  // The published chords are a contiguous stretch of TheoryTab's section: find where.
  const n = song.chords.length
  const pcsAt = (tick: number) => [...new Set(notes.filter(x => x.ticks === tick).map(x => x.midi % 12))].sort((a, b) => a - b)
  // Where each stored chord starts, in beats from the first: must equal TheoryTab's own positions.
  const starts = song.chords.map((_, i) => song.chords.slice(0, i).reduce((t, c) => t + c.beats, 0))
  const lengthsFit = (j: number) => j + n <= e.raw.length &&
    starts.every((b, i) => Math.abs(b - (e.raw[j + i].start - e.raw[j].start)) < 1e-3)
  const notesFit = (j: number) => onsets.every((tick, i) => JSON.stringify(pcsAt(tick)) === JSON.stringify(e.raw[j + i]?.pcs))
  // Prefer the stretch where lengths and notes both agree; fall back to lengths alone (and report).
  let at = e.raw.findIndex((_, j) => lengthsFit(j) && notesFit(j))
  if (at < 0) at = e.raw.findIndex((_, j) => lengthsFit(j))
  if (at < 0) problems.push('rhythm: no stretch of the TheoryTab section has chords starting where these do')
  else {
    const t0 = e.raw[at].start
    onsets.forEach((tick, i) => {
      const r = e.raw[at + i]
      const pcs = pcsAt(tick)
      if (JSON.stringify(pcs) !== JSON.stringify(r.pcs)) problems.push(`chord ${i + 1} (${song.chords[i].symbol}): MIDI plays ${pcs}, TheoryTab ${r.pcs}`)
      const want = (r.start - t0) * qpb * ppq
      if (Math.abs(tick - want) > 1) problems.push(`chord ${i + 1}: starts at tick ${tick}, TheoryTab ${want}`)
    })
    if (onsets.length !== n) problems.push(`${onsets.length} chords in the MIDI, ${n} stored`)
  }
  const ballad = e.unit === 3 && song.timeSignature.endsWith('/8') && Math.abs(song.bpm - e.rawBpm / 3) < 0.1
  const tempoOk = Math.abs(60e6 / midi.header.tempos[0].bpm - 60e6 / (song.bpm * qpb)) <= 1  // MIDI: whole µs per quarter
  const sameAsTheoryTab = Math.abs(song.bpm - e.rawBpm) < 1e-6 || ballad
  if (!tempoOk) problems.push(`tempo: file ${midi.header.tempos[0].bpm}, stored ${song.bpm}`)
  const tempoNote = sameAsTheoryTab ? (ballad ? `TheoryTab ${e.rawBpm} in eighths = ${song.bpm} dotted-quarter` : 'same as TheoryTab')
    : `override ${song.bpm} vs TheoryTab ${e.rawBpm}${song.tempoSourceUrl ? ' (Songsterr-confirmed)' : ' (UNEXPLAINED)'}`
  if (!sameAsTheoryTab && !song.tempoSourceUrl) problems.push('tempo differs from TheoryTab without an override')
  if (!problems.length) clean++
  console.log(`${problems.length ? '✗' : '✓'} ${song.title} — ${song.artist} (${song.year ?? 'year unknown'}) · ${song.section} · ${n} chords · ${song.bpm} BPM ${song.timeSignature} · tempo ${tempoNote}` +
    (at > 0 ? ` · chords ${at + 1}-${at + n} of the section` : ''))
  problems.forEach(p => console.log(`    ${p}`))
}
console.log(`\n${clean}/${expected.length} songs match TheoryTab note for note`)
}

main()
