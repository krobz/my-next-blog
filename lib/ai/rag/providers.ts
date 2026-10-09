import { z } from 'zod'
import { ragConfig } from './config'
import type { Embedder, Reranker } from './types'

function signalFor(timeout: number, signal?: AbortSignal) {
  return signal
    ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
    : AbortSignal.timeout(timeout)
}
async function post(
  url: string,
  body: unknown,
  key: string | undefined,
  timeout: number,
  signal?: AbortSignal
) {
  const parsed = new URL(url)
  if (
    parsed.protocol !== 'https:' &&
    !(parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname))
  )
    throw new Error('rag_insecure_endpoint')
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify(body),
    signal: signalFor(timeout, signal),
    redirect: 'error',
  })
  // Never include provider response bodies in logs/errors: they may echo private input.
  if (!response.ok) throw new Error(`rag_provider_http_${response.status}`)
  return response.json()
}

export function createEmbedder(options = ragConfig()): Embedder {
  return async (texts, signal) => {
    if (!process.env.OPENAI_API_KEY) throw new Error('rag_embedding_not_configured')
    if (!texts.length || texts.length > 64) throw new Error('rag_invalid_embedding_batch')
    const result = z
      .object({
        data: z.array(
          z.object({
            index: z.number().int().nonnegative(),
            embedding: z.array(z.number().finite()),
          })
        ),
        usage: z.object({ total_tokens: z.number().nonnegative() }),
      })
      .parse(
        await post(
          'https://api.openai.com/v1/embeddings',
          {
            model: options.model,
            dimensions: options.dimensions,
            input: texts,
            encoding_format: 'float',
          },
          process.env.OPENAI_API_KEY,
          options.timeoutMs,
          signal
        )
      )
    if (
      result.data.length !== texts.length ||
      new Set(result.data.map((d) => d.index)).size !== texts.length
    )
      throw new Error('rag_invalid_embedding_response')
    const vectors = result.data
      .sort((a, b) => a.index - b.index)
      .map((d, i) => {
        if (d.index !== i || d.embedding.length !== options.dimensions)
          throw new Error('rag_embedding_dimension_mismatch')
        const norm = Math.hypot(...d.embedding)
        if (!norm) throw new Error('rag_zero_embedding')
        return d.embedding.map((v) => v / norm)
      })
    return {
      vectors,
      tokens: result.usage.total_tokens,
      costUsd: (result.usage.total_tokens * options.embeddingPrice) / 1_000_000,
    }
  }
}

export function createReranker(options = ragConfig()): Reranker {
  return async (query, documents, limit, signal) => {
    if (!documents.length) return { indices: [], costUsd: 0, model: 'none' }
    const cohere = options.rerankProvider === 'cohere'
    if (!cohere && options.rerankProvider !== 'bge') throw new Error('rag_rerank_not_configured')
    if ((!cohere && !options.rerankUrl) || (cohere && !process.env.COHERE_API_KEY))
      throw new Error('rag_rerank_not_configured')
    const model = cohere ? process.env.RAG_RERANK_MODEL || 'rerank-v4.0-fast' : options.rerankModel
    const result = z
      .object({
        results: z.array(
          z.object({ index: z.number().int().nonnegative(), relevance_score: z.number().finite() })
        ),
      })
      .parse(
        await post(
          cohere ? 'https://api.cohere.com/v2/rerank' : options.rerankUrl!,
          { model, query, documents, top_n: limit, return_documents: false },
          cohere ? process.env.COHERE_API_KEY : process.env.RAG_RERANK_API_KEY,
          options.timeoutMs,
          signal
        )
      )
    const indices = result.results.map((r) => r.index)
    if (
      indices.length !== Math.min(limit, documents.length) ||
      new Set(indices).size !== indices.length ||
      indices.some((i) => i >= documents.length)
    )
      throw new Error('rag_invalid_rerank_response')
    return { indices, model, costUsd: options.rerankPrice }
  }
}
