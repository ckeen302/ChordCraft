/**
 * In-browser inference for the chord transformer with ONNX Runtime Web (WASM).
 *
 * The int8-quantized model (15 MB, 98% top-1 agreement with fp32) and its
 * vocabulary are fetched once from the Hugging Face Hub at a pinned revision,
 * so the app needs no inference server. Loading is lazy and shared.
 */
import type { InferenceSession } from 'onnxruntime-web'
import { makeVocab, type LogitsFn, type Vocab } from './sampler'

const ORT_VERSION = '1.30.0'
export const MODEL_REPO = 'ckeen302/chordcraft-chord-transformer'
const REVISION = '403638cb3da538df18e9a2ee1c3362f1d62a6649'
const BASE = `https://huggingface.co/${MODEL_REPO}/resolve/${REVISION}`

export interface LoadedModel {
  vocab: Vocab
  logits: LogitsFn
}

let loading: Promise<LoadedModel> | null = null

export function loadChordModel(): Promise<LoadedModel> {
  if (!loading) {
    loading = load().catch(err => {
      loading = null // let a later click retry (e.g. after a network blip)
      throw err
    })
  }
  return loading
}

async function load(): Promise<LoadedModel> {
  const ort = await import('onnxruntime-web')
  // WASM binaries from the CDN copy of the exact npm version we bundle.
  ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`
  ort.env.wasm.numThreads = 1 // no cross-origin isolation on the host → no SharedArrayBuffer

  const [vocabRes, modelRes] = await Promise.all([
    fetch(`${BASE}/vocab.json`),
    fetch(`${BASE}/onnx/model_quantized.onnx`),
  ])
  if (!vocabRes.ok || !modelRes.ok) throw new Error(`Couldn't download the chord model (HTTP ${vocabRes.status}/${modelRes.status}).`)
  const { tokens } = (await vocabRes.json()) as { tokens: string[] }
  const vocab = makeVocab(tokens)
  const session: InferenceSession = await ort.InferenceSession.create(
    new Uint8Array(await modelRes.arrayBuffer()), { executionProviders: ['wasm'] },
  )

  const logits: LogitsFn = async rows => {
    // All rows in a sampling batch share a length (same prefix, one token per step).
    const width = rows[0].length
    const data = BigInt64Array.from(rows.flat(), n => BigInt(n))
    const input = new ort.Tensor('int64', data, [rows.length, width])
    const out = await session.run({ input_ids: input })
    const all = out.logits.data as Float32Array
    const vocabSize = tokens.length
    return rows.map((_, r) => {
      const start = (r * width + (width - 1)) * vocabSize
      return all.slice(start, start + vocabSize)
    })
  }
  return { vocab, logits }
}
