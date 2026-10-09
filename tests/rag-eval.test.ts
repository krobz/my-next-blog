import test from 'node:test'
import assert from 'node:assert/strict'
import { evalCaseSchema, evidenceMetrics } from '../lib/ai/rag/eval'
import { snapshot } from './rag-helpers'

test('evidence recall counts required groups, not duplicate chunks or just one hit', () => {
  const snap = snapshot()
  const item = evalCaseSchema.parse({
    id: 'two-parts',
    intentGroupId: 'two-parts',
    humanReviewed: true,
    language: 'en',
    query: 'Recovery?',
    answerable: true,
    evidenceGroups: [
      [{ documentId: 'sample', unitId: 'unit', start: 12, end: 20 }],
      [{ documentId: 'other', unitId: 'unit', start: 1, end: 2 }],
    ],
  })
  const metrics = evidenceMetrics(item, [snap.children[0], snap.children[0]], 8)
  assert.equal(metrics?.hit, 1)
  assert.equal(metrics?.recall, 0.5)
  assert.equal(metrics?.allRequired, 0)
  assert.equal(evidenceMetrics({ ...item, answerable: false }, [], 8), null)
  assert.throws(() => evalCaseSchema.parse({ ...item, humanReviewed: false }))
})
