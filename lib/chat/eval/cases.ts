/**
 * Held-out requests for evaluating the copilot (scripts/eval-copilot.ts).
 * `expect` lists what a correct tool call must contain; arrays mean "any of".
 * None of these appear in the prompt's few-shot examples.
 */
import type { ToolCall } from '../toolcall'

type Want = { [K in keyof ToolCall]?: ToolCall[K] | ToolCall[K][] }

export interface EvalCase {
  text: string
  expect: Want
}

export const EVAL_CASES: EvalCase[] = [
  // Free-form descriptions → generate
  { text: 'a rainy-day coffee shop vibe', expect: { tool: 'generate', mood: ['dreamy', 'jazz', 'romantic', 'melancholic'] } },
  { text: 'music for a villain entrance', expect: { tool: 'generate', mood: ['tense', 'epic', 'aggressive'] } },
  { text: 'something that sounds like a sunny road trip', expect: { tool: 'generate', mood: 'uplifting' } },
  { text: 'heartbreak ballad in E minor', expect: { tool: 'generate', mood: 'melancholic', key: 'E Minor' } },
  { text: 'boss battle music, 8 chords', expect: { tool: 'generate', mood: ['epic', 'aggressive', 'tense'], length: 8 } },
  { text: 'smooth late-night jazz on rhodes', expect: { tool: 'generate', mood: 'jazz', instrument: 'Electric Piano' } },
  { text: 'a 50s doo-wop slow dance', expect: { tool: 'generate', mood: ['nostalgic', 'romantic'] } },
  { text: 'floaty ambient pads in Db major', expect: { tool: 'generate', mood: 'dreamy', key: 'C# Major', instrument: 'Pad' } },
  { text: 'angry punk at 180 bpm', expect: { tool: 'generate', mood: 'aggressive', bpm: 180 } },
  { text: 'wedding first-dance chords', expect: { tool: 'generate', mood: ['romantic', 'uplifting'] } },
  { text: 'chords like Coldplay, hopeful and big', expect: { tool: 'generate', mood: ['uplifting', 'epic'] } },
  { text: 'spooky haunted house, no diminished chords', expect: { tool: 'generate', mood: 'tense', excludeDiminished: true } },
  { text: 'give me 6 chords that resolve, in G', expect: { tool: 'generate', length: 6, resolve: true, key: 'G Major' } },
  { text: 'sad Billie Eilish style', expect: { tool: 'generate', mood: ['melancholic', 'dreamy', 'tense'] } },
  { text: 'gospel church organ', expect: { tool: 'generate', instrument: 'Organ', mood: ['romantic', 'uplifting'] } },
  { text: 'retro synthwave night drive', expect: { tool: 'generate', mood: ['nostalgic', 'dreamy'] } },
  // Keep the chords
  { text: 'faster, like 140', expect: { tool: 'adjust', bpm: 140 } },
  { text: 'play it on a harp instead', expect: { tool: 'adjust', instrument: 'Harp' } },
  { text: 'switch to brass and slow down to 70', expect: { tool: 'adjust', instrument: 'Brass', bpm: 70 } },
  // Transpose
  { text: 'transpose down a semitone', expect: { tool: 'transpose', semitones: -1 } },
  { text: 'move it up 3 half steps', expect: { tool: 'transpose', semitones: 3 } },
  { text: 'down a whole tone', expect: { tool: 'transpose', semitones: -2 } },
  // One-chord edits
  { text: 'make the second chord darker', expect: { tool: 'reharmonize', bar: 2, intent: 'darker' } },
  { text: 'bar 4 should resolve home', expect: { tool: 'reharmonize', bar: 4, intent: 'resolve' } },
  { text: 'jazz up chord 1', expect: { tool: 'reharmonize', bar: 1, intent: 'jazzier' } },
  { text: 'add more tension in bar 3', expect: { tool: 'reharmonize', bar: 3, intent: 'tenser' } },
  { text: 'something unexpected on the 4th bar', expect: { tool: 'reharmonize', bar: 4, intent: 'surprising' } },
  // Help / off-topic
  { text: 'what can you do?', expect: { tool: 'help' } },
  { text: 'write me a poem about cats', expect: { tool: 'clarify' } },
  { text: 'what is 2 + 2', expect: { tool: 'clarify' } },
]

/** Which expected fields a call got right. */
export function scoreCall(call: ToolCall | null, want: Want): { field: string; ok: boolean }[] {
  return Object.entries(want).map(([field, v]) => {
    const got = call?.[field as keyof ToolCall]
    return { field, ok: Array.isArray(v) ? (v as unknown[]).includes(got) : got === v }
  })
}
