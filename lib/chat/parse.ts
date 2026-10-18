/**
 * Plain-English requests → generation settings for the chord chat.
 *
 * Reads moods (and their everyday synonyms), styles/genres, keys, length,
 * tempo, instrument, and follow-up edits ("darker", "jazzier", "faster",
 * "up a step", "again"). Anything a message doesn't mention is carried over
 * from the previous request, so a conversation refines one progression.
 */
import type { InstrumentName } from '@/types'
import type { Mood } from '@/lib/theory/harmony'
import { KEY_NAMES } from '@/lib/theory/keys'
import { parallelKey, transposeKeyName } from '@/lib/theory/transpose'
import type { ArpSettings } from '@/lib/roll/arp'

export interface ChatSettings {
  key: string
  /** Whether the user named a key (then it wins over mood-matched keys). */
  keyPinned: boolean
  mood: Mood
  length: number
  bpm?: number
  instrument?: InstrumentName
  excludeDiminished: boolean
  /** Prefer a progression that ends on the tonic. */
  resolve: boolean
}

export interface ParsedRequest {
  settings: ChatSettings
  /** What changed, in words — used to explain the reply. */
  notes: string[]
  /** Transpose the current progression instead of generating a new one. */
  transpose?: number
  /** Only tempo/instrument changed — keep the chords. */
  keepChords: boolean
  /** The message itself set a tempo / an instrument (otherwise the generator picks). */
  tempoSet: boolean
  instrumentSet: boolean
  /** Turn the arpeggiator on/off or change its pattern ("arpeggiate it", "16th note arp", "block chords"). */
  arp?: { on: boolean; opts: Partial<ArpSettings> }
  /** Nothing recognisable: ask the user to rephrase. */
  unknown: boolean
  help: boolean
}

export const DEFAULT_SETTINGS: ChatSettings = {
  key: 'C Major', keyPinned: false, mood: 'uplifting', length: 4, excludeDiminished: false, resolve: false,
}

// When several moods are mentioned, the earliest in the message wins (see detectMood).
const MOOD_WORDS: [Mood, RegExp][] = [
  ['melancholic', /\b(sad|melanchol\w*|depress\w*|heartbr\w*|cry(?:ing|ies)?|lonely|blue|emotional|emo|somber|sombre|grief|bittersweet)\b/],
  ['uplifting', /\b(happy|uplift\w*|upbeat|joy\w*|bright|hopeful|cheer\w*|anthem\w*|euphori\w*|positive|feel ?good|summer\w*|triumphant)\b/],
  ['dreamy', /\b(dream\w*|chill|lo-?fi|ambient|floaty|float\w*|ethereal|spacey|spacy|hazy|relax\w*|calm|peaceful|airy)\b/],
  ['romantic', /\b(romanti\w*|love songs?|tender|sensual|r&b|rnb|neo[- ]?soul|soulful|intimate|wedding)\b/],
  ['nostalgic', /\b(nostalgi\w*|retro|vintage|oldies|doo-?wop|throwback|50s|60s|motown|old[- ]school)\b/],
  ['tense', /\b(tense|tension|dark|scary|spooky|creepy|horror|suspense\w*|ominous|eerie|sinister|villain\w*|mysterio\w*|noir)\b/],
  ['jazz', /\b(jazz\w*|bossa|swing|bebop|smooth|lounge|sophisticated|neo[- ]?jazz)\b/],
  ['epic', /\b(epic|cinematic|movie|film|trailer|heroic|orchestral|battle|adventure|grand|massive|game|soundtrack)\b/],
  ['aggressive', /\b(aggress\w*|angry|rage|metal|heavy|hard ?rock|punk|intense|brutal|mosh|evil|drill|phonk)\b/],
]

const STYLE_HINTS: [RegExp, Partial<ChatSettings> & { note: string }][] = [
  [/\blo-?fi\b/, { mood: 'dreamy', bpm: 78, instrument: 'Electric Piano', note: 'lo-fi: dreamy colours, laid-back tempo, electric piano' }],
  [/\b(trap|drill)\b/, { mood: 'tense', bpm: 140, instrument: 'Bell', note: 'trap: dark minor loop, 140 BPM, bell' }],
  [/\b(edm|house|dance|club)\b/, { mood: 'uplifting', bpm: 124, instrument: 'Synth Lead', note: 'dance: anthem changes, 124 BPM, synth lead' }],
  [/\b(gospel|church)\b/, { mood: 'romantic', instrument: 'Organ', note: 'gospel: rich extended chords on organ' }],
  [/\b(punk|pop[- ]?punk)\b/, { mood: 'aggressive', bpm: 170, instrument: 'Guitar', note: 'punk: power chords at 170 BPM' }],
  [/\bmetal\b/, { mood: 'aggressive', bpm: 150, instrument: 'Guitar', note: 'metal: power chords, minor, guitar' }],
  [/\b(ballad)\b/, { bpm: 66, instrument: 'Piano', note: 'ballad: slow piano' }],
  [/\b(country|folk|acoustic)\b/, { mood: 'uplifting', instrument: 'Guitar', note: 'acoustic: open guitar' }],
  [/\b(orchestral|film score|soundtrack)\b/, { mood: 'epic', instrument: 'Strings', note: 'orchestral: strings' }],
  [/\b(synthwave|80s)\b/, { mood: 'nostalgic', bpm: 100, instrument: 'Pad', note: 'synthwave: retro pads at 100 BPM' }],
]

const INSTRUMENTS: [InstrumentName, RegExp][] = [
  ['Electric Piano', /\b(electric piano|e-?piano|rhodes|wurli\w*|keys)\b/],
  ['Piano', /\b(piano|grand)\b/],
  ['Synth Lead', /\b(synth lead|lead synth|synth)\b/],
  ['Pad', /\b(pad|pads)\b/],
  ['Organ', /\b(organ)\b/],
  ['Guitar', /\b(guitar\w*)\b/],
  ['Strings', /\b(strings|violin\w*|cello\w*|orchestra)\b/],
  ['Bass', /\b(bass)\b/],
  ['Harp', /\b(harp)\b/],
  ['Bell', /\b(bells?|xylophone|marimba)\b/],
  ['Brass', /\b(brass|horns?|trumpets?)\b/],
]

const NUMBER_WORDS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

/** Find the key the user named: "in A minor", "key of F#", "Bb major", "Am". */
export function detectKey(text: string): string | null {
  const m = text.match(/\b([A-Ga-g])\s?(#|b|sharp|flat)?\s*(major|minor|maj|min|m)?(?![a-z#])/g)
  if (!m) return null
  for (const raw of m) {
    const parts = raw.trim().match(/^([A-Ga-g])\s?(#|b|sharp|flat)?\s*(major|minor|maj|min|m)?$/)
    if (!parts) continue
    const [, letter, acc, quality] = parts
    // A bare letter is only a key when context says so ("in G", "key of D").
    if (!acc && !quality) {
      const ctx = new RegExp(`\\b(in|key of|key)\\s+${letter}\\b`, 'i')
      if (!ctx.test(text)) continue
    }
    // "a" / "b" as plain words ("a sad song") are not keys.
    if (!acc && !quality && /^[ab]$/.test(letter)) continue
    if (quality === 'm' && letter === letter.toLowerCase() && !acc) continue
    const tonic = letter.toUpperCase() + (acc === '#' || acc === 'sharp' ? '#' : acc === 'b' || acc === 'flat' ? 'b' : '')
    const minor = quality === 'minor' || quality === 'min' || quality === 'm'
    const name = `${tonic} ${minor ? 'Minor' : 'Major'}`
    if (KEY_NAMES.includes(name)) return name
    // Enharmonic spellings outside the key list ("Db minor" → "C# Minor").
    const enharmonic = transposeKeyName(name, 0)
    if (KEY_NAMES.includes(enharmonic)) return enharmonic
  }
  return null
}

function detectMood(text: string): Mood | null {
  let best: { mood: Mood; at: number } | null = null
  for (const [mood, re] of MOOD_WORDS) {
    const m = text.match(re)
    // The earliest-mentioned mood word wins ("sad but hopeful" → melancholic).
    if (m && m.index !== undefined && (!best || m.index < best.at)) best = { mood, at: m.index }
  }
  return best?.mood ?? null
}

function detectArp(text: string): ParsedRequest['arp'] {
  if (/\b(no|stop|turn off|disable|without|remove|kill)\s+(the\s+|an?\s+)?arp\w*|\bun-?arp\w*|\bblock chords?\b|\bstop arpeggiat\w*/.test(text)) {
    return { on: false, opts: {} }
  }
  if (!/\barp(s|eggi\w*)?\b/.test(text)) return undefined
  const opts: Partial<ArpSettings> = {}
  // Pattern words only count next to "arp", so "slow it down, arpeggiated" stays Up.
  const near = (w: string) => new RegExp(`\\b(${w})\\w*\\s+arp|\\barp\\w*\\s+(${w})`).test(text)
  if (near('up[- ]?(?:and[- ]?)?down|updown|bounc')) opts.pattern = 'updown'
  else if (near('random')) opts.pattern = 'random'
  else if (near('down|descend')) opts.pattern = 'down'
  else if (near('up|ascend')) opts.pattern = 'up'
  if (/\b(16th|sixteenth)s?\b/.test(text)) opts.rate = '1/16'
  else if (/\btriplets?\b/.test(text)) opts.rate = '1/8t'
  else if (/\b(8th|eighth)s?\b/.test(text)) opts.rate = '1/8'
  else if (/\b(quarter|4th)s?\b/.test(text)) opts.rate = '1/4'
  if (/\b(2|two)[- ]octaves?\b|\bwide\b/.test(text)) opts.octaves = 2
  else if (/\b(1|one)[- ]octave\b/.test(text)) opts.octaves = 1
  if (/\b(hold|keep|with)\w*\s+(the\s+|a\s+)?bass\b/.test(text)) opts.holdBass = true
  if (/\b(pluck\w*|staccato|short)\b/.test(text)) opts.gate = 0.5
  else if (/\blegato\b/.test(text)) opts.gate = 0.95
  return { on: true, opts }
}

export function parseRequest(input: string, prev: ChatSettings = DEFAULT_SETTINGS): ParsedRequest {
  const text = input.toLowerCase().replace(/[’']/g, "'")
  const s: ChatSettings = { ...prev }
  const notes: string[] = []
  let recognised = false
  let transpose: number | undefined
  let chordsTouched = false
  let tempoSet = false
  let instrumentSet = false

  if (/^\s*(help|\?|what can you do|how does this work)/.test(text)) {
    return { settings: s, notes, keepChords: true, tempoSet: false, instrumentSet: false, unknown: false, help: true }
  }

  // ── Follow-up edits relative to the last progression ─────────────────────
  // A key change needs an interval ("up a step", "down 3 semitones", "up an octave") or
  // the word "transpose", so "slow it down a bit" or "higher energy" aren't read as one.
  const shift = text.match(/\b(up|down|higher|lower)\s+(?:by\s+)?(a|an|one|two|three|four|five|six|seven|\d{1,2})?\s*(half[- ]?steps?|semitones?|whole[- ]?(?:steps?|tones?)|steps?|tones?|octaves?)\b/)
  const bare = text.match(/\btranspose\s+(?:it\s+)?(up|down)\b/)
  if (shift || bare) {
    const dir = /up|higher/.test((shift ?? bare)![1]) ? 1 : -1
    let size = 1
    if (shift) {
      const count = shift[2] ? (NUMBER_WORDS[shift[2]] ?? (shift[2].startsWith('a') ? 1 : Number(shift[2]))) : 1
      const per = /octave/.test(shift[3]) ? 12 : /half|semitone/.test(shift[3]) ? 1 : 2
      size = clamp(count * per, 1, 24)
    }
    transpose = dir * size
    recognised = true
    const amount = size === 1 ? 'a semitone' : size === 2 ? 'a whole step' : size === 12 ? 'an octave' : `${size} semitones`
    notes.push(`transposed ${dir > 0 ? 'up' : 'down'} ${amount}`)
  }
  if (/\b(darker|sadder|moodier|gloomier)\b/.test(text)) {
    s.mood = /\b(sadder|gloomier)\b/.test(text) ? 'melancholic' : 'tense'
    s.keyPinned = false; chordsTouched = recognised = true; notes.push('darker')
  }
  if (/\b(happier|brighter|lighter|more hopeful)\b/.test(text)) {
    s.mood = 'uplifting'; s.keyPinned = false; chordsTouched = recognised = true; notes.push('brighter')
  }
  if (/\b(jazzier|more jazz|fancier|richer|more complex|spicier)\b/.test(text)) {
    s.mood = 'jazz'; chordsTouched = recognised = true; notes.push('jazzier')
  }
  if (/\b(simpler|more basic|plainer)\b/.test(text)) {
    s.mood = s.mood === 'jazz' || s.mood === 'dreamy' ? 'uplifting' : s.mood
    s.excludeDiminished = true; chordsTouched = recognised = true; notes.push('simpler')
  }
  if (/\b(longer|extend|more chords)\b/.test(text)) { s.length = clamp(s.length * 2, 2, 16); chordsTouched = recognised = true }
  if (/\b(shorter|fewer chords|less chords)\b/.test(text)) { s.length = clamp(Math.ceil(s.length / 2), 2, 16); chordsTouched = recognised = true }
  if (/\b(faster|speed (?:it )?up|quicker|uptempo)\b/.test(text)) { tempoSet = true; s.bpm = clamp(Math.round((prev.bpm ?? 100) * 1.25), 40, 240); recognised = true; notes.push('faster') }
  if (/\b(slower|slow (?:it )?down|chiller tempo|downtempo)\b/.test(text)) { tempoSet = true; s.bpm = clamp(Math.round((prev.bpm ?? 100) * 0.8), 40, 240); recognised = true; notes.push('slower') }
  if (/\b(again|another|regenerate|new one|different one|try again|re-?roll|one more)\b/.test(text)) { chordsTouched = recognised = true }
  if (/\b(no|without|avoid)\s+(dim\w*|diminished)\b/.test(text)) { s.excludeDiminished = true; recognised = true }
  if (/\b(resolve|resolves|resolving|end(s|ing)? (on|at) (home|the tonic|the root|i\b|one))\b/.test(text)) { s.resolve = true; chordsTouched = recognised = true }

  // ── Fresh descriptions ───────────────────────────────────────────────────
  let styleMood = false
  for (const [re, hint] of STYLE_HINTS) {
    if (re.test(text)) {
      if (hint.mood) { s.mood = hint.mood; styleMood = true }
      if (hint.bpm) { s.bpm = hint.bpm; tempoSet = true }
      if (hint.instrument) { s.instrument = hint.instrument; instrumentSet = true }
      notes.push(hint.note)
      chordsTouched = recognised = true
      break
    }
  }
  const mood = detectMood(text)
  // A style preset ("drill", "lo-fi") already chose the mood its sound needs.
  if (mood && !styleMood && !/\b(darker|sadder|happier|brighter|jazzier)\b/.test(text)) { s.mood = mood; chordsTouched = recognised = true }

  const key = detectKey(input)
  if (key) { s.key = key; s.keyPinned = true; chordsTouched = recognised = true }
  else if (/\bminor\b/.test(text) && !/\bmajor\b/.test(text)) { s.key = parallelKey(s.key, 'minor'); s.keyPinned = true; chordsTouched = recognised = true }
  else if (/\bmajor\b/.test(text) && !/\bminor\b/.test(text)) { s.key = parallelKey(s.key, 'major'); s.keyPinned = true; chordsTouched = recognised = true }

  const len = text.match(/\b(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen)[- ]?(chords?|bars?|chord progression)\b/)
  if (len) { s.length = clamp(NUMBER_WORDS[len[1]] ?? Number(len[1]), 2, 16); chordsTouched = recognised = true }

  const bpm = text.match(/\b(\d{2,3})\s?bpm\b/)
  if (bpm) { s.bpm = clamp(Number(bpm[1]), 40, 240); tempoSet = true; recognised = true }
  else if (!/\b(faster|slower|slow (?:it )?down|speed (?:it )?up)\b/.test(text)) {
    if (/\b(slow|very slow)\b/.test(text)) { s.bpm = 68; tempoSet = true; recognised = true }
    else if (/\b(fast|quick|energetic)\b/.test(text)) { s.bpm = 150; tempoSet = true; recognised = true }
  }

  // "hold the bass" is an arp option, not a request for the bass instrument.
  const instText = text.replace(/\b(hold|keep|with)\w*\s+(the\s+|a\s+)?bass\b/g, ' ')
  for (const [name, re] of INSTRUMENTS) {
    if (re.test(instText)) { s.instrument = name; instrumentSet = true; recognised = true; break }
  }

  const arp = detectArp(text)
  if (arp) { recognised = true; notes.push(arp.on ? 'arpeggiated' : 'block chords') }

  // Generic "make me some chords" words ask for a new progression — unless the
  // message is about the arp ("arpeggiate the chords", "make it an arp").
  if (!arp && /\b(progression|chords?|loop|something|make|write|give|generate|create|song|beat|vibe)\b/.test(text)) {
    chordsTouched = recognised = true
  }

  return {
    settings: s,
    notes,
    transpose,
    keepChords: transpose !== undefined || (recognised && !chordsTouched),
    tempoSet,
    instrumentSet,
    arp,
    unknown: !recognised,
    help: false,
  }
}
