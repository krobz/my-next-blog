import test from 'node:test'
import assert from 'node:assert/strict'
import { bm25, fuse, retrieveFromSnapshot } from '../lib/ai/rag/retrieval'
import { document, snapshot } from './rag-helpers'

const embed = async () => ({ vectors: [[1, 0, 0]], tokens: 4, costUsd: 0.000001 })
const rerank = async (_q: string, docs: string[], limit: number) => ({
  indices: docs.map((_, i) => i).slice(0, limit),
  model: 'test-cross-encoder',
  costUsd: 0,
})
test('exact code identifiers survive lexical recall and canonical RRF dedup', () => {
  const snap = snapshot([
    document('mysql', '# MySQL\n\ninnodb_flush_log_at_trx_commit controls commit flushing.'),
    document('other', '# Other\n\nA garden has flowers.'),
  ])
  const hits = bm25(snap.children, 'innodb_flush_log_at_trx_commit')
  assert.equal(hits[0].child.documentId, 'mysql')
  assert.equal(fuse([{ results: [hits[0], hits[0]], weight: 1 }])[0].score, 1 / 61)
})
test('original language goes to dense and rerank, lexical rewrite helps English evidence', async () => {
  const snap = snapshot()
  let embedded = '',
    ranked = ''
  const result = await retrieveFromSnapshot(snap, '如何限制并发？', {
    lexicalQuery: 'Semaphore permits',
    embed: async (texts) => {
      embedded = texts[0]
      return embed()
    },
    rerank: async (q, docs, limit) => {
      ranked = q
      return rerank(q, docs, limit)
    },
  })
  assert.equal(embedded, '如何限制并发？')
  assert.equal(ranked, embedded)
  assert.equal(result.trace.reranker, 'test-cross-encoder')
  assert.ok(result.evidence[0].text.includes('Kafka acknowledgments'))
  assert.equal(result.evidence[0].citation.url, undefined)
})
test('revoked parents do not reach providers and budget is enforced', async () => {
  const snap = snapshot()
  snap.documents[0].allowPublicAnswer = false
  const result = await retrieveFromSnapshot(snap, 'Semaphore', {
    embed: async () => {
      throw new Error('should not call')
    },
    rerank,
  })
  assert.equal(result.evidence.length, 0)
  const bounded = await retrieveFromSnapshot(snapshot(), 'Semaphore', {
    embed,
    rerank,
    contextTokens: 1,
  })
  assert.equal(bounded.evidence.length, 0)
})
test('provider failure is explicit, strict rerank policy yields no evidence', async () => {
  const failure = async () => {
    throw new Error('private provider body')
  }
  const fallback = await retrieveFromSnapshot(snapshot(), 'Semaphore', {
    embed: failure,
    rerank: failure,
  })
  assert.ok(fallback.evidence.length)
  assert.deepEqual(fallback.trace.degraded, ['embedding_unavailable', 'rerank_unavailable'])
  const strict = await retrieveFromSnapshot(snapshot(), 'Semaphore', {
    embed,
    rerank: failure,
    requireRerank: true,
  })
  assert.equal(strict.evidence.length, 0)
})
