/** Chat replies that describe what the generator just did. */
import type { InstrumentName, ParsedChord } from '@/types'
import { MOOD_LABELS, type Mood } from '@/lib/theory/harmony'

const NUMBER_NAMES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen']

export const HELP_TEXT =
  'Describe the progression you want and I\'ll write it into the piano roll. Try a mood or style ' +
  '("sad lo-fi", "epic trailer", "smooth jazz", "trap", "punk"), a key ("in F# minor"), a length ' +
  '("8 chords"), a tempo ("90 bpm", "slow") or an instrument ("on strings"). Then refine it: ' +
  '"darker", "jazzier", "longer", "faster", "up a step", "make it resolve", or "another one".'

export const UNKNOWN_TEXT =
  'I didn\'t catch a mood, style, key, or edit in that. Try "dreamy chords in Eb major" or ' +
  '"something angry and fast, 8 chords" — or type "help".'

export function describeProgression(args: {
  chords: ParsedChord[]
  romans: string[]
  key: string
  mood: Mood
  bpm: number
  instrument: InstrumentName
  summary: string
  keyFollowedMood: boolean
  notes: string[]
}): string {
  const { chords, romans, key, mood, bpm, instrument, summary, keyFollowedMood, notes } = args
  const n = NUMBER_NAMES[chords.length] ?? String(chords.length)
  const chordLine = chords.map(c => c.symbol).join(' – ')
  const romanLine = romans.filter(r => r !== '—').join(' – ')
  // The analysis summary's second sentence is the cadence ("Closes with…", "Ends on V…").
  const cadence = summary.split(/(?<=\.)\s+/)[1] ?? ''
  const style = notes.length ? ` (${notes.join('; ')})` : ''
  const keyNote = keyFollowedMood ? ` I put it in ${key} to suit the mood.` : ''
  const article = /^(eight|eleven|8|11|18)/.test(n) ? 'an' : 'a'
  return `Here's ${article} ${n}-chord ${MOOD_LABELS[mood].toLowerCase()} progression in ${key} at ${bpm} BPM on ` +
    `${instrument.toLowerCase()}${style}: ${chordLine}${romanLine ? ` (${romanLine})` : ''}. ${cadence}${keyNote} ` +
    'It\'s in the piano roll — press Space to play, or Export MIDI.'
}
