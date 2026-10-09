import { createHash, timingSafeEqual } from 'node:crypto'
import { createRagStore } from '@/lib/ai/rag/store'
import { createEmbedder } from '@/lib/ai/rag/providers'
import { ragConfig } from '@/lib/ai/rag/config'
import { runIngestion } from '@/lib/ai/rag/ingest'

export const maxDuration = 60
export async function POST(req: Request) {
  const secret = process.env.RAG_WORKER_TOKEN
  const given = req.headers.get('authorization') ?? ''
  if (
    !secret ||
    secret.length < 32 ||
    !timingSafeEqual(
      createHash('sha256').update(given).digest(),
      createHash('sha256').update(`Bearer ${secret}`).digest()
    )
  )
    return new Response(null, { status: 401 })
  try {
    const config = ragConfig()
    const result = await runIngestion(createRagStore(), {
      embed: createEmbedder(config),
      embedding: { model: config.model, dimensions: config.dimensions },
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(45000)]),
      maxCostUsd: 0.25,
      usdPerMillion: config.embeddingPrice,
    })
    return Response.json(
      result
        ? { id: result.id, status: result.status, tokens: result.tokens, costUsd: result.costUsd }
        : { status: 'idle' }
    )
  } catch {
    return Response.json({ error: 'Worker temporarily unavailable.' }, { status: 503 })
  }
}
