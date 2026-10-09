import { promises as fs } from 'node:fs'
import { createRagStore } from '../lib/ai/rag/store'
import { bm25, retrieveFromSnapshot } from '../lib/ai/rag/retrieval'
import { createEmbedder, createReranker } from '../lib/ai/rag/providers'
import { evalCaseSchema, evidenceMetrics } from '../lib/ai/rag/eval'
import { ragConfig } from '../lib/ai/rag/config'
import type { ChildChunk } from '../lib/ai/rag/types'

const args = process.argv.slice(2)
const value = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i < 0 ? undefined : args[i + 1]
}
async function main() {
  const file = value('dataset')
  if (!file) {
    console.log('Usage: npm run test:eval -- --dataset <private JSONL> [--live --rerank]')
    return
  }
  const cases = (await fs.readFile(file, 'utf8'))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => evalCaseSchema.parse(JSON.parse(line)))
  if (cases.length > 120) throw new Error('eval_limit_120_queries')
  const snapshot = await createRagStore().loadActive()
  if (!snapshot) throw new Error('eval_index_not_ready')
  const config = ragConfig()
  if (
    args.includes('--live') &&
    (snapshot.embedding.model !== config.model ||
      snapshot.embedding.dimensions !== config.dimensions)
  )
    throw new Error('eval_index_config_mismatch')
  const results: unknown[] = []
  let costUsd = 0
  for (const item of cases) {
    let candidates: ChildChunk[],
      selected: ChildChunk[],
      degraded: string[] = []
    if (!args.includes('--live')) {
      candidates = bm25(snapshot.children, item.query, 50).map((h) => h.child)
      selected = candidates.slice(0, 8)
    } else {
      if (costUsd >= 0.1) throw new Error('eval_budget_exceeded')
      candidates = []
      selected = []
      const result = await retrieveFromSnapshot(snapshot, item.query, {
        embed: createEmbedder(config),
        rerank: args.includes('--rerank')
          ? createReranker(config)
          : async (_q, docs, k) => ({
              indices: docs.slice(0, k).map((_, i) => i),
              model: 'fusion-only',
              costUsd: 0,
            }),
        onRanking: (pool, ranking) => {
          candidates = pool
          selected = ranking
        },
      })
      costUsd += result.trace.costUsd
      degraded = result.trace.degraded
    }
    results.push({
      id: item.id,
      intentGroupId: item.intentGroupId,
      language: item.language,
      recall50: evidenceMetrics(item, candidates!, 50),
      ranking8: evidenceMetrics(item, selected!, 8),
      degraded,
    })
  }
  console.log(
    JSON.stringify(
      {
        mode: args.includes('--live')
          ? args.includes('--rerank')
            ? 'hybrid-rerank'
            : 'hybrid'
          : 'bm25',
        indexVersion: snapshot.version,
        queries: cases.length,
        costUsd,
        results,
      },
      null,
      2
    )
  )
}
main().catch((error) => {
  console.error(
    error instanceof Error && /^eval_/.test(error.message)
      ? error.message
      : 'Invalid dataset or evaluation failure; no source text logged.'
  )
  process.exitCode = 1
})
