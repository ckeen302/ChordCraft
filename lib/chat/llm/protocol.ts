/** Messages between the page and the copilot's Web Worker. */
import type { ChatTurn } from '../prompt'

export type CopilotDevice = 'webgpu' | 'wasm'
export type CopilotDtype = 'q4' | 'q8'

export type WorkerRequest =
  | { type: 'load'; repo: string; revision: string; device: CopilotDevice; dtype: CopilotDtype }
  | { type: 'generate'; id: number; messages: ChatTurn[]; prefill: string; maxNewTokens: number }

export type WorkerResponse =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready' }
  | { type: 'error'; message: string }
  | { type: 'result'; id: number; text?: string; error?: string }
