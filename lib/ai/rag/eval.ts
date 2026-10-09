import { z } from 'zod'
import type { ChildChunk } from './types'

export const evalCaseSchema = z.object({
  id: z.string(),
  intentGroupId: z.string(),
  humanReviewed: z.literal(true),
  query: z.string().min(1),
  language: z.string(),
  answerable: z.boolean(),
  evidenceGroups: z
    .array(
      z.array(
        z
          .object({
            documentId: z.string(),
            unitId: z.string(),
            start: z.number().int().nonnegative(),
            end: z.number().int().positive(),
          })
          .refine((s) => s.end > s.start)
      )
    )
    .default([]),
})
export type EvalCase = z.infer<typeof evalCaseSchema>

export function evidenceMetrics(item: EvalCase, ranked: ChildChunk[], k: number) {
  if (!item.answerable || !item.evidenceGroups.length) return null
  const covers = (chunks: ChildChunk[], anchor: EvalCase['evidenceGroups'][number][number]) => {
    const spans = chunks
      .filter((c) => c.documentId === anchor.documentId)
      .flatMap((c) => c.sourceSpans)
      .filter((s) => s.unitId === anchor.unitId)
      .sort((a, b) => a.start - b.start)
    let covered = anchor.start
    for (const span of spans) {
      if (span.start > covered) continue
      if (span.end > covered) covered = span.end
      if (covered >= anchor.end) return true
    }
    return false
  }
  const relevant = (chunks: ChildChunk[]) =>
    item.evidenceGroups.map((group) => group.some((anchor) => covers(chunks, anchor)))
  const coverage = relevant(ranked.slice(0, k))
  let first = 0
  for (let i = 1; i <= Math.min(k, ranked.length); i++)
    if (relevant(ranked.slice(0, i)).some(Boolean)) {
      first = i
      break
    }
  return {
    hit: Number(coverage.some(Boolean)),
    recall: coverage.filter(Boolean).length / coverage.length,
    allRequired: Number(coverage.every(Boolean)),
    reciprocalRank: first ? 1 / first : 0,
  }
}
