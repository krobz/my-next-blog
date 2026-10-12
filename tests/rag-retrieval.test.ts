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
test('work scope filters a dominant side-project corpus before reranking and parent expansion', async () => {
  const snap = snapshot([
    document('es', '# Elasticsearch\n\nParallel scans and bulk indexing support migrations.'),
    document('dtcc', '# DTCC\n\nA Semaphore bounds Kafka tasks.'),
    document('ebm', '# Revoked work\n\nThis project must not reach the provider.'),
    document('datagate', '# Stale work\n\nThis project has been superseded.'),
    ...Array.from({ length: 10 }, (_, i) =>
      document(`trpg-part-${i}`, `# TRPGHub\n\nTRPGHub marketplace feature ${i}.`)
    ),
  ])
  snap.documents.find((d) => d.id === 'ebm')!.allowPublicAnswer = false
  snap.documents.find((d) => d.id === 'datagate')!.version = 'new-version'
  for (const child of snap.children)
    if (!child.documentId.startsWith('trpg-')) child.embedding = [0, 1, 0]
  const unrestricted = await retrieveFromSnapshot(snap, 'TRPGHub marketplace', { embed, rerank })
  assert.ok(unrestricted.evidence.every((e) => e.text.includes('TRPGHub')))
  const providerDocuments: string[] = []
  let candidateIds: string[] = []
  const scoped = await retrieveFromSnapshot(snap, 'TRPGHub marketplace', {
    scope: 'work',
    embed,
    rerank: async (q, docs, limit) => {
      providerDocuments.push(...docs)
      return rerank(q, docs, limit)
    },
    onRanking: (candidates) => {
      candidateIds = candidates.map((c) => c.documentId)
    },
  })
  assert.deepEqual(candidateIds.sort(), ['dtcc', 'es'])
  assert.equal(providerDocuments.length, 2)
  assert.ok(providerDocuments.every((text) => !/TRPGHub|Revoked|Stale/.test(text)))
  assert.equal(scoped.evidence.length, 2)
  assert.ok(scoped.evidence.every((e) => /Parallel scans|Semaphore/.test(e.text)))
})
test('side-project scope includes its public authorship post and excludes unrelated sources', async () => {
  const trpgPost = {
    ...document(
      'blog-more-than-vibe-coding-why-my-app-never-made-it-to-launch',
      '# TRPGHub post\n\nI owned engineering and infrastructure.'
    ),
    source: 'blog' as const,
    url: '/blog/more-than-vibe-coding-why-my-app-never-made-it-to-launch',
  }
  const snap = snapshot([
    document('trpg-architecture', '# TRPGHub architecture\n\nA mobile marketplace.'),
    trpgPost,
    document('es', '# Work\n\nElasticsearch migration.'),
    document('unrelated', '# Other\n\nAn unrelated project.'),
    { ...document('trpg-unrelated-blog', '# Unrelated blog\n\nOther writing.'), source: 'blog' },
    document('trpg-revoked', '# Revoked\n\nThis project is no longer approved.'),
  ])
  snap.documents.find((d) => d.id === 'trpg-revoked')!.allowPublicAnswer = false
  let providerDocuments: string[] = []
  const result = await retrieveFromSnapshot(snap, 'What has krob built?', {
    scope: 'side_project',
    embed,
    rerank: async (q, docs, limit) => {
      providerDocuments = docs
      return rerank(q, docs, limit)
    },
  })
  assert.equal(providerDocuments.length, 2)
  assert.ok(providerDocuments.every((text) => text.includes('TRPGHub')))
  assert.equal(result.evidence.length, 2)
  assert.ok(result.evidence.some((e) => e.citation.url === trpgPost.url))
})
test('a scope with no eligible documents calls neither retrieval provider', async () => {
  const snap = snapshot([document('dtcc'), document('trpg-architecture')])
  snap.documents.find((d) => d.id === 'dtcc')!.allowPublicAnswer = false
  let providerCalls = 0
  const result = await retrieveFromSnapshot(snap, 'DTCC Semaphore', {
    scope: 'work',
    embed: async () => {
      providerCalls++
      return embed()
    },
    rerank: async (q, docs, limit) => {
      providerCalls++
      return rerank(q, docs, limit)
    },
  })
  assert.equal(providerCalls, 0)
  assert.equal(result.evidence.length, 0)
})
