/**
 * The copilot's prompt: a compact system message (tools, vocabularies, the
 * current progression) and a few worked examples, kept short because a small
 * model on CPU pays for every prompt token.
 */
import { MOOD_LABELS } from '@/lib/theory/harmony'
import type { ChatSettings } from './parse'
import { GENRES, INSTRUMENT_NAMES, REHARM_INTENTS } from './toolcall'

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** Assistant turns start with this, so even a tiny model goes straight into the JSON. */
export const PREFILL = '{"tool": "'

const MOOD_HINTS: Record<keyof typeof MOOD_LABELS, string> = {
  uplifting: 'happy, anthemic, hopeful',
  melancholic: 'sad, bittersweet',
  dreamy: 'floaty, lo-fi, ambient, shoegaze',
  romantic: 'R&B, soul, love songs',
  nostalgic: 'retro, doo-wop, 50s-80s',
  tense: 'dark, horror, suspense',
  jazz: 'ii-V-I, sophisticated',
  epic: 'cinematic, heroic, trailer',
  aggressive: 'metal, punk, angry',
}

export function systemPrompt(state: ChatSettings, chords: string[]): string {
  const moods = Object.entries(MOOD_HINTS).map(([m, h]) => `${m} (${h})`).join(', ')
  const progression = chords.length ? chords.map((c, i) => `${i + 1}:${c}`).join(' ') : 'none yet'
  return [
    'You are the ChordCraft copilot. Turn the user\'s message into ONE JSON tool call and output only that JSON.',
    'Tools:',
    '- generate: write a new progression. Optional fields, only what the user asks for or implies: mood, key, genre, length (2-16), bpm, instrument, excludeDiminished, resolve.',
    '- adjust: keep the chords; change bpm and/or instrument only.',
    '- transpose: shift the chords by semitones (-12..12).',
    '- reharmonize: change one chord: bar (1-based) and intent.',
    '- help: the user asks what you can do.',
    '- clarify: the message is not about music; say = a short question back.',
    'Always include "say": one short sentence (max 25 words) about the musical choice.',
    `Moods: ${moods}.`,
    `Genres: ${GENRES.join(', ')}.`,
    `Instruments: ${INSTRUMENT_NAMES.join(', ')}.`,
    `Intents: ${REHARM_INTENTS.join(', ')}.`,
    'Keys look like "C Major", "F# Minor", "Bb Major". Map artists and songs to the mood, genre and key that capture their sound. "Brighter" means a major mood; "darker" a minor one.',
    `Current: key ${state.key}, mood ${state.mood}, ${state.length} chords, ${state.bpm ?? 100} BPM, ${state.instrument ?? 'Piano'}. Chords: ${progression}.`,
  ].join('\n')
}

const EXAMPLES: [string, string][] = [
  ['something like Radiohead\'s bridges but brighter',
    '{"tool": "generate", "mood": "dreamy", "genre": "alternative", "say": "Radiohead bridges drift through borrowed chords, so I kept that alt-rock float but in a brighter major mood."}'],
  ['sad piano ballad in D minor, 8 chords',
    '{"tool": "generate", "mood": "melancholic", "key": "D Minor", "length": 8, "bpm": 66, "instrument": "Piano", "say": "A slow minor ballad that lingers before it resolves."}'],
  ['make bar 3 more surprising',
    '{"tool": "reharmonize", "bar": 3, "intent": "surprising", "say": "Swapping bar 3 for a chord from outside the key."}'],
  ['slow it down and put it on strings',
    '{"tool": "adjust", "bpm": 72, "instrument": "Strings", "say": "Same chords, slower, on strings."}'],
  ['up a whole step',
    '{"tool": "transpose", "semitones": 2, "say": "Moving everything up a whole step."}'],
  ['what\'s the capital of France?',
    '{"tool": "clarify", "say": "I only write chords. What kind of progression would you like?"}'],
]

/** Few-shot examples steer a stock instruct model; a model fine-tuned on this format doesn't need them. */
export function buildMessages(text: string, state: ChatSettings, chords: string[], { examples = true } = {}): ChatTurn[] {
  return [
    { role: 'system', content: systemPrompt(state, chords) },
    ...(examples ? EXAMPLES : []).flatMap(([u, a]): ChatTurn[] => [{ role: 'user', content: u }, { role: 'assistant', content: a }]),
    { role: 'user', content: text },
  ]
}
