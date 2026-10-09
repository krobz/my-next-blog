import { z } from 'zod'
import { digest } from './chunking'
import type { RagDocument, SourceUnit, ClaimStatus } from './types'

const rawDocument = z.object({
  id: z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/)
    .max(100),
  title: z.string().max(500),
  text: z.string().max(2_000_000).optional(),
  nodes: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        notes_plain: z.string().optional(),
        path_labels: z.array(z.string()),
      })
    )
    .max(10000)
    .optional(),
  pages: z
    .array(
      z.object({
        page: z.number().int(),
        text: z.string(),
        section: z.string().optional(),
        review_flags: z.array(z.string()).optional(),
      })
    )
    .max(1000)
    .optional(),
  sections: z
    .array(z.object({ id: z.string(), text: z.string(), heading_path: z.array(z.string()) }))
    .max(10000)
    .optional(),
})

export function importSourcePack(value: unknown, publicIds: string[]): RagDocument[] {
  const records = z.array(rawDocument).max(1000).parse(value)
  if (new Set(records.map((d) => d.id)).size !== records.length)
    throw new Error('rag_duplicate_document_id')
  if (publicIds.some((id) => !records.some((d) => d.id === id)))
    throw new Error('rag_unknown_public_document')
  return records.map((record) => {
    let units: SourceUnit[] = []
    if (record.sections)
      units = record.sections.map((s) => ({
        id: s.id,
        headingPath: s.heading_path,
        text: s.text,
        verified: true,
      }))
    else if (record.nodes)
      units = record.nodes
        .filter((n) => !/^(Subtopic\s*\d*|Floating Topic|相关Code)$/i.test(n.title.trim()))
        .map((n) => ({
          id: n.id,
          headingPath: n.path_labels.slice(0, -1).map((p) => p.slice(0, 200)),
          text: [n.title, n.notes_plain].filter(Boolean).join('\n\n'),
          verified: true,
        }))
    else if (record.pages)
      units = record.pages.map((p) => ({
        id: `page-${p.page}`,
        headingPath: [p.section ?? 'Report', `Page ${p.page}`],
        text: p.text,
        locator: `page:${p.page}`,
        verified:
          (p.review_flags ?? []).every(
            (flag) => flag === 'figures_or_diagrams_not_fully_represented_in_text'
          ) && p.text.trim().length > 30,
      }))
    else if (record.text)
      units = [{ id: 'text', headingPath: [], text: record.text, verified: true }]
    const claimStatus: ClaimStatus = ['es', 'dtcc'].includes(record.id)
      ? 'unresolved_conflict'
      : record.id === 'trpg-openim' || record.id.includes('stages')
        ? 'proposal'
        : 'unknown'
    return {
      id: record.id,
      title: record.title,
      version: digest(JSON.stringify(units)),
      source: 'private',
      language: 'mixed',
      allowPublicAnswer: publicIds.includes(record.id),
      claimStatus,
      attribution:
        record.id === 'garment'
          ? 'Team report; individual ownership is not established. Text extraction only: unextracted figures, formulas and tables are not available evidence.'
          : 'Source statement; distinguish plans, claims and measured results. Do not infer personal ownership.',
      aliases: [record.id, ...(record.id.startsWith('trpg') ? ['TRPGHub'] : [])],
      units,
    }
  })
}

export function importBlogMarkdown(
  id: string,
  title: string,
  raw: string,
  url: string
): RagDocument {
  if (!/^\/blog\/[a-zA-Z0-9/_-]+$/.test(url)) throw new Error('rag_invalid_blog_url')
  const text = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
  return {
    id: `blog-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
    title,
    version: digest(text),
    source: 'blog',
    url,
    language: 'en',
    allowPublicAnswer: true,
    claimStatus: 'reported_result',
    attribution: 'Published blog post.',
    aliases: [id],
    units: [{ id: 'body', headingPath: [], text, verified: true }],
  }
}
