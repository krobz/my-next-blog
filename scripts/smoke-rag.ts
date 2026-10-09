// Explicit live smoke test. Reports protocol/usage metadata, never raw source or answer text.
import { createServer } from 'node:http'
import next from 'next'
async function main() {
  process.env.RAG_ENABLED = 'true'
  process.env.RAG_STORE = 'local'
  const question = process.argv[2]
  if (!question) throw new Error('smoke_question_required')
  const app = next({ dev: true, hostname: '127.0.0.1', port: 3217 })
  await app.prepare()
  const server = createServer(app.getRequestHandler())
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(3217, '127.0.0.1', resolve)
  })
  try {
    const response = await fetch('http://127.0.0.1:3217/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ id: 'smoke-user', role: 'user', parts: [{ type: 'text', text: question }] }],
      }),
      signal: AbortSignal.timeout(90000),
    })
    const body = await response.text()
    const events = body
      .split('\n')
      .filter((line) => line.startsWith('data: ') && !line.includes('[DONE]'))
      .map((line) => JSON.parse(line.slice(6)))
    const text = events
      .filter((e) => e.type === 'text-delta')
      .map((e) => e.delta)
      .join('')
    const citations = events.find((e) => e.type === 'data-citations')?.data ?? []
    const error = events.some((e) => e.type === 'error')
    const leak =
      /tool-searchKnowledge|retrievalText|sourceSpans|source_file|leaseToken|C:\\\\|reasoning-delta/.test(
        body
      )
    const result = {
      httpStatus: response.status,
      completed: events.some((e) => e.type === 'finish'),
      error,
      answerCharacters: text.length,
      citationCount: citations.length,
      usedCitation: /\[S\d+\]/.test(text),
      privateProtocolLeak: leak,
      retrieval: events.find((e) => e.type === 'data-retrieval')?.data,
      usage: events.find((e) => e.type === 'finish')?.messageMetadata,
    }
    console.log(JSON.stringify(result, null, 2))
    if (
      !response.ok ||
      error ||
      leak ||
      !text ||
      !result.completed ||
      !result.citationCount ||
      !result.usedCitation
    )
      process.exitCode = 1
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await app.close()
  }
}
main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    console.error(JSON.stringify({ error: 'rag_live_smoke_failed', type: error?.name }))
    process.exit(1)
  })
