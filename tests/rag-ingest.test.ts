import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRagStore, RagStore } from '../lib/ai/rag/store'
import { runIngestion } from '../lib/ai/rag/ingest'
import { publishPreparedSnapshot } from '../lib/ai/rag/publish'
import { document, snapshot } from './rag-helpers'

const embedding = { model: 'test', dimensions: 3 }
const mockEmbed = async (texts: string[]) => ({
  vectors: texts.map(() => [1, 0, 0]),
  tokens: texts.length,
  costUsd: 0.000001,
})
async function fixture(t: TestContext, now?: () => number) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-test-'))
  t.after(async () => {
    const resolved = path.resolve(directory)
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep + 'rag-test-'))
    await fs.rm(resolved, { recursive: true, force: true })
  })
  return { directory, store: createRagStore({ directory, now, leaseMs: 1000 }) }
}
test('enqueue is idempotent, ready snapshot is atomic, embeddings are reused', async (t) => {
  const { store } = await fixture(t)
  const docs = [document()]
  const first = await store.enqueue(docs, embedding)
  assert.equal((await store.enqueue(docs, embedding)).id, first.id)
  assert.equal(await store.loadActive(), null)
  let calls = 0
  await runIngestion(store, {
    embedding,
    embed: async (texts) => {
      calls++
      return mockEmbed(texts)
    },
  })
  assert.ok((await store.loadActive())?.children.length)
  await store.enqueue(docs, embedding, { force: true })
  await runIngestion(store, {
    embedding,
    embed: async () => {
      throw new Error('cached; must not call')
    },
  })
  assert.equal(calls, 1)
  assert.equal((await store.status()).at(-1)?.status, 'ready')
})
test('expired lease can retry; stale worker cannot publish over a newer job', async (t) => {
  let clock = 1000
  const { store } = await fixture(t, () => clock)
  await store.enqueue([document()], embedding)
  const old = await store.claim()
  clock += 2000
  const retry = await store.claim()
  assert.notEqual(old!.job.leaseToken, retry!.job.leaseToken)
  assert.equal(await store.publish(old!.job, snapshot(), { tokens: 0, costUsd: 0 }), false)
  await store.enqueue([document('new')], embedding)
  assert.equal(await store.publish(retry!.job, snapshot(), { tokens: 0, costUsd: 0 }), false)
})
test('failure retries and authorization withdrawals mask old snapshots across instances', async (t) => {
  let clock = 1000
  const { store, directory } = await fixture(t, () => clock)
  await store.enqueue([document()], embedding)
  await runIngestion(store, {
    embedding,
    embed: async () => {
      throw new Error('SECRET must never be persisted')
    },
  })
  assert.equal((await store.status())[0].error, 'rag_ingestion_failed')
  clock += 10000
  await runIngestion(store, { embed: mockEmbed, embedding })
  const other = createRagStore({ directory, now: () => clock })
  await other.enqueue([document('replacement')], embedding)
  assert.equal((await store.loadActive())?.children.length, 0)
})
test('concurrent consumers get a single lease and explicit revoke is immediate', async (t) => {
  const { store, directory } = await fixture(t)
  await store.enqueue([document()], embedding)
  const other = createRagStore({ directory })
  const claimed = await Promise.all([store.claim(), other.claim()])
  assert.equal(claimed.filter(Boolean).length, 1)
  await store.publish(claimed.find(Boolean)!.job, snapshot(), { tokens: 0, costUsd: 0 })
  await other.revoke('sample')
  assert.equal((await store.loadActive())?.children.length, 0)
})

test('idle polls do not create revisions and a mismatched worker cannot call the provider', async (t) => {
  const { store, directory } = await fixture(t)
  await store.enqueue([document()], embedding)
  await runIngestion(store, {
    embedding: { model: 'different', dimensions: 3 },
    embed: async () => {
      throw new Error('provider must not be called')
    },
  })
  assert.equal((await store.status())[0].error, 'rag_worker_embedding_mismatch')
  const before = await fs.readdir(path.join(directory, 'revisions'))
  await store.claim()
  await store.claim()
  assert.deepEqual(await fs.readdir(path.join(directory, 'revisions')), before)
})

test('a worker that crashes on its final attempt becomes visibly failed', async (t) => {
  let clock = 1000
  const { store } = await fixture(t, () => clock)
  await store.enqueue([document()], embedding)
  for (let attempt = 0; attempt < 5; attempt++) {
    assert.ok(await store.claim())
    clock += 2000
  }
  assert.equal(await store.claim(), null)
  assert.equal((await store.status())[0].error, 'rag_retry_exhausted')
})

test('prepared publication reuses vectors, verifies source versions, and warms the destination cache', async (t) => {
  const source = await fixture(t)
  const destination = await fixture(t)
  const documents = [document()]
  await source.store.enqueue(documents, embedding)
  await runIngestion(source.store, { embedding, embed: mockEmbed })
  const prepared = (await source.store.loadActive())!
  await assert.rejects(
    () => publishPreparedSnapshot(destination.store, prepared, [document('other')]),
    /rag_local_snapshot_source_mismatch/
  )
  assert.equal((await destination.store.status()).length, 0)
  const result = await publishPreparedSnapshot(destination.store, prepared, documents)
  assert.equal(result.status, 'ready')
  assert.equal(result.costUsd, 0)
  assert.equal((await destination.store.loadActive())?.children.length, prepared.children.length)
  await destination.store.enqueue(documents, embedding, { force: true })
  const rebuilt = await runIngestion(destination.store, {
    embedding,
    embed: async () => {
      throw new Error('must use published cached vectors')
    },
  })
  assert.equal(rebuilt?.status, 'ready')
})

test('compressed snapshot writes renew leases across batches and restore float32 vectors', async () => {
  let clock = 1000
  const objects = new Map<string, string>()
  let state = { revision: 0, sequence: 0, revoked: [], jobs: [] } as Awaited<
    ReturnType<ConstructorParameters<typeof RagStore>[0]['readState']>
  >
  const backend: ConstructorParameters<typeof RagStore>[0] = {
    readState: async () => structuredClone(state),
    cas: async (before, after) => {
      if (state.revision !== before.revision) return false
      state = structuredClone(after)
      return true
    },
    put: async (key, value) => {
      if (!objects.has(key)) objects.set(key, value)
    },
    get: async (key) => objects.get(key) ?? null,
    putMany: async (entries) => {
      clock += 700
      for (const [key, value] of entries) if (!objects.has(key)) objects.set(key, value)
    },
    getMany: async (keys) => keys.map((key) => objects.get(key) ?? null),
  }
  const store = new RagStore(backend, 1000, () => clock)
  await store.enqueue([document()], { model: 'test', dimensions: 3072 })
  const claimed = await store.claim()
  const payload = snapshot()
  payload.embedding.dimensions = 3072
  let seed = 12
  payload.children = Array.from({ length: 120 }, (_, i) => {
    const vector = Array.from({ length: 3072 }, () => {
      seed = (Math.imul(1664525, seed) + 1013904223) >>> 0
      return seed / 4294967296 - 0.5
    })
    const norm = Math.hypot(...vector)
    return { ...payload.children[0], id: `child-${i}`, embedding: vector.map((v) => v / norm) }
  })
  const started = clock
  assert.ok(await store.publish(claimed!.job, payload, { tokens: 1, costUsd: 0 }))
  assert.ok(clock - started > 1000, 'publication takes longer than one lease')
  const loaded = await store.loadActive()
  assert.equal(loaded?.children.length, 120)
  assert.ok(Math.abs(loaded!.children[0].embedding![0] - payload.children[0].embedding![0]) < 1e-8)
})
