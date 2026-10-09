import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { createEmbedder, createReranker } from '../lib/ai/rag/providers'
import { ragConfig } from '../lib/ai/rag/config'

function syntheticKey(t: TestContext) {
  const previous = process.env.OPENAI_API_KEY
  process.env.OPENAI_API_KEY = 'synthetic-key-for-mocked-fetch-only'
  t.after(() => {
    if (previous === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = previous
  })
}

test('embedding HTTP adapter validates count, indices, dimensions and finite nonzero vectors', async (t) => {
  syntheticKey(t)
  const options = { ...ragConfig(), dimensions: 3 }
  const embed = createEmbedder(options)
  const valid = {
    data: [
      { index: 1, embedding: [0, 4, 0] },
      { index: 0, embedding: [3, 0, 0] },
    ],
    usage: { total_tokens: 8 },
  }
  let body: unknown = valid
  t.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    assert.equal(input, 'https://api.openai.com/v1/embeddings')
    assert.equal(init.redirect, 'error')
    assert.deepEqual(JSON.parse(String(init.body)).input, ['first', 'second'])
    return Response.json(body)
  })
  const result = await embed(['first', 'second'])
  assert.deepEqual(result.vectors, [
    [1, 0, 0],
    [0, 1, 0],
  ])
  assert.equal(result.tokens, 8)
  assert.equal(result.costUsd, (8 * options.embeddingPrice) / 1_000_000)
  const malformed = [
    { ...valid, data: valid.data.slice(0, 1) },
    { ...valid, data: [valid.data[0], valid.data[0]] },
    { ...valid, data: [{ index: 2, embedding: [1, 0, 0] }, valid.data[1]] },
    { ...valid, data: [{ index: 1, embedding: [1, 0] }, valid.data[1]] },
    { ...valid, data: [{ index: 1, embedding: [0, 0, 0] }, valid.data[1]] },
    { ...valid, data: [{ index: 1, embedding: [null, 1, 0] }, valid.data[1]] },
    { ...valid, usage: { total_tokens: -1 } },
  ]
  for (const invalid of malformed) {
    body = invalid
    await assert.rejects(() => embed(['first', 'second']))
  }
})

test('rerank HTTP adapter rejects missing, duplicate, invalid indices and invalid scores', async (t) => {
  const options = {
    ...ragConfig(),
    rerankProvider: 'bge',
    rerankUrl: 'https://reranker.example/rerank',
  }
  const rerank = createReranker(options)
  const valid = [
    { index: 1, relevance_score: 0.9 },
    { index: 0, relevance_score: 0.2 },
  ]
  let results: unknown = valid
  t.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    assert.equal(input, options.rerankUrl)
    assert.equal(init.redirect, 'error')
    const body = JSON.parse(String(init.body))
    assert.equal(body.query, 'original question')
    assert.deepEqual(body.documents, ['first', 'second'])
    return Response.json({ results })
  })
  assert.deepEqual((await rerank('original question', ['first', 'second'], 2)).indices, [1, 0])
  const malformed = [
    valid.slice(0, 1),
    [valid[0], valid[0]],
    [{ index: 2, relevance_score: 0.9 }, valid[1]],
    [{ index: 0.5, relevance_score: 0.9 }, valid[1]],
    [{ index: -1, relevance_score: 0.9 }, valid[1]],
    [{ index: 1, relevance_score: null }, valid[1]],
  ]
  for (const invalid of malformed) {
    results = invalid
    await assert.rejects(() => rerank('original question', ['first', 'second'], 2))
  }
})

test('provider failures redact response bodies and insecure rerank URLs never send requests', async (t) => {
  syntheticKey(t)
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    return new Response('PRIVATE_RESPONSE_SENTINEL', { status: 502 })
  })
  const options = {
    ...ragConfig(),
    rerankProvider: 'bge',
    rerankUrl: 'https://reranker.example/rerank',
  }
  const safeError = (error: unknown) => {
    assert.ok(error instanceof Error)
    assert.equal(error.message, 'rag_provider_http_502')
    assert.ok(!error.message.includes('PRIVATE_RESPONSE_SENTINEL'))
    return true
  }
  await assert.rejects(() => createEmbedder(options)(['first']), safeError)
  await assert.rejects(() => createReranker(options)('query', ['first'], 1), safeError)
  assert.equal(calls, 2)
  await assert.rejects(
    () =>
      createReranker({ ...options, rerankUrl: 'http://reranker.example/rerank' })(
        'query',
        ['first'],
        1
      ),
    /rag_insecure_endpoint/
  )
  assert.equal(calls, 2)
})
