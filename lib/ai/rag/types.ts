export type ClaimStatus =
  | 'reported_result'
  | 'implemented_as_stated'
  | 'proposal'
  | 'target'
  | 'example'
  | 'unresolved_conflict'
  | 'unknown'

export type SourceUnit = {
  id: string
  headingPath: string[]
  text: string
  locator?: string
  verified: boolean
  canonicalId?: string
  claimStatus?: ClaimStatus
}

export type RagDocument = {
  id: string
  title: string
  version: string
  source: 'blog' | 'private'
  url?: string
  language: string
  allowPublicAnswer: boolean
  claimStatus: ClaimStatus
  attribution: string
  aliases: string[]
  units: SourceUnit[]
}

export type ParentChunk = {
  id: string
  documentId: string
  version: string
  title: string
  headingPath: string[]
  source: 'blog' | 'private'
  url?: string
  allowPublicAnswer: boolean
  claimStatus: ClaimStatus
  attribution: string
  text: string
  tokens: number
  sourceUnitIds: string[]
}

export type ChildChunk = {
  id: string
  parentId: string
  documentId: string
  version: string
  canonicalId: string
  headingPath: string[]
  text: string
  retrievalText: string
  tokens: number
  identifiers: string[]
  sourceSpans: { unitId: string; start: number; end: number }[]
  embedding?: number[]
}

export type RagSnapshot = {
  schemaVersion: 1
  version: string
  createdAt: string
  embedding: { model: string; dimensions: number }
  documents: { id: string; version: string; allowPublicAnswer: boolean }[]
  parents: ParentChunk[]
  children: ChildChunk[]
}

export type PublicCitation = { id: string; title: string; section: string; url?: string }
export type Evidence = {
  citation: PublicCitation
  text: string
  claimStatus: ClaimStatus
  attribution: string
  childIds: string[]
}
export type RetrievalTrace = {
  indexVersion: string
  candidates: number
  selected: number
  contextTokens: number
  durationMs: number
  degraded: string[]
  embeddingTokens: number
  costUsd: number
  reranker: string
}
export type RetrievalResult = { evidence: Evidence[]; trace: RetrievalTrace }

export type EmbedResult = { vectors: number[][]; tokens: number; costUsd: number }
export type Embedder = (texts: string[], signal?: AbortSignal) => Promise<EmbedResult>
export type RerankResult = { indices: number[]; costUsd: number; model: string }
export type Reranker = (
  query: string,
  documents: string[],
  limit: number,
  signal?: AbortSignal
) => Promise<RerankResult>

export type IngestionJob = {
  id: string
  sequence: number
  status: 'queued' | 'processing' | 'ready' | 'failed' | 'superseded'
  attempts: number
  createdAt: string
  updatedAt: string
  nextAttemptAt: number
  leaseToken?: string
  leaseUntil?: number
  error?: string
  snapshotVersion?: string
  tokens?: number
  costUsd?: number
}
