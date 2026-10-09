import { promises as fs } from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import { setTimeout as sleep } from 'node:timers/promises'
import { importSourcePack, importBlogMarkdown } from '../lib/ai/rag/import'
import { buildChunks, countTokens } from '../lib/ai/rag/chunking'
import { ragConfig } from '../lib/ai/rag/config'
import { createRagStore } from '../lib/ai/rag/store'
import { runIngestion } from '../lib/ai/rag/ingest'
import { createEmbedder } from '../lib/ai/rag/providers'
import { retrieveKnowledge } from '../lib/ai/rag/retrieval'
import { publishPreparedSnapshot } from '../lib/ai/rag/publish'
import type { RagDocument } from '../lib/ai/rag/types'

const args = process.argv.slice(2)
const command = args[0] ?? 'help'
const argument = (name: string) => {
  const index = args.indexOf(`--${name}`)
  return index < 0 ? undefined : args[index + 1]
}
const config = ragConfig()
const log = (value: unknown) => process.stdout.write(JSON.stringify(value, null, 2) + '\n')
const controller = new AbortController()
process.on('SIGINT', () => controller.abort())
process.on('SIGTERM', () => controller.abort())

async function loadDocuments(): Promise<RagDocument[]> {
  const source = argument('source')
  let documents: RagDocument[] = []
  if (source) {
    const stats = await fs.stat(source)
    if (stats.size > 20_000_000) throw new Error('rag_source_too_large')
    const publicIds = (argument('public-ids') ?? '').split(',').filter(Boolean)
    documents = importSourcePack(JSON.parse(await fs.readFile(source, 'utf8')), publicIds)
  }
  if (args.includes('--blogs')) {
    async function walk(directory: string) {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name)
        if (entry.isDirectory()) await walk(file)
        else if (/\.mdx?$/.test(entry.name)) {
          const raw = await fs.readFile(file, 'utf8'),
            parsed = matter(raw)
          if (parsed.data.draft) continue
          const slug = path
            .relative('data/blog', file)
            .replace(/\\/g, '/')
            .replace(/\.mdx?$/, '')
          documents.push(
            importBlogMarkdown(slug, String(parsed.data.title ?? slug), raw, `/blog/${slug}`)
          )
        }
      }
    }
    await walk('data/blog')
  }
  if (!documents.length) throw new Error('rag_no_sources_selected')
  return documents
}

async function main() {
  if (command === 'help') {
    log({
      commands: [
        'plan --source <private JSON> --public-ids id1,id2 --blogs',
        'enqueue (same source flags)',
        'publish (same source flags; RAG_STORE=redis; reuses validated local vectors)',
        'run --max-usd 0.25',
        'worker --max-usd 0.25',
        'watch (same source flags) --max-usd 0.25',
        'status',
        'revoke --id document-id',
        'query --text question',
      ],
      storage: 'Local .rag-private by default; RAG_STORE=redis is explicit remote publishing.',
      note: 'plan performs no API calls. worker/watch persist until interrupted.',
    })
    return
  }
  const store = createRagStore()
  const maxCostUsd = Number(argument('max-usd') ?? 0.25)
  if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0) throw new Error('rag_invalid_budget')
  const run = () =>
    runIngestion(store, {
      embed: createEmbedder(config),
      embedding: { model: config.model, dimensions: config.dimensions },
      signal: controller.signal,
      maxCostUsd,
      usdPerMillion: config.embeddingPrice,
    })
  if (command === 'plan') {
    const documents = await loadDocuments(),
      chunks = buildChunks(documents)
    const tokens = chunks.children.reduce((sum, c) => sum + countTokens(c.retrievalText), 0)
    log({
      documents: documents.length,
      eligibleDocuments: documents.filter((d) => d.allowPublicAnswer).length,
      excludedUnits: documents.flatMap((d) => d.units).filter((u) => !u.verified).length,
      parents: chunks.parents.length,
      children: chunks.children.length,
      embeddingTokens: tokens,
      estimatedFullEmbeddingUsd: (tokens * config.embeddingPrice) / 1_000_000,
      model: config.model,
      dimensions: config.dimensions,
    })
  } else if (command === 'publish') {
    if (process.env.RAG_STORE !== 'redis') throw new Error('rag_publish_requires_redis')
    const local = createRagStore({
      backend: 'local',
      directory: process.env.RAG_LOCAL_DIR || path.join(process.cwd(), '.rag-private'),
    })
    const snapshot = await local.loadActive()
    if (!snapshot) throw new Error('rag_local_index_not_ready')
    if (
      snapshot.embedding.model !== config.model ||
      snapshot.embedding.dimensions !== config.dimensions
    )
      throw new Error('rag_index_config_mismatch')
    log(
      await publishPreparedSnapshot(store, snapshot, await loadDocuments(), {
        signal: controller.signal,
        force: args.includes('--force'),
      })
    )
  } else if (command === 'enqueue')
    log(
      await store.enqueue(
        await loadDocuments(),
        { model: config.model, dimensions: config.dimensions },
        { force: args.includes('--force') }
      )
    )
  else if (command === 'run') {
    const result = await run()
    log(result)
    if (result?.status === 'failed') process.exitCode = 1
  } else if (command === 'status') log(await store.status())
  else if (command === 'revoke') {
    const id = argument('id')
    if (!id) throw new Error('rag_missing_id')
    await store.revoke(id)
    log({ revoked: id })
  } else if (command === 'query') {
    const query = argument('text')
    if (!query) throw new Error('rag_missing_query')
    const result = await retrieveKnowledge(query, {
      lexicalQuery: argument('keywords'),
      signal: controller.signal,
    })
    log({ citations: result.evidence.map((e) => e.citation), trace: result.trace })
  } else if (command === 'worker' || command === 'watch') {
    while (!controller.signal.aborted) {
      if (command === 'watch')
        await store.enqueue(await loadDocuments(), {
          model: config.model,
          dimensions: config.dimensions,
        })
      const result = await run()
      if (result) log(result)
      await sleep(5000, undefined, { signal: controller.signal }).catch(() => {})
    }
  } else throw new Error('rag_unknown_command')
}
main().catch((error) => {
  log({
    error:
      error instanceof Error && /^rag_[a-z0-9_]+$/.test(error.message)
        ? error.message
        : 'rag_operation_failed',
  })
  process.exitCode = 1
})
