/**
 * Evaluate a copilot LLM on lib/chat/eval/cases.ts with the exact prompt and
 * validator the browser uses (Transformers.js on the CPU, q8 weights).
 *
 *   npx tsx scripts/eval-copilot.ts [repo] [revision]
 *
 * Reports: valid tool calls, exact-match calls, per-field accuracy, latency.
 */
import { pipeline } from '@huggingface/transformers'
import { buildMessages, PREFILL } from '../lib/chat/prompt'
import { DEFAULT_SETTINGS } from '../lib/chat/parse'
import { parseToolCall } from '../lib/chat/toolcall'
import { EVAL_CASES, scoreCall } from '../lib/chat/eval/cases'

const repo = process.argv[2] ?? 'onnx-community/Qwen2.5-0.5B-Instruct'
const revision = process.argv[3] ?? 'main'
const dtype = (process.env.DTYPE ?? 'q8') as 'q8' | 'q4' | 'fp32'
// Fine-tuned models are prompted without the few-shot examples, as in the browser.
const examples = process.env.FEW_SHOT !== '0'

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gen: any = await pipeline('text-generation', repo, { revision, dtype })
  const state = { ...DEFAULT_SETTINGS, bpm: 100 }
  const chords = ['C', 'G', 'Am', 'F']
  let valid = 0, exact = 0, fields = 0, fieldsOk = 0, ms = 0
  for (const c of EVAL_CASES) {
    const prompt = gen.tokenizer.apply_chat_template(buildMessages(c.text, state, chords, { examples }), { tokenize: false, add_generation_prompt: true })
    const t = Date.now()
    const out = await gen(prompt + PREFILL, { max_new_tokens: 120, do_sample: false, return_full_text: false, add_special_tokens: false })
    ms += Date.now() - t
    const raw = PREFILL + out[0].generated_text
    const parsed = parseToolCall(raw, { chordCount: chords.length })
    const call = parsed.ok ? parsed.call : null
    const score = scoreCall(call, c.expect)
    if (parsed.ok) valid++
    if (score.every(s => s.ok)) exact++
    fields += score.length
    fieldsOk += score.filter(s => s.ok).length
    const mark = score.every(s => s.ok) ? '✓' : parsed.ok ? '~' : '✗'
    console.log(`${mark} ${c.text}\n    ${raw.replace(/\s+/g, ' ').slice(0, 220)}${parsed.ok ? '' : `\n    ${parsed.errors.join('; ')}`}`)
  }
  const n = EVAL_CASES.length
  const pct = (a: number, b: number) => `${((100 * a) / b).toFixed(0)}%`
  console.log(`\n${repo}@${revision} (${dtype})`)
  console.log(`valid tool calls ${valid}/${n} (${pct(valid, n)}) · exact ${exact}/${n} (${pct(exact, n)}) · fields ${pct(fieldsOk, fields)} · ${Math.round(ms / n)} ms/request`)
}

main()
