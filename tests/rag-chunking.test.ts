import test from 'node:test'
import assert from 'node:assert/strict'
import { buildChunks, countTokens } from '../lib/ai/rag/chunking'
import { importSourcePack } from '../lib/ai/rag/import'
import { document } from './rag-helpers'

test('headings enrich retrieval, code remains intact, source spans point to source', () => {
  const doc = document(
    'syntax',
    '# MySQL\n\n## Core benefits\n\nUses B+ trees.\n\n```java\n@Transactional\nvoid commit() {}\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |'
  )
  const result = buildChunks([doc])
  assert.ok(result.children.some((c) => c.retrievalText.includes('MySQL > Core benefits')))
  assert.ok(result.children.some((c) => c.text.includes('@Transactional\nvoid commit() {}')))
  for (const child of result.children)
    for (const span of child.sourceSpans)
      assert.ok(doc.units[0].text.slice(span.start, span.end).length > 0)
  assert.deepEqual(buildChunks([doc]), result)
})
test('source-unit ancestry survives internal headings and skipped heading levels', () => {
  const doc = document(
    'architecture',
    '# Deployment\n\nDeployment facts.\n\n## Workers\n\nWorker facts.\n\n#### Limits\n\nLimit facts.\n\n## Recovery\n\nRecovery facts.'
  )
  doc.units[0].headingPath = ['TRPGHub', 'Architecture']
  const result = buildChunks([doc])
  assert.deepEqual(
    result.parents.map((parent) => parent.headingPath),
    [
      ['TRPGHub', 'Architecture', 'Deployment'],
      ['TRPGHub', 'Architecture', 'Deployment', 'Workers'],
      ['TRPGHub', 'Architecture', 'Deployment', 'Workers', 'Limits'],
      ['TRPGHub', 'Architecture', 'Deployment', 'Recovery'],
    ]
  )
  assert.ok(
    result.children.every((child) =>
      child.retrievalText.includes('Section: TRPGHub > Architecture > Deployment')
    )
  )
  assert.deepEqual(doc.units[0].headingPath, ['TRPGHub', 'Architecture'])
})

test('large code and prose have bounded child and parent tokens without losing rows', () => {
  const code = Array.from({ length: 350 }, (_, i) => `const item${i} = value${i};`).join('\n')
  const result = buildChunks([
    document('long', '# Code\n\n```js\n' + code + '\n```\n\n' + '中文长段落测试。'.repeat(500)),
  ])
  assert.ok(result.children.length > 5)
  assert.ok(result.children.every((c) => countTokens(c.text) <= 1000))
  assert.ok(result.parents.every((p) => p.tokens <= 1600))
  for (let i = 0; i < 350; i++)
    assert.ok(result.children.some((c) => c.text.includes(`const item${i} = value${i};`)))
})
test('explicit eligibility and visual review flags fail closed', () => {
  const raw = [
    {
      id: 'sample',
      title: 'Synthetic report',
      pages: [
        { page: 1, text: 'This is a verified textual paragraph with source facts.' },
        {
          page: 2,
          text: 'Unreviewed numeric table data should be absent.',
          review_flags: ['image_table'],
        },
      ],
    },
  ]
  assert.equal(buildChunks(importSourcePack(raw, [])).children.length, 0)
  const docs = importSourcePack(raw, ['sample'])
  assert.ok(buildChunks(docs).children.length > 0)
  assert.ok(buildChunks(docs).children.every((c) => !c.text.includes('Unreviewed')))
  assert.throws(() => importSourcePack(raw, ['missing']))
})
test('oversized individual code line fails for review, never silently truncates', () => {
  assert.throws(
    () => buildChunks([document('huge', '```\n' + 'item += 1; '.repeat(2000) + '\n```')]),
    /rag_oversized_code_or_table_row/
  )
})
