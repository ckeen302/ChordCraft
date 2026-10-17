/**
 * Web Worker that runs the copilot LLM with Transformers.js (ONNX Runtime Web
 * on WebGPU, or WASM on the CPU) so generation never blocks the UI thread.
 */
import { env, pipeline, type TextGenerationPipeline } from '@huggingface/transformers'
import type { WorkerRequest, WorkerResponse } from './protocol'

env.allowLocalModels = false

let generator: TextGenerationPipeline | null = null
const post = (m: WorkerResponse) => (self as unknown as Worker).postMessage(m)

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data
  if (msg.type === 'load') {
    try {
      const files = new Map<string, { loaded: number; total: number }>()
      generator = (await pipeline('text-generation', msg.repo, {
        revision: msg.revision,
        device: msg.device,
        dtype: msg.dtype,
        progress_callback: p => {
          if (p.status !== 'progress') return
          files.set(p.file, { loaded: p.loaded, total: p.total })
          let loaded = 0, total = 0
          for (const f of files.values()) { loaded += f.loaded; total += f.total }
          post({ type: 'progress', loaded, total })
        },
      })) as TextGenerationPipeline
      post({ type: 'ready' })
    } catch (err) {
      post({ type: 'error', message: (err as Error).message ?? String(err) })
    }
    return
  }

  if (msg.type === 'generate') {
    if (!generator) return post({ type: 'result', id: msg.id, error: 'model not loaded' })
    try {
      const prompt = generator.tokenizer.apply_chat_template(msg.messages, {
        tokenize: false, add_generation_prompt: true,
      }) as string
      const out = await generator(prompt + msg.prefill, {
        max_new_tokens: msg.maxNewTokens,
        do_sample: false,
        return_full_text: false,
        add_special_tokens: false,
      })
      const first = (out as { generated_text: string }[])[0]
      post({ type: 'result', id: msg.id, text: first?.generated_text ?? '' })
    } catch (err) {
      post({ type: 'result', id: msg.id, error: (err as Error).message ?? String(err) })
    }
  }
}
