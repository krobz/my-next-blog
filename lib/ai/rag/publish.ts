import { buildChunks, digest, PIPELINE_VERSION } from './chunking'
import { validateSnapshot, type RagStore } from './store'
import type { RagDocument, RagSnapshot } from './types'

// Trusted CLI publication reuses a validated local index without calling an embedding provider.
export async function publishPreparedSnapshot(
  destination: RagStore,
  snapshot: RagSnapshot,
  documents: RagDocument[],
  options: { signal?: AbortSignal; force?: boolean } = {}
) {
  validateSnapshot(snapshot)
  const expected = buildChunks(documents)
  const actualChildren = snapshot.children.map(({ embedding: _, ...child }) => child)
  if (
    JSON.stringify(expected.parents) !== JSON.stringify(snapshot.parents) ||
    JSON.stringify(expected.children) !== JSON.stringify(actualChildren)
  )
    throw new Error('rag_local_snapshot_source_mismatch')
  const queued = await destination.enqueue(documents, snapshot.embedding, { force: options.force })
  if (queued.status === 'ready') {
    if ((await destination.loadActive())?.version !== queued.snapshotVersion)
      throw new Error('rag_publication_requires_force')
    return queued
  }
  const claimed = await destination.claim()
  if (!claimed || claimed.job.id !== queued.id) throw new Error('rag_publication_busy')
  try {
    for (let i = 0; i < snapshot.children.length; i += 20) {
      options.signal?.throwIfAborted()
      if (!(await destination.heartbeat(claimed.job))) throw new Error('rag_job_superseded')
      await destination.putEmbeddings(
        snapshot.children
          .slice(i, i + 20)
          .map((child) => [
            digest(JSON.stringify({ embedding: snapshot.embedding, text: child.retrievalText })),
            child.embedding!,
          ])
      )
    }
    const published = await destination.publish(
      claimed.job,
      {
        ...snapshot,
        version: digest(`${queued.id}:${PIPELINE_VERSION}`),
      },
      { tokens: 0, costUsd: 0 },
      options.signal
    )
    if (!published) throw new Error('rag_job_superseded')
    return (await destination.status()).find((job) => job.id === queued.id)!
  } catch (error) {
    await destination.fail(
      claimed.job,
      error instanceof Error ? error.message : 'rag_publication_failed'
    )
    throw error
  }
}
