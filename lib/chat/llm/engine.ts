/**
 * The page side of the LLM copilot: which models exist, which backend this
 * device can run, and a loader that boots the Web Worker and hands back a
 * CompleteFn for lib/chat/copilot.ts. Weights stream from the Hugging Face
 * Hub at pinned revisions and are cached by the browser after the first load.
 */
import type { CompleteFn } from '../copilot'
import type { CopilotDevice, CopilotDtype, WorkerRequest, WorkerResponse } from './protocol'

export interface CopilotModel {
  id: string
  label: string
  repo: string
  revision: string
  /** Fine-tuned on the tool-call format, so the prompt can skip the few-shot examples. */
  fineTuned?: boolean
  /**
   * Download size in MB per backend; a missing backend isn't offered.
   * WebGPU uses q4 weights with fp32 activations: q4f16 is smaller, but its
   * fp16 activations overflow on some GPUs and the model emits garbage.
   */
  webgpu?: number
  wasm?: number
}

export const COPILOT_MODELS: CopilotModel[] = [
  {
    id: 'qwen2.5-0.5b',
    label: 'Qwen2.5 0.5B Instruct',
    repo: 'onnx-community/Qwen2.5-0.5B-Instruct',
    revision: '22942cb7d7ba4cc81bb4673549ca4d4614469b5e',
    webgpu: 786,
    wasm: 512,
  },
  {
    id: 'qwen2.5-1.5b',
    label: 'Qwen2.5 1.5B Instruct',
    repo: 'onnx-community/Qwen2.5-1.5B-Instruct',
    revision: 'd54957e3af1be04546436e874a60fe386041b244',
    webgpu: 1788,
  },
]

export interface Backend {
  device: CopilotDevice
}

/** WebGPU when the browser exposes a usable adapter, otherwise WASM on the CPU. */
export async function detectBackend(): Promise<Backend> {
  const gpu = (globalThis.navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } } | undefined)?.gpu
  if (gpu) {
    try {
      if (await gpu.requestAdapter()) return { device: 'webgpu' }
    } catch { /* fall through to WASM */ }
  }
  return { device: 'wasm' }
}

export function downloadMb(model: CopilotModel, backend: Backend): number | null {
  return (backend.device === 'webgpu' ? model.webgpu : model.wasm) ?? null
}

export function modelsFor(backend: Backend): CopilotModel[] {
  return COPILOT_MODELS.filter(m => downloadMb(m, backend) !== null)
}

export interface LoadedCopilot {
  model: CopilotModel
  complete: CompleteFn
  dispose: () => void
}

/** Boot the worker and load `model`; resolves once the weights are on the device. */
export function loadCopilot(
  model: CopilotModel,
  backend: Backend,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<LoadedCopilot> {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  const send = (m: WorkerRequest) => worker.postMessage(m)
  const pending = new Map<number, { resolve: (t: string) => void; reject: (e: Error) => void }>()
  let nextId = 1

  return new Promise((resolve, reject) => {
    signal?.addEventListener('abort', () => { worker.terminate(); reject(new Error('cancelled')) })
    worker.onerror = e => { worker.terminate(); reject(new Error(e.message || 'the copilot worker crashed')) }
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const m = e.data
      if (m.type === 'progress') onProgress(m.loaded, m.total)
      else if (m.type === 'error') { worker.terminate(); reject(new Error(m.message)) }
      else if (m.type === 'result') {
        const p = pending.get(m.id)
        pending.delete(m.id)
        if (m.error !== undefined) p?.reject(new Error(m.error))
        else p?.resolve(m.text ?? '')
      } else if (m.type === 'ready') {
        resolve({
          model,
          complete: (messages, prefill) => new Promise((res, rej) => {
            const id = nextId++
            pending.set(id, { resolve: res, reject: rej })
            send({ type: 'generate', id, messages, prefill, maxNewTokens: 160 })
          }),
          dispose: () => {
            worker.terminate()
            for (const p of pending.values()) p.reject(new Error('the copilot was turned off'))
            pending.clear()
          },
        })
      }
    }
    const dtype: CopilotDtype = backend.device === 'wasm' ? 'q8' : 'q4'
    send({ type: 'load', repo: model.repo, revision: model.revision, device: backend.device, dtype })
  })
}
