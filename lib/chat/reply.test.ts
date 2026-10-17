import { expect, it } from 'vitest'
import { describeProgression } from './reply'
import { parseChords } from '@/lib/theory/chords'
import { analyzeProgression } from '@/lib/theory/analysis'

it('describes what was generated, including the cadence', () => {
  const chords = parseChords(['Am', 'F', 'C', 'G'])
  const a = analyzeProgression(chords, 'A Minor')
  const text = describeProgression({
    chords, romans: a.romans, key: 'A Minor', mood: 'melancholic', bpm: 68, instrument: 'Piano',
    summary: a.summary, keyFollowedMood: true, notes: ['lo-fi: laid back'],
  })
  expect(text).toContain('four-chord melancholic progression in A Minor at 68 BPM on piano')
  expect(text).toContain('Am – F – C – G (i – VI – III – VII)')
  expect(text).toContain('Ends away from home')
  expect(text).toContain('to suit the mood')
  expect(text).toContain('piano roll')
  const eight = describeProgression({
    chords: parseChords(['C', 'G', 'Am', 'F', 'C', 'G', 'F', 'C']), romans: [], key: 'C Major', mood: 'uplifting',
    bpm: 110, instrument: 'Guitar', summary: '', keyFollowedMood: false, notes: [],
  })
  expect(eight).toContain("Here's an eight-chord")
})
