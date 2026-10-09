import { countTokens } from './chunking'
import { ragConfig } from './config'
import { createEmbedder, createReranker } from './providers'
import { createRagStore } from './store'
import type {
  ChildChunk,
  Embedder,
  Evidence,
  RagSnapshot,
  Reranker,
  RetrievalResult,
} from './types'

const STOP = new Set(
  'a an the and or of to in is are was for with how what why does do he his this that'.split(' ')
)
export function lexicalTokens(text: string): string[] {
  const expanded = text.replace(/([a-z])([A-Z])/g, '$1 $2')
  const words =
    (text + ' ' + expanded)
      .toLowerCase()
      .match(/@[a-z][\w.]*|\/[a-z][\w/-]+|[a-z0-9]+(?:_[a-z0-9]+)*|[\u3400-\u9fff]+/g) ?? []
  return words.flatMap((word) => {
    if (/^[\u3400-\u9fff]/.test(word))
      return word.length === 1
        ? [word]
        : Array.from({ length: word.length - 1 }, (_, i) => word.slice(i, i + 2))
    return STOP.has(word) ? [] : [word]
  })
}
type Ranked = { child: ChildChunk; score: number }
export function bm25(children: ChildChunk[], query: string, limit = 40): Ranked[] {
  const tokens = [...new Set(lexicalTokens(query))]
  const terms = children.map((c) => lexicalTokens(c.retrievalText))
  const avg = terms.reduce((sum, t) => sum + t.length, 0) / Math.max(1, children.length)
  const df = new Map(tokens.map((t) => [t, terms.filter((words) => words.includes(t)).length]))
  return children
    .map((child, i) => {
      let score = 0
      for (const t of tokens) {
        const tf = terms[i].filter((word) => word === t).length
        const n = df.get(t) ?? 0
        if (tf)
          score +=
            (Math.log(1 + (children.length - n + 0.5) / (n + 0.5)) * tf * 2.2) /
            (tf + 1.2 * (0.25 + (0.75 * terms[i].length) / Math.max(1, avg)))
      }
      return { child, score }
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.child.id.localeCompare(b.child.id))
    .slice(0, limit)
}

export function fuse(routes: { results: Ranked[]; weight: number }[], limit = 50): Ranked[] {
  const all = new Map<string, Ranked>()
  for (const route of routes) {
    const seen = new Set<string>()
    for (const [rank, hit] of route.results.entries()) {
      if (seen.has(hit.child.canonicalId)) continue
      seen.add(hit.child.canonicalId)
      const previous = all.get(hit.child.canonicalId)
      all.set(hit.child.canonicalId, {
        child: previous?.child ?? hit.child,
        score: (previous?.score ?? 0) + route.weight / (60 + rank + 1),
      })
    }
  }
  return [...all.values()]
    .sort((a, b) => b.score - a.score || a.child.id.localeCompare(b.child.id))
    .slice(0, limit)
}

export async function retrieveFromSnapshot(
  snapshot: RagSnapshot,
  query: string,
  options: {
    lexicalQuery?: string
    embed: Embedder
    rerank: Reranker
    signal?: AbortSignal
    requireRerank?: boolean
    contextTokens?: number
    expandParents?: boolean
    onRanking?: (candidates: ChildChunk[], selected: ChildChunk[]) => void
  }
): Promise<RetrievalResult> {
  const start = Date.now(),
    config = ragConfig(),
    degraded: string[] = []
  const docEligibility = new Map(snapshot.documents.map((d) => [d.id, d]))
  const parents = new Map(
    snapshot.parents
      .filter(
        (p) =>
          p.allowPublicAnswer &&
          docEligibility.get(p.documentId)?.allowPublicAnswer &&
          p.version === docEligibility.get(p.documentId)?.version
      )
      .map((p) => [p.id, p])
  )
  const children = snapshot.children.filter(
    (c) =>
      parents.get(c.parentId)?.version === c.version &&
      parents.get(c.parentId)?.documentId === c.documentId
  )
  const lexical = fuse(
    [
      { results: bm25(children, query), weight: 1 },
      ...(options.lexicalQuery
        ? [{ results: bm25(children, options.lexicalQuery), weight: 1 }]
        : []),
    ],
    config.branchLimit
  )
  const normalized = query.toLowerCase()
  const matchesIdentifier = (id: string) => {
    if (id.length < 2) return false
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(^|[^a-z0-9_])${escaped}($|[^a-z0-9_])`, 'i').test(normalized)
  }
  const exact = children
    .map((child) => ({
      child,
      score: child.identifiers.filter(matchesIdentifier).length,
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
  let dense: Ranked[] = [],
    embeddingTokens = 0,
    costUsd = 0
  if (children.length) {
    try {
      const embedded = await options.embed([query], options.signal)
      embeddingTokens = embedded.tokens
      costUsd += embedded.costUsd
      const vector = embedded.vectors[0]
      if (vector.length !== snapshot.embedding.dimensions) throw new Error('rag_dimension_mismatch')
      dense = children
        .filter((c) => c.embedding?.length === vector.length)
        .map((child) => ({
          child,
          score: child.embedding!.reduce((sum, x, i) => sum + x * vector[i], 0),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, config.branchLimit)
    } catch {
      options.signal?.throwIfAborted()
      degraded.push('embedding_unavailable')
    }
  }
  const candidates = fuse(
    [
      { results: dense, weight: 1 },
      { results: lexical, weight: 1 },
      { results: exact, weight: 0.5 },
    ],
    config.candidateLimit
  )
  let selected = candidates.slice(0, config.topK),
    reranker = 'fusion-only'
  if (candidates.length) {
    try {
      const result = await options.rerank(
        query,
        candidates.map((c) => c.child.retrievalText),
        config.topK,
        options.signal
      )
      if (
        new Set(result.indices).size !== result.indices.length ||
        result.indices.some((i) => !Number.isInteger(i) || i < 0 || i >= candidates.length) ||
        result.indices.length !== Math.min(config.topK, candidates.length)
      )
        throw new Error('rag_invalid_ranking')
      selected = result.indices.map((i) => candidates[i])
      costUsd += result.costUsd
      reranker = result.model
    } catch {
      options.signal?.throwIfAborted()
      degraded.push('rerank_unavailable')
      if (options.requireRerank) selected = []
    }
  }
  options.onRanking?.(
    candidates.map((c) => c.child),
    selected.map((c) => c.child)
  )
  const evidence: Evidence[] = [],
    seen = new Set<string>()
  let contextTokens = 0
  for (const hit of selected) {
    const parent = parents.get(hit.child.parentId)!
    if (seen.has(parent.id)) continue
    const text = options.expandParents === false ? hit.child.text : parent.text
    const citation = {
      id: `S${evidence.length + 1}`,
      title: parent.title,
      section: parent.headingPath.join(' > '),
      ...(parent.source === 'blog' && parent.url?.startsWith('/blog/') ? { url: parent.url } : {}),
    }
    const tokens = countTokens(
      JSON.stringify({
        citation,
        text,
        claimStatus: parent.claimStatus,
        attribution: parent.attribution,
      })
    )
    if (contextTokens + tokens > (options.contextTokens ?? config.contextTokens)) continue
    evidence.push({
      citation,
      text,
      claimStatus: parent.claimStatus,
      attribution: parent.attribution,
      childIds: selected.filter((s) => s.child.parentId === parent.id).map((s) => s.child.id),
    })
    contextTokens += tokens
    seen.add(parent.id)
    if (evidence.length >= config.maxParents) break
  }
  return {
    evidence,
    trace: {
      indexVersion: snapshot.version,
      candidates: candidates.length,
      selected: evidence.length,
      contextTokens,
      durationMs: Date.now() - start,
      degraded,
      embeddingTokens,
      costUsd,
      reranker,
    },
  }
}

let store: ReturnType<typeof createRagStore> | undefined
export async function retrieveKnowledge(
  query: string,
  options: { lexicalQuery?: string; signal?: AbortSignal } = {}
): Promise<RetrievalResult> {
  const startedAt = Date.now()
  const config = ragConfig()
  store ??= createRagStore()
  const snapshot = await store.loadActive()
  if (!snapshot) throw new Error('rag_index_not_ready')
  if (
    snapshot.embedding.model !== config.model ||
    snapshot.embedding.dimensions !== config.dimensions
  )
    throw new Error('rag_index_config_mismatch')
  const result = await retrieveFromSnapshot(snapshot, query, {
    ...options,
    embed: createEmbedder(config),
    rerank: createReranker(config),
    requireRerank: config.requireRerank,
  })
  result.trace.durationMs = Date.now() - startedAt
  return result
}
