import test from 'node:test'
import assert from 'node:assert/strict'
import { createUIMessageStreamResponse, type UIMessageChunk } from 'ai'
import { publicStream } from '../lib/ai/rag/public-stream'

test('actual serialized SSE contains only allowed fields, no private tool or provider payloads', async () => {
  const secret = 'PRIVATE_SENTINEL_X9'
  const input = [
    { type: 'start', messageId: secret, messageMetadata: { secret } },
    { type: 'reasoning-delta', id: 'r', delta: secret },
    { type: 'tool-input-start', toolCallId: 'private', toolName: 'searchKnowledge', title: secret },
    { type: 'tool-input-delta', toolCallId: 'private', inputTextDelta: secret },
    {
      type: 'tool-input-available',
      toolCallId: 'private',
      toolName: 'searchKnowledge',
      input: secret,
    },
    { type: 'tool-output-available', toolCallId: 'private', output: { evidence: secret } },
    { type: 'tool-output-error', toolCallId: 'private', errorText: secret, providerExecuted: true },
    {
      type: 'source-document',
      sourceId: 'a',
      mediaType: 'text/plain',
      title: secret,
      filename: secret,
    },
    { type: 'tool-input-available', toolCallId: secret, toolName: 'showPosts', input: secret },
    {
      type: 'tool-output-available',
      toolCallId: secret,
      output: { posts: [], injected: secret },
      providerMetadata: { secret },
    },
    { type: 'text-start', id: 't', providerMetadata: { secret } },
    { type: 'text-delta', id: 't', delta: 'Supported [S', providerMetadata: { secret } },
    { type: 'text-delta', id: 't', delta: '1] unsupported [S99]' },
    { type: 'text-end', id: 't' },
    { type: 'finish', messageMetadata: { secret, durationMs: 20, totalTokens: 50 } },
  ] as unknown as UIMessageChunk[]
  const stream = new ReadableStream<UIMessageChunk>({
    start(c) {
      input.forEach((p) => c.enqueue(p))
      c.close()
    },
  }).pipeThrough(
    publicStream({
      citations: () => [{ id: 'S1', title: 'Allowed title', section: 'Recovery' }],
      summary: () => ({
        searches: 1,
        candidates: 5,
        durationMs: 10,
        degraded: false,
        reranked: true,
      }),
      publicWidget: () => ({ posts: [] }),
    })
  )
  const sse = await createUIMessageStreamResponse({ stream }).text()
  assert.ok(!sse.includes(secret))
  assert.ok(!sse.includes('S99'))
  assert.ok(sse.includes('[S1]'))
  assert.ok(sse.includes('data-citations'))
  assert.ok(sse.includes('tool-output-available'))
  assert.ok(sse.includes('Allowed title'))
})
