function positive(value: string | undefined, fallback: number) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}
export function ragConfig() {
  const model = process.env.RAG_EMBEDDING_MODEL || 'text-embedding-3-large'
  if (!['text-embedding-3-large', 'text-embedding-3-small'].includes(model))
    throw new Error('rag_unsupported_embedding_model')
  const dimensions = positive(
    process.env.RAG_EMBEDDING_DIMENSIONS,
    model.endsWith('large') ? 3072 : 1536
  )
  if (!Number.isInteger(dimensions) || dimensions > (model.endsWith('large') ? 3072 : 1536))
    throw new Error('rag_invalid_dimensions')
  return {
    enabled: process.env.RAG_ENABLED === 'true',
    model,
    dimensions,
    embeddingPrice: positive(
      process.env.RAG_EMBEDDING_USD_PER_1M,
      model.endsWith('large') ? 0.13 : 0.02
    ),
    timeoutMs: positive(process.env.RAG_TIMEOUT_MS, 8000),
    rerankProvider: process.env.RAG_RERANK_PROVIDER || 'bge',
    rerankUrl: process.env.RAG_RERANK_URL,
    rerankModel: process.env.RAG_RERANK_MODEL || 'BAAI/bge-reranker-v2-m3',
    rerankPrice: positive(process.env.RAG_RERANK_USD_PER_REQUEST, 0),
    requireRerank: process.env.RAG_REQUIRE_RERANK === 'true',
    branchLimit: 40,
    candidateLimit: 50,
    topK: 8,
    maxParents: 6,
    contextTokens: 6000,
  }
}
