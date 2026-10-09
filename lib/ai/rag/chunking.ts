import { createHash } from 'node:crypto'
import { remark } from 'remark'
import remarkGfm from 'remark-gfm'
import { getEncoding } from 'js-tiktoken'
import type { RootContent } from 'mdast'
import type { ChildChunk, ParentChunk, RagDocument, SourceUnit } from './types'

const encoding = getEncoding('cl100k_base')
export const PIPELINE_VERSION = 'structural-v2-cl100k'
export const countTokens = (text: string) => encoding.encode(text, [], []).length
export const digest = (text: string) => createHash('sha256').update(text).digest('hex')
export function identifiers(text: string): string[] {
  return [
    ...new Set(
      text.match(
        /@[A-Za-z][\w.]*|\/[A-Za-z][\w/-]+|[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+|[A-Za-z]+[A-Z][A-Za-z0-9]*|\b[A-Z][A-Z0-9]{1,}\b|LC\s*\d+/g
      ) ?? []
    ),
  ].map((s) => s.toLowerCase())
}

type Block = { text: string; start: number; end: number; unitId: string; atomic: boolean }

function proseParts(text: string, offset: number, unitId: string): Block[] {
  const result: Block[] = []
  let start = 0
  while (start < text.length) {
    let end = text.length
    if (countTokens(text.slice(start)) > 600) {
      let low = start + 1,
        high = Math.min(text.length, start + 5000)
      while (low < high) {
        const mid = Math.ceil((low + high) / 2)
        if (countTokens(text.slice(start, mid)) <= 384) low = mid
        else high = mid - 1
      }
      end = low
      const prefix = text.slice(start, end)
      const boundaries = [...prefix.matchAll(/[。！？.!?]\s|\n|\s/g)]
      const last = boundaries.at(-1)?.index
      if (last && last > prefix.length / 2) end = start + last + 1
      if (/[\uD800-\uDBFF]/.test(text[end - 1] ?? '')) end--
    }
    if (end <= start) throw new Error('rag_unsplittable_text')
    result.push({
      text: text.slice(start, end),
      start: offset + start,
      end: offset + end,
      unitId,
      atomic: false,
    })
    start = end
  }
  return result
}

function blocksFor(node: RootContent, unit: SourceUnit): Block[] {
  const start = node.position?.start.offset ?? 0
  const end = node.position?.end.offset ?? unit.text.length
  const text = unit.text.slice(start, end)
  if (node.type !== 'code' && node.type !== 'table') return proseParts(text, start, unit.id)
  if (countTokens(text) <= 1000) return [{ text, start, end, unitId: unit.id, atomic: true }]
  const lines = text.split(/(?<=\n)/)
  const isCode = node.type === 'code'
  const fenced = isCode && /^\s*(`{3,}|~{3,})/.test(lines[0])
  const headerCount = isCode ? (fenced ? 1 : 0) : 2
  const header = isCode ? `\`\`\`\`${node.lang ?? ''}\n` : lines.slice(0, 2).join('')
  const footer = isCode ? '\n````' : ''
  const body = lines.slice(
    headerCount,
    fenced && /^\s*(`{3,}|~{3,})/.test(lines.at(-1) ?? '') ? -1 : undefined
  )
  const result: Block[] = []
  let cursor = start + lines.slice(0, headerCount).join('').length
  let buffer = '',
    segmentStart = cursor
  const flush = () => {
    if (!buffer) return
    result.push({
      text: header + buffer + footer,
      start: segmentStart,
      end: cursor,
      unitId: unit.id,
      atomic: true,
    })
    buffer = ''
    segmentStart = cursor
  }
  for (const line of body) {
    if (countTokens(header + line + footer) > 1000)
      throw new Error('rag_oversized_code_or_table_row')
    if (buffer && countTokens(header + buffer + line + footer) > 1000) flush()
    buffer += line
    cursor += line.length
  }
  flush()
  return result
}

export function buildChunks(documents: RagDocument[]): {
  parents: ParentChunk[]
  children: ChildChunk[]
} {
  const parents: ParentChunk[] = [],
    children: ChildChunk[] = []
  for (const doc of documents) {
    if (!doc.allowPublicAnswer) continue
    for (const unit of doc.units) {
      if (!unit.verified || !unit.text.trim()) continue
      const root = remark().use(remarkGfm).parse(unit.text)
      const basePath = [...unit.headingPath]
      const headings: { depth: number; title: string }[] = []
      let path = [...basePath]
      let blocks: Block[] = []
      const emit = () => {
        if (!blocks.length) return
        const text = blocks.map((b) => b.text).join('\n\n')
        const parentId = digest(
          `${PIPELINE_VERSION}:${doc.id}:${doc.version}:${unit.id}:${blocks[0].start}:${text}`
        )
        const parent: ParentChunk = {
          id: parentId,
          documentId: doc.id,
          version: doc.version,
          title: doc.title,
          headingPath: [...path],
          source: doc.source,
          ...(doc.source === 'blog' && doc.url ? { url: doc.url } : {}),
          allowPublicAnswer: true,
          claimStatus: unit.claimStatus ?? doc.claimStatus,
          attribution: doc.attribution,
          text,
          tokens: countTokens(text),
          sourceUnitIds: [unit.id],
        }
        parents.push(parent)
        let childBlocks: Block[] = []
        const emitChild = () => {
          if (!childBlocks.length) return
          const body = childBlocks.map((b) => b.text).join('\n\n')
          const id = digest(`${parentId}:${childBlocks[0].start}:${body}`)
          const prefix = `Project: ${doc.title}\nSection: ${path.join(' > ')}\nAliases: ${doc.aliases.join(', ')}\n`
          children.push({
            id,
            parentId,
            documentId: doc.id,
            version: doc.version,
            canonicalId: digest(`${doc.id}:${unit.canonicalId ?? ''}:${body}`),
            headingPath: [...path],
            text: body,
            retrievalText: prefix + '\n' + body,
            tokens: countTokens(body),
            identifiers: [
              ...new Set([
                ...identifiers(body + ' ' + path.join(' ')),
                ...doc.aliases.map((s) => s.toLowerCase()),
              ]),
            ],
            sourceSpans: childBlocks.map((b) => ({ unitId: b.unitId, start: b.start, end: b.end })),
          })
          childBlocks = []
        }
        for (const block of blocks) {
          if (
            childBlocks.length &&
            (block.atomic ||
              countTokens([...childBlocks.map((b) => b.text), block.text].join('\n\n')) > 384)
          )
            emitChild()
          childBlocks.push(block)
          if (block.atomic) emitChild()
        }
        emitChild()
        blocks = []
      }
      for (const node of root.children) {
        if (node.type === 'heading') {
          emit()
          const heading = unit.text
            .slice(node.position!.start.offset, node.position!.end.offset)
            .replace(/^#+\s*/, '')
            .replace(/[*`]/g, '')
          while (headings.length && headings.at(-1)!.depth >= node.depth) headings.pop()
          headings.push({ depth: node.depth, title: heading })
          path = [...basePath, ...headings.map((item) => item.title)]
          continue
        }
        if (node.type === 'thematicBreak' || node.type === 'html') continue
        for (const block of blocksFor(node, unit)) {
          if (
            blocks.length &&
            countTokens([...blocks.map((b) => b.text), block.text].join('\n\n')) > 1600
          )
            emit()
          blocks.push(block)
        }
      }
      emit()
    }
  }
  return { parents, children }
}
