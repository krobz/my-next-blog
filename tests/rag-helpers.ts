import type { RagDocument, RagSnapshot } from '../lib/ai/rag/types'
import { buildChunks } from '../lib/ai/rag/chunking'
export const document = (
  id = 'sample',
  text = '# Recovery\n\nSemaphore permits bound in-flight tasks. Kafka acknowledgments release permits.'
): RagDocument => ({
  id,
  title: 'Synthetic sample',
  version: text,
  source: 'private',
  language: 'en',
  allowPublicAnswer: true,
  claimStatus: 'reported_result',
  attribution: 'Synthetic fixture.',
  aliases: [id],
  units: [{ id: 'unit', headingPath: [], text, verified: true }],
})
export function snapshot(documents = [document()]): RagSnapshot {
  const chunks = buildChunks(documents)
  return {
    schemaVersion: 1,
    version: 'fixture-v1',
    createdAt: '2026-01-01',
    embedding: { model: 'test', dimensions: 3 },
    documents: documents.map((d) => ({
      id: d.id,
      version: d.version,
      allowPublicAnswer: d.allowPublicAnswer,
    })),
    ...chunks,
    children: chunks.children.map((c) => ({ ...c, embedding: [1, 0, 0] })),
  }
}
