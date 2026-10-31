// Worker thread: loads the embedding model and turns texts into normalized 384-dim vectors, off the main thread.
import { parentPort, workerData } from 'node:worker_threads'

const MODEL = 'Xenova/all-MiniLM-L6-v2'
let pipe: Promise<any> | null = null
let chain: Promise<void> = Promise.resolve()

function load(): Promise<any> {
  return (pipe ??= (async () => {
    const tf = await import('@huggingface/transformers')
    tf.env.cacheDir = workerData.cacheDir
    return tf.pipeline('feature-extraction', MODEL, { dtype: 'q8' })
  })())
}

// messages run one at a time, in order, so a query slips in between two indexing batches
parentPort!.on('message', (m: { id: number; type: 'init' | 'embed'; texts?: string[] }) => {
  chain = chain.then(async () => {
    try {
      const p = await load()
      if (m.type === 'init') { parentPort!.postMessage({ id: m.id, ok: true }); return }
      const out = await p(m.texts, { pooling: 'mean', normalize: true })
      const data = new Float32Array(out.data)
      parentPort!.postMessage({ id: m.id, ok: true, vecs: data }, [data.buffer])
    } catch (err) {
      pipe = null
      parentPort!.postMessage({ id: m.id, ok: false, error: String((err as Error)?.message ?? err) })
    }
  })
})
