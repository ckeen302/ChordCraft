import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, detectKey, parseRequest } from './parse'

describe('detectKey', () => {
  it.each([
    ['something in A minor', 'A Minor'],
    ['key of F#', 'F# Major'],
    ['Bb major ballad', 'Bb Major'],
    ['give me Am vibes', 'A Minor'],
    ['in G please', 'G Major'],
    ['c# minor', 'C# Minor'],
    ['D flat minor', 'C# Minor'],
    ['Eb', 'Eb Major'],
  ])('%s → %s', (text, key) => expect(detectKey(text)).toBe(key))

  it('ignores letters that are just words', () => {
    expect(detectKey('give me a sad song')).toBeNull()
    expect(detectKey('make a chill beat in a sec')).toBeNull()
    expect(detectKey('be dramatic')).toBeNull()
  })
})

describe('parseRequest', () => {
  it('reads a full description', () => {
    const r = parseRequest('sad lofi progression in A minor, 8 chords, slow, on rhodes')
    expect(r.settings).toMatchObject({ key: 'A Minor', keyPinned: true, length: 8, instrument: 'Electric Piano', bpm: 68 })
    expect(['melancholic', 'dreamy']).toContain(r.settings.mood)
    expect(r.keepChords).toBe(false)
    expect(r.unknown).toBe(false)
  })

  it.each([
    ['happy summer song', 'uplifting'],
    ['dark spooky horror vibe', 'tense'],
    ['epic movie trailer chords', 'epic'],
    ['angry metal riff chords', 'aggressive'],
    ['smooth jazz', 'jazz'],
    ['romantic r&b', 'romantic'],
    ['retro doo-wop', 'nostalgic'],
    ['dreamy ambient', 'dreamy'],
  ])('mood: %s → %s', (text, mood) => expect(parseRequest(text).settings.mood).toBe(mood))

  it('earliest mood word wins', () => {
    expect(parseRequest('sad but hopeful').settings.mood).toBe('melancholic')
  })

  it('applies style presets', () => {
    expect(parseRequest('trap beat').settings).toMatchObject({ mood: 'tense', bpm: 140, instrument: 'Bell' })
    expect(parseRequest('punk song').settings).toMatchObject({ mood: 'aggressive', bpm: 170 })
  })

  it('refines the previous request', () => {
    const first = parseRequest('happy pop in D major, 4 chords').settings
    expect(parseRequest('make it darker', first).settings.mood).toBe('tense')
    expect(parseRequest('jazzier', first).settings).toMatchObject({ mood: 'jazz', key: 'D Major' })
    expect(parseRequest('longer', first).settings.length).toBe(8)
    expect(parseRequest('another one', first).keepChords).toBe(false)
  })

  it('tempo and instrument changes keep the chords', () => {
    const prev = { ...DEFAULT_SETTINGS, bpm: 100 }
    const faster = parseRequest('faster', prev)
    expect(faster.settings.bpm).toBe(125)
    expect(faster.keepChords).toBe(true)
    expect(parseRequest('120 bpm', prev).settings.bpm).toBe(120)
    expect(parseRequest('play it on strings', prev)).toMatchObject({ keepChords: true, settings: { instrument: 'Strings' } })
  })

  it('transposes', () => {
    expect(parseRequest('up a semitone').transpose).toBe(1)
    expect(parseRequest('transpose down a whole step').transpose).toBe(-2)
    expect(parseRequest('up a step').transpose).toBe(2)
  })

  it('reads constraints', () => {
    expect(parseRequest('no diminished chords').settings.excludeDiminished).toBe(true)
    expect(parseRequest('make it resolve').settings.resolve).toBe(true)
    expect(parseRequest('twelve chords').settings.length).toBe(12)
    expect(parseRequest('40 chords').settings.length).toBe(16)
  })

  it('flags help and gibberish', () => {
    expect(parseRequest('help').help).toBe(true)
    expect(parseRequest('asdfgh qwerty').unknown).toBe(true)
  })
})

describe('review fixes', () => {
  it('tempo phrases and vague "up/down" are not transposes', () => {
    for (const t of ['slow it down a bit', 'speed it up a little', 'something with higher energy'])
      expect(parseRequest(t).transpose, t).toBeUndefined()
    expect(parseRequest('slow it down a bit', { ...DEFAULT_SETTINGS, bpm: 100 }).settings.bpm).toBe(80)
  })

  it('reads interval sizes', () => {
    expect(parseRequest('transpose up 3 semitones').transpose).toBe(3)
    expect(parseRequest('up an octave').transpose).toBe(12)
    expect(parseRequest('down two whole steps').transpose).toBe(-4)
    expect(parseRequest('transpose it down').transpose).toBe(-1)
  })

  it('casual words do not override the real mood', () => {
    expect(parseRequest("I'd love a sad song").settings.mood).toBe('melancholic')
    expect(parseRequest("I'd love something jazzy").settings.mood).toBe('jazz')
    expect(parseRequest('crystal clear pads').settings.mood).not.toBe('melancholic')
    expect(parseRequest('drill beat').settings.mood).toBe('tense')
    expect(parseRequest('a love song').settings.mood).toBe('romantic')
  })

  it('flags only the tempo and instrument the message set', () => {
    const plain = parseRequest('epic movie trailer', { ...DEFAULT_SETTINGS, bpm: 100, instrument: 'Piano' })
    expect(plain).toMatchObject({ tempoSet: false, instrumentSet: false })
    expect(parseRequest('faster', { ...DEFAULT_SETTINGS, bpm: 100 }).tempoSet).toBe(true)
    expect(parseRequest('on strings').instrumentSet).toBe(true)
    expect(parseRequest('trap beat')).toMatchObject({ tempoSet: true, instrumentSet: true })
  })
})
