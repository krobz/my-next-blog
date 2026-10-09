import type { UIMessageChunk } from 'ai'
import type { PublicCitation } from './types'

type PublicState = {
  citations(): PublicCitation[]
  summary(): {
    searches: number
    candidates: number
    durationMs: number
    degraded: boolean
    reranked: boolean
  }
  publicWidget(name: string, output: unknown): unknown
}
const widgetNames = new Set(['showPosts', 'showTimeline'])
const genericError = 'Something went wrong while answering. Please try again.'

// The SDK stream is model-facing data until it passes this explicit projection.
export function publicStream(state: PublicState): TransformStream<UIMessageChunk, UIMessageChunk> {
  const calls = new Map<string, { name: string; id: string }>()
  const textIds = new Map<string, string>()
  const pending = new Map<string, string>()
  const citationFilter = (text: string) =>
    text.replace(/\[S\d+\]/g, (token) =>
      state.citations().some((c) => `[${c.id}]` === token) ? token : ''
    )
  const outputId = (id: string) => {
    if (!textIds.has(id)) textIds.set(id, `text-${textIds.size + 1}`)
    return textIds.get(id)!
  }
  return new TransformStream({
    transform(part, controller) {
      switch (part.type) {
        case 'start':
          controller.enqueue({ type: 'start' })
          break
        case 'start-step':
        case 'finish-step':
        case 'reset-step':
          controller.enqueue({ type: part.type })
          break
        case 'text-start':
          pending.set(part.id, '')
          controller.enqueue({ type: 'text-start', id: outputId(part.id) })
          break
        case 'text-delta': {
          const combined = (pending.get(part.id) ?? '') + part.delta
          // Hold an incomplete citation marker across transport chunks.
          const match = /\[(?:S\d*)?$/.exec(combined)
          const end = match?.index ?? combined.length
          pending.set(part.id, combined.slice(end))
          const delta = citationFilter(combined.slice(0, end))
          if (delta) controller.enqueue({ type: 'text-delta', id: outputId(part.id), delta })
          break
        }
        case 'text-end': {
          const tail = pending.get(part.id) ?? ''
          if (tail && !/^\[S\d*$/.test(tail))
            controller.enqueue({
              type: 'text-delta',
              id: outputId(part.id),
              delta: citationFilter(tail),
            })
          pending.delete(part.id)
          controller.enqueue({ type: 'text-end', id: outputId(part.id) })
          break
        }
        case 'tool-input-available': {
          if (widgetNames.has(part.toolName)) {
            const call = { name: part.toolName, id: `widget-${calls.size + 1}` }
            calls.set(part.toolCallId, call)
            controller.enqueue({
              type: 'tool-input-available',
              toolCallId: call.id,
              toolName: part.toolName,
              input: {},
            })
          }
          break
        }
        case 'tool-output-available': {
          const call = calls.get(part.toolCallId)
          if (call)
            controller.enqueue({
              type: 'tool-output-available',
              toolCallId: call.id,
              output: state.publicWidget(call.name, part.output),
            })
          break
        }
        case 'tool-output-error':
        case 'tool-output-denied': {
          if (calls.has(part.toolCallId))
            controller.enqueue({
              type: 'tool-output-error',
              toolCallId: calls.get(part.toolCallId)!.id,
              errorText: 'This display is temporarily unavailable.',
            })
          break
        }
        case 'finish': {
          const citations = state.citations().map(({ id, title, section, url }) => ({
            id,
            title,
            section,
            ...(url?.startsWith('/blog/') ? { url } : {}),
          }))
          controller.enqueue({ type: 'data-citations', data: citations })
          controller.enqueue({ type: 'data-retrieval', data: state.summary() })
          const metadata = part.messageMetadata as
            | { durationMs?: unknown; totalTokens?: unknown }
            | undefined
          controller.enqueue({
            type: 'finish',
            messageMetadata: {
              ...(typeof metadata?.durationMs === 'number'
                ? { durationMs: metadata.durationMs }
                : {}),
              ...(typeof metadata?.totalTokens === 'number'
                ? { totalTokens: metadata.totalTokens }
                : {}),
            },
          })
          break
        }
        case 'error':
          controller.enqueue({ type: 'error', errorText: genericError })
          break
        case 'abort':
          controller.enqueue({ type: 'abort' })
          break
        default:
          break // includes reasoning, source files, private tool input/output, arbitrary data and metadata
      }
    },
  })
}
