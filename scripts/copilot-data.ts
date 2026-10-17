/**
 * Synthetic supervised data for fine-tuning the copilot LLM to emit
 * ChordChat tool calls.
 *
 *   npx tsx scripts/copilot-data.ts [outDir] [count]
 *
 * Each example is a chat in the exact format the browser sends — the same
 * system prompt (with a random current key/mood/progression), a user request
 * built from templates and lexicons (scenes, artists, synonyms, casual
 * phrasing), and the target tool call. Every target goes through
 * parseToolCall, so the labels are schema-valid by construction. Requests
 * that appear in the held-out eval set (lib/chat/eval/cases.ts) are skipped.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { InstrumentName } from '../types'
import type { Mood } from '../lib/theory/harmony'
import { KEY_NAMES } from '../lib/theory/keys'
import { transposeKeyName } from '../lib/theory/transpose'
import { generateSmartRich } from '../lib/theory/progressions'
import { seededRng } from '../lib/ai/sampler'
import type { ReharmIntent } from '../lib/ai/generate'
import type { ChatSettings } from '../lib/chat/parse'
import { systemPrompt } from '../lib/chat/prompt'
import { INSTRUMENT_NAMES, MOODS, parseToolCall, type ToolCall } from '../lib/chat/toolcall'
import { EVAL_CASES } from '../lib/chat/eval/cases'

const outDir = process.argv[2] ?? 'backend/copilot/data'
const COUNT = Number(process.argv[3] ?? 6000)
const rng = seededRng(2026)
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]
const chance = (p: number) => rng() < p
const int = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1))

// ── Lexicons ────────────────────────────────────────────────────────────────

const MOOD_WORDS: Record<Mood, string[]> = {
  uplifting: ['happy', 'uplifting', 'upbeat', 'joyful', 'bright', 'hopeful', 'feel-good', 'triumphant', 'anthemic', 'sunny', 'optimistic', 'euphoric'],
  melancholic: ['sad', 'melancholic', 'heartbroken', 'bittersweet', 'lonely', 'mournful', 'wistful', 'gloomy', 'tearful', 'blue', 'somber'],
  dreamy: ['dreamy', 'floaty', 'ethereal', 'hazy', 'chill', 'lo-fi', 'ambient', 'spacey', 'weightless', 'drifting', 'calm', 'mellow'],
  romantic: ['romantic', 'tender', 'loving', 'sensual', 'intimate', 'soulful', 'warm', 'smooth R&B', 'neo-soul', 'heartfelt'],
  nostalgic: ['nostalgic', 'retro', 'vintage', 'old-school', 'throwback', 'sepia-toned', 'wistful 60s', 'oldies'],
  tense: ['tense', 'dark', 'creepy', 'ominous', 'eerie', 'spooky', 'sinister', 'suspenseful', 'unsettling', 'menacing', 'noir'],
  jazz: ['jazzy', 'sophisticated', 'smooth jazz', 'bebop', 'swinging', 'lounge', 'bossa nova', 'jazz'],
  epic: ['epic', 'cinematic', 'heroic', 'grand', 'massive', 'majestic', 'triumphal', 'orchestral', 'larger-than-life'],
  aggressive: ['aggressive', 'angry', 'furious', 'heavy', 'brutal', 'raging', 'intense', 'hard-hitting', 'violent'],
}

const SCENES: [string, Mood, Partial<ToolCall>?][] = [
  ['a rainy Sunday morning', 'dreamy'], ['a late-night drive through the city', 'dreamy'], ['a breakup text', 'melancholic'],
  ['a funeral scene', 'melancholic'], ['the last day of summer', 'nostalgic'], ['a graduation montage', 'uplifting'],
  ['a horror movie basement', 'tense'], ['a detective in a smoky bar', 'jazz'], ['a dragon fight', 'epic'],
  ['a mosh pit', 'aggressive'], ['a candlelit dinner', 'romantic'], ['a road trip with friends', 'uplifting'],
  ['falling asleep', 'dreamy'], ['a haunted forest', 'tense'], ['a space launch', 'epic'], ['a high school dance in 1958', 'nostalgic'],
  ['the end credits of a sad movie', 'melancholic'], ['a hotel lobby', 'jazz'], ['a sunrise on the beach', 'uplifting'],
  ['a heist', 'tense'], ['a wedding proposal', 'romantic'], ['a training montage', 'epic'], ['a street fight', 'aggressive'],
  ['studying late at night', 'dreamy', { genre: 'electronic' }], ['a stadium encore', 'uplifting', { genre: 'pop rock' }],
  ['an old photo album', 'nostalgic'], ['a thunderstorm', 'tense'], ['a slow dance', 'romantic'], ['a cozy cabin in winter', 'dreamy'],
  ['a final boss', 'epic'], ['a breakup at a party', 'melancholic', { genre: 'pop' }], ['a jazz club at 2am', 'jazz'],
  ['the villain\'s theme', 'tense'], ['a victory lap', 'uplifting'], ['a ghost story', 'tense'], ['a summer festival', 'uplifting', { genre: 'electronic' }],
  ['a cowboy riding into the sunset', 'nostalgic', { genre: 'country' }], ['a chase scene', 'aggressive'], ['a lullaby', 'dreamy'],
  ['a soldier coming home', 'melancholic'], ['a medieval battle', 'epic'], ['a romantic comedy ending', 'romantic', { genre: 'pop' }],
]

const ARTISTS: [string, Mood[], string][] = [
  ['Radiohead', ['melancholic', 'dreamy', 'tense'], 'alternative'], ['Coldplay', ['uplifting', 'epic'], 'pop rock'],
  ['Taylor Swift', ['uplifting', 'melancholic'], 'pop'], ['Billie Eilish', ['melancholic', 'dreamy', 'tense'], 'pop'],
  ['Metallica', ['aggressive'], 'metal'], ['Slipknot', ['aggressive'], 'metal'], ['Green Day', ['aggressive', 'uplifting'], 'punk'],
  ['blink-182', ['uplifting', 'aggressive'], 'punk'], ['Hans Zimmer', ['epic'], 'electronic'], ['Bill Evans', ['jazz'], 'jazz'],
  ['Miles Davis', ['jazz'], 'jazz'], ['Frank Ocean', ['dreamy', 'romantic'], 'soul'], ['SZA', ['romantic', 'dreamy'], 'soul'],
  ['D\'Angelo', ['romantic'], 'soul'], ['The Beatles', ['nostalgic', 'uplifting'], 'pop rock'], ['The Beach Boys', ['nostalgic', 'dreamy'], 'pop'],
  ['Bob Marley', ['uplifting', 'dreamy'], 'reggae'], ['Johnny Cash', ['nostalgic', 'melancholic'], 'country'],
  ['Kacey Musgraves', ['dreamy', 'nostalgic'], 'country'], ['Daft Punk', ['uplifting', 'nostalgic'], 'electronic'],
  ['Avicii', ['uplifting'], 'electronic'], ['Kendrick Lamar', ['tense', 'aggressive'], 'rap'], ['Drake', ['melancholic', 'dreamy'], 'rap'],
  ['Travis Scott', ['tense', 'dreamy'], 'rap'], ['Beach House', ['dreamy'], 'alternative'], ['Tame Impala', ['dreamy', 'nostalgic'], 'alternative'],
  ['Phoebe Bridgers', ['melancholic'], 'alternative'], ['Nirvana', ['aggressive', 'melancholic'], 'rock'], ['Queen', ['epic', 'uplifting'], 'rock'],
  ['Led Zeppelin', ['aggressive', 'epic'], 'rock'], ['Adele', ['melancholic', 'romantic'], 'pop'], ['Bruno Mars', ['uplifting', 'romantic'], 'pop'],
  ['Stevie Wonder', ['romantic', 'uplifting'], 'soul'], ['Marvin Gaye', ['romantic', 'nostalgic'], 'soul'], ['Lana Del Rey', ['melancholic', 'nostalgic', 'dreamy'], 'pop'],
  ['The Weeknd', ['tense', 'nostalgic', 'melancholic'], 'pop'], ['Bon Iver', ['melancholic', 'dreamy'], 'alternative'], ['Nujabes', ['dreamy', 'jazz'], 'electronic'],
  ['John Williams', ['epic'], 'any'], ['Joe Hisaishi', ['nostalgic', 'dreamy'], 'any'], ['Danny Elfman', ['tense'], 'any'], ['Bernard Herrmann', ['tense'], 'any'],
]

const STYLE_NOUNS = ['song', 'progression', 'loop', 'chord progression', 'track', 'beat', 'vibe', 'chords', 'tune', 'piece', 'intro', 'chorus', 'verse', 'bridge']

const INSTRUMENT_WORDS: Record<InstrumentName, string[]> = {
  'Piano': ['piano', 'grand piano', 'keys'], 'Electric Piano': ['electric piano', 'rhodes', 'wurlitzer', 'e-piano'],
  'Pad': ['pads', 'a synth pad', 'warm pads'], 'Synth Lead': ['synth', 'a lead synth', 'synth lead'], 'Organ': ['organ', 'church organ', 'hammond'],
  'Guitar': ['guitar', 'acoustic guitar', 'electric guitar'], 'Strings': ['strings', 'violins', 'a string section', 'cellos'],
  'Bass': ['bass', 'bass guitar'], 'Harp': ['harp'], 'Bell': ['bells', 'a music box', 'celesta'], 'Brass': ['brass', 'horns', 'trumpets'],
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth']

const OPENERS = ['', '', '', 'can you make ', 'give me ', 'i want ', 'write ', 'make me ', 'could you write ', 'generate ', 'pls ', 'hey, ', 'let\'s do ', 'i need ', 'how about ']

// ── Phrase builders ─────────────────────────────────────────────────────────

function keyPhrase(key: string): string {
  const [tonic, mode] = key.split(' ')
  const t = chance(0.3) ? tonic.replace('#', ' sharp').replace(/^([A-G])b$/, '$1 flat') : tonic
  const m = mode.toLowerCase()
  return pick([`in ${t} ${m}`, `in ${t} ${m}`, `key of ${t} ${m}`, `in ${t}${m === 'minor' ? 'm' : ''}`, `${t} ${m}`])
}

function lengthPhrase(n: number): string {
  const w = chance(0.5) ? NUMBER_WORDS[n] ?? String(n) : String(n)
  return pick([`${w} chords`, `${w} bars`, `${w}-chord`, `with ${w} chords`])
}

const bpmPhrase = (b: number) => pick([`${b} bpm`, `at ${b} bpm`, `around ${b} BPM`, `tempo ${b}`])

const an = (w: string) => (/^[aeiou]/i.test(w) ? `an ${w}` : `a ${w}`)

const sayFor: Record<string, (c: ToolCall) => string> = {
  generate: c => pick([
    `${an(c.mood ?? 'fresh')[0].toUpperCase()}${an(c.mood ?? 'fresh').slice(1)} progression${c.key ? ` in ${c.key}` : ''}${c.genre ? ` with a ${c.genre} feel` : ''}.`,
    `Going ${c.mood ?? 'for something new'}${c.instrument ? ` on ${c.instrument.toLowerCase()}` : ''}.`,
    `Here's ${an(c.mood ?? 'new')} take${c.length ? ` in ${c.length} chords` : ''}.`,
  ]),
  adjust: c => `Same chords${c.bpm ? `, now ${c.bpm} BPM` : ''}${c.instrument ? `, on ${c.instrument.toLowerCase()}` : ''}.`,
  transpose: c => `Moving everything ${c.semitones! > 0 ? 'up' : 'down'} ${Math.abs(c.semitones!)} semitone${Math.abs(c.semitones!) === 1 ? '' : 's'}.`,
  reharmonize: c => pick([`Making bar ${c.bar} ${c.intent === 'resolve' ? 'resolve' : c.intent}.`, `Swapping bar ${c.bar} for something ${c.intent === 'resolve' ? 'that lands home' : c.intent}.`]),
  help: () => 'I can write, tweak and transpose progressions.',
}

type Example = { text: string; call: ToolCall }
type State = { s: ChatSettings; chords: string[] }

/** Merge moods/genres from optional "but darker"-style modifiers. */
const MODIFIERS: [string, Mood[]][] = [
  ['but brighter', ['uplifting', 'dreamy']], ['but darker', ['tense', 'melancholic']], ['but happier', ['uplifting']],
  ['but sadder', ['melancholic']], ['but jazzier', ['jazz']], ['but more epic', ['epic']], ['but calmer', ['dreamy']], ['but angrier', ['aggressive']],
]

function describe(st: State): Example {
  const call: ToolCall = { tool: 'generate' }
  const parts: string[] = []
  const kind = rng()
  if (kind < 0.35) {
    const mood = pick(MOODS)
    call.mood = mood
    const adj = pick(MOOD_WORDS[mood])
    parts.push(pick([`${adj} ${pick(STYLE_NOUNS)}`, `something ${adj}`, `a ${adj} ${pick(STYLE_NOUNS)}`, `${adj} chords`, adj]))
  } else if (kind < 0.65) {
    const [scene, mood, extra] = pick(SCENES)
    call.mood = mood
    Object.assign(call, extra)
    if (chance(0.6)) call.say = pick([`For ${scene}: ${an(mood)} progression.`, `${scene[0].toUpperCase()}${scene.slice(1)} calls for something ${mood}.`])
    parts.push(pick([`music for ${scene}`, `chords for ${scene}`, `${scene} vibes`, `something that sounds like ${scene}`, `the soundtrack to ${scene}`, `${scene}`]))
  } else {
    const [artist, moods, genre] = pick(ARTISTS)
    call.mood = pick(moods)
    if (genre !== 'any') call.genre = genre as ToolCall['genre']
    const song = pick(['', ' bridges', ' choruses', ' ballads', ' verses', ' early stuff'])
    parts.push(pick([`something like ${artist}${song ? `'s${song}` : ''}`, `${artist}-style chords`, `chords like ${artist}`, `in the style of ${artist}`, `${artist} vibes`, `sounds like ${artist}`]))
    if (chance(0.3)) {
      const [mod, ms] = pick(MODIFIERS)
      parts.push(mod)
      call.mood = pick(ms)
    }
    call.say = pick([
      `Borrowing ${artist}'s ${genre === 'any' ? '' : `${genre} `}colours in ${an(call.mood)} mood.`,
      `${artist}-style harmony, leaning ${call.mood}.`,
      `Channelling ${artist}: ${call.mood}${genre === 'any' ? '' : `, ${genre}`}.`,
    ])
  }
  if (chance(0.3)) { call.key = pick(KEY_NAMES); parts.push(keyPhrase(call.key)) }
  if (chance(0.25)) { call.length = pick([2, 3, 4, 5, 6, 8, 8, 12, 16]); parts.push(lengthPhrase(call.length)) }
  if (chance(0.2)) { call.bpm = int(6, 34) * 5; parts.push(bpmPhrase(call.bpm)) }
  else if (chance(0.1)) { const slow = chance(0.5); call.bpm = slow ? 70 : 140; parts.push(slow ? 'slow' : 'fast') }
  if (chance(0.25)) { call.instrument = pick(INSTRUMENT_NAMES); parts.push(pick(['on ', 'played on ', 'with ', 'for ']) + pick(INSTRUMENT_WORDS[call.instrument])) }
  if (chance(0.08)) { call.excludeDiminished = true; parts.push(pick(['no diminished chords', 'without diminished', 'avoid dim chords'])) }
  if (chance(0.08)) { call.resolve = true; parts.push(pick(['that resolves', 'ending on the tonic', 'make it resolve', 'that lands home'])) }
  const sep = pick([', ', ' ', ', '])
  return { text: pick(OPENERS) + parts.join(sep), call }
}

function refine(st: State): Example {
  const r = rng()
  if (r < 0.45) {
    const [word, mood] = pick<[string, Mood]>([
      ['darker', 'tense'], ['sadder', 'melancholic'], ['happier', 'uplifting'], ['brighter', 'uplifting'], ['jazzier', 'jazz'],
      ['more epic', 'epic'], ['dreamier', 'dreamy'], ['more romantic', 'romantic'], ['angrier', 'aggressive'], ['more retro', 'nostalgic'],
      ['spookier', 'tense'], ['more cinematic', 'epic'], ['chiller', 'dreamy'], ['heavier', 'aggressive'], ['more hopeful', 'uplifting'],
    ])
    return { text: pick([`make it ${word}`, word, `${word} please`, `can it be ${word}?`, `a bit ${word}`, `try something ${word}`]), call: { tool: 'generate', mood } }
  }
  if (r < 0.65) {
    const longer = chance(0.5)
    const length = Math.max(2, Math.min(16, longer ? st.s.length * 2 : Math.ceil(st.s.length / 2)))
    return { text: pick(longer ? ['longer', 'make it longer', 'more chords', 'extend it'] : ['shorter', 'make it shorter', 'fewer chords']), call: { tool: 'generate', length } }
  }
  if (r < 0.8) {
    const length = pick([2, 3, 4, 5, 6, 7, 8, 10, 12, 16])
    return { text: pick([`make it ${lengthPhrase(length)}`, `${lengthPhrase(length)} instead`, `can I get ${lengthPhrase(length)}`]), call: { tool: 'generate', length } }
  }
  if (r < 0.9) return { text: pick(['no diminished chords please', 'get rid of the diminished chords', 'avoid diminished']), call: { tool: 'generate', excludeDiminished: true } }
  return { text: pick(['another one', 'again', 'try again', 'reroll', 'give me a different one', 'one more', 'new one please', 'nah, another']), call: { tool: 'generate' } }
}

function adjust(st: State): Example {
  const call: ToolCall = { tool: 'adjust' }
  const bpm = st.s.bpm ?? 100
  const parts: string[] = []
  const r = rng()
  if (r < 0.4) {
    const kind = rng()
    if (kind < 0.35) { call.bpm = Math.min(240, Math.round(bpm * 1.25)); parts.push(pick(['faster', 'speed it up', 'a bit quicker', 'more uptempo'])) }
    else if (kind < 0.7) { call.bpm = Math.max(40, Math.round(bpm * 0.8)); parts.push(pick(['slower', 'slow it down', 'a bit slower', 'more laid back'])) }
    else { call.bpm = int(9, 36) * 5; parts.push(pick([`change the tempo to ${call.bpm}`, `${call.bpm} bpm`, `set it to ${call.bpm} bpm`, `tempo ${call.bpm}`])) }
  }
  if (r >= 0.3) {
    call.instrument = pick(INSTRUMENT_NAMES)
    const w = pick(INSTRUMENT_WORDS[call.instrument])
    parts.push(pick([`play it on ${w}`, `switch to ${w}`, `on ${w}`, `use ${w} instead`, `${w} instead`, `try it with ${w}`]))
  }
  return { text: parts.join(pick([' and ', ', ', ' '])), call }
}

function transpose(st: State): Example {
  const r = rng()
  if (r < 0.3) {
    const target = pick(KEY_NAMES.filter(k => k.split(' ')[1] === st.s.key.split(' ')[1] && k !== st.s.key))
    let n = 0
    while (transposeKeyName(st.s.key, n) !== target && n < 12) n++
    if (n > 6) n -= 12
    if (n !== 0 && transposeKeyName(st.s.key, n) === target) {
      const [t, m] = target.split(' ')
      return { text: pick([`transpose to ${t}`, `move it to ${t} ${m.toLowerCase()}`, `put it in ${t}`, `can you transpose it into ${target}`]), call: { tool: 'transpose', semitones: n } }
    }
  }
  const [phrase, size] = pick<[string, number]>([
    ['a semitone', 1], ['a half step', 1], ['one semitone', 1], ['a whole step', 2], ['a whole tone', 2], ['a step', 2], ['two semitones', 2],
    ['a minor third', 3], ['3 semitones', 3], ['a major third', 4], ['4 half steps', 4], ['a fourth', 5], ['5 semitones', 5],
    ['a fifth', 7], ['an octave', 12], ['6 semitones', 6], ['a tritone', 6],
  ])
  const up = chance(0.5)
  return {
    text: pick([`${up ? 'up' : 'down'} ${phrase}`, `transpose ${up ? 'up' : 'down'} ${phrase}`, `move it ${up ? 'up' : 'down'} ${phrase}`, `shift everything ${up ? 'up' : 'down'} ${phrase}`, `${up ? 'raise' : 'lower'} it ${phrase}`]),
    call: { tool: 'transpose', semitones: up ? size : -size },
  }
}

const INTENT_PHRASES: Record<ReharmIntent, string[]> = {
  surprising: ['more surprising', 'more unexpected', 'weirder', 'spicier', 'less predictable', 'more interesting', 'something out of key', 'a surprise'],
  darker: ['darker', 'sadder', 'minor', 'moodier', 'more somber'],
  brighter: ['brighter', 'happier', 'major', 'lighter', 'sunnier'],
  tenser: ['tenser', 'more tense', 'more tension', 'more dissonant', 'more unstable', 'build tension'],
  jazzier: ['jazzier', 'richer', 'fancier', 'a seventh chord', 'more colourful', 'more sophisticated'],
  simpler: ['simpler', 'a plain triad', 'more basic', 'less busy'],
  resolve: ['resolve', 'land home', 'go back to the tonic', 'resolve to the root', 'feel finished'],
}

function reharm(st: State): Example {
  const n = st.chords.length
  const bar = int(1, n)
  const intent = pick(Object.keys(INTENT_PHRASES) as ReharmIntent[])
  const ip = pick(INTENT_PHRASES[intent])
  const ref = pick([`bar ${bar}`, `chord ${bar}`, `the ${ORDINALS[bar - 1] ?? `${bar}th`} chord`, `the ${ORDINALS[bar - 1] ?? `${bar}th`} bar`, `measure ${bar}`,
    ...(bar === n ? ['the last chord', 'the final chord'] : []), ...(bar === 1 ? ['the first chord', 'the opening chord'] : []),
    `the ${st.chords[bar - 1]}${st.chords.indexOf(st.chords[bar - 1]) === bar - 1 && st.chords.lastIndexOf(st.chords[bar - 1]) === bar - 1 ? '' : ` in bar ${bar}`}`])
  const verb = intent === 'resolve' ? 'make' : pick(['make', 'can you make', 'change', 'turn'])
  const text = intent === 'resolve'
    ? pick([`make ${ref} ${ip}`, `${ref} should ${ip}`, `let ${ref} ${ip}`])
    : pick([`${verb} ${ref} ${ip}`, `${ip} ${ref}`, `${ref}: ${ip}`, `swap ${ref} for something ${ip}`, `I want ${ref} ${ip}`])
  return { text, call: { tool: 'reharmonize', bar, intent } }
}

const HELP = ['help', 'what can you do?', 'how does this work', 'what can I ask you', 'what are my options?', 'commands?', 'how do I use this', '?']
const OFF_TOPIC = [
  'write me a haiku', 'what is the capital of Spain', 'how do I bake bread', 'tell me a joke', 'who won the world cup', 'what\'s 17 times 4',
  'translate hello into French', 'what time is it', 'can you fix my python code', 'recommend a movie', 'who is the president',
  'how tall is mount everest', 'summarize the news', 'what\'s your name', 'give me a workout plan', 'how do magnets work',
  'write an email to my boss', 'what should I eat for dinner', 'explain quantum computing', 'what\'s the weather in Paris',
]
const CLARIFY_SAYS = [
  'I only write chord progressions. What mood or style would you like?',
  'That\'s outside my lane — I write chords. Describe a vibe and I\'ll write it.',
  'I can\'t help with that, but I can write a progression. What feel are you after?',
]

const MAKERS: [(st: State) => Example | null, number][] = [
  [describe, 0.42], [refine, 0.13], [adjust, 0.12],
  [st => (st.chords.length ? transpose(st) : null), 0.1],
  [st => (st.chords.length ? reharm(st) : null), 0.15],
  [() => ({ text: pick(HELP), call: { tool: 'help' } }), 0.02],
  [() => ({ text: pick(OFF_TOPIC), call: { tool: 'clarify', say: pick(CLARIFY_SAYS) } }), 0.06],
]

function randomState(): State {
  const mood = pick(MOODS)
  const key = pick(KEY_NAMES)
  const length = pick([4, 4, 4, 4, 6, 8, 8])
  const s: ChatSettings = {
    key, keyPinned: chance(0.4), mood, length, bpm: int(12, 32) * 5,
    instrument: chance(0.7) ? pick(INSTRUMENT_NAMES) : undefined, excludeDiminished: false, resolve: false,
  }
  const chords = chance(0.85) ? generateSmartRich(key, { mood, length, excludeDiminished: false }).chords.map(c => c.symbol) : []
  return { s, chords }
}

function casualise(text: string): string {
  let t = text
  if (chance(0.5)) t = t.toLowerCase()
  else t = t[0].toUpperCase() + t.slice(1)
  if (chance(0.15)) t += pick(['!', '.', ' please', ' pls', ' thx'])
  return t
}

const evalTexts = new Set(EVAL_CASES.map(c => c.text.toLowerCase()))
const seen = new Set<string>()
const rows: string[] = []
let attempts = 0
while (rows.length < COUNT && attempts++ < COUNT * 20) {
  const st = randomState()
  let x = rng()
  let make = MAKERS[MAKERS.length - 1][0]
  for (const [fn, w] of MAKERS) { if ((x -= w) < 0) { make = fn; break } }
  const ex = make(st)
  if (!ex) continue
  const text = casualise(ex.text.replace(/\s+/g, ' ').trim())
  if (evalTexts.has(text.toLowerCase())) continue
  const dedupe = `${text}|${st.chords.length}`
  if (seen.has(dedupe)) continue
  seen.add(dedupe)
  if (!ex.call.say) ex.call.say = (sayFor[ex.call.tool] ?? (() => ''))(ex.call)
  const target = JSON.stringify(ex.call).replace(/":/g, '": ').replace(/,"/g, ', "')
  const check = parseToolCall(target, { chordCount: st.chords.length })
  if (!check.ok) throw new Error(`bad label for "${text}": ${check.errors.join('; ')} — ${target}`)
  rows.push(JSON.stringify({
    messages: [
      { role: 'system', content: systemPrompt(st.s, st.chords) },
      { role: 'user', content: text },
      { role: 'assistant', content: target },
    ],
  }))
}

mkdirSync(outDir, { recursive: true })
const nVal = Math.round(rows.length * 0.05)
writeFileSync(join(outDir, 'val.jsonl'), rows.slice(0, nVal).join('\n') + '\n')
writeFileSync(join(outDir, 'train.jsonl'), rows.slice(nVal).join('\n') + '\n')
console.log(`wrote ${rows.length - nVal} train + ${nVal} val examples to ${outDir}`)
