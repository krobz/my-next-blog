import { buildChunks, countTokens, digest, PIPELINE_VERSION } from './chunking'
import type { RagStore } from './store'
import type { Embedder, RagSnapshot } from './types'

export async function runIngestion(
  store: RagStore,
  options: {
    embed: Embedder
    embedding: RagSnapshot['embedding']
    signal?: AbortSignal
    maxCostUsd?: number
    usdPerMillion?: number
  }
) {
  const claimed = await store.claim()
  if (!claimed) return null
  const { job, documents, embedding } = claimed
  let tokens = 0,
    costUsd = 0
  try {
    if (
      embedding.model !== options.embedding.model ||
      embedding.dimensions !== options.embedding.dimensions
    )
      throw new Error('rag_worker_embedding_mismatch')
    const { parents, children } = buildChunks(documents)
    const price = options.usdPerMillion ?? 0.13
    const budget = options.maxCostUsd ?? 0.25
    const cacheKey = (text: string) => digest(JSON.stringify({ embedding, text }))
    for (let i = 0; i < children.length; i += 20) {
      options.signal?.throwIfAborted()
      if (!(await store.heartbeat(job))) throw new Error('rag_job_superseded')
      const batch = children.slice(i, i + 20)
      const cached = await store.getEmbeddings(batch.map((child) => cacheKey(child.retrievalText)))
      batch.forEach((child, index) => {
        const vector = cached[index]
        if (
          vector?.length === embedding.dimensions &&
          vector.every(Number.isFinite) &&
          Math.abs(Math.hypot(...vector) - 1) < 0.01
        )
          child.embedding = vector
      })
    }
    const missing = children.filter((c) => !c.embedding)
    const estimate =
      (missing.reduce((sum, c) => sum + countTokens(c.retrievalText), 0) * price) / 1_000_000
    if (estimate > budget) throw new Error('rag_ingestion_budget_exceeded')
    for (let i = 0; i < missing.length; i += 32) {
      options.signal?.throwIfAborted()
      if (!(await store.heartbeat(job))) throw new Error('rag_job_superseded')
      const batch = missing.slice(i, i + 32)
      const result = await options.embed(
        batch.map((c) => c.retrievalText),
        options.signal
      )
      tokens += result.tokens
      costUsd += result.costUsd
      if (result.vectors.length !== batch.length) throw new Error('rag_embedding_count_mismatch')
      for (let offset = 0; offset < batch.length; offset++) {
        const vector = result.vectors[offset]
        if (
          vector.length !== embedding.dimensions ||
          vector.some((v) => !Number.isFinite(v)) ||
          !Math.hypot(...vector)
        )
          throw new Error('rag_invalid_embedding_response')
        const norm = Math.hypot(...vector)
        batch[offset].embedding = vector.map((v) => v / norm)
      }
      options.signal?.throwIfAborted()
      if (!(await store.heartbeat(job))) throw new Error('rag_job_superseded')
      await store.putEmbeddings(
        batch.map((child) => [cacheKey(child.retrievalText), child.embedding!])
      )
      if (costUsd > budget) throw new Error('rag_ingestion_budget_exceeded')
    }
    if (!(await store.heartbeat(job))) throw new Error('rag_job_superseded')
    const snapshot: RagSnapshot = {
      schemaVersion: 1,
      version: digest(`${job.id}:${PIPELINE_VERSION}`),
      createdAt: new Date().toISOString(),
      embedding,
      documents: documents.map((d) => ({
        id: d.id,
        version: d.version,
        allowPublicAnswer: d.allowPublicAnswer,
      })),
      parents,
      children,
    }
    const published = await store.publish(job, snapshot, { tokens, costUsd }, options.signal)
    return (
      (await store.status()).find((item) => item.id === job.id) ?? {
        ...job,
        status: published ? ('ready' as const) : ('superseded' as const),
        snapshotVersion: snapshot.version,
        tokens,
        costUsd,
      }
    )
  } catch (error) {
    await store.fail(job, error instanceof Error ? error.message : 'rag_ingestion_failed', {
      tokens,
      costUsd,
    })
    return (await store.status()).find((j) => j.id === job.id) ?? null
  }
}
