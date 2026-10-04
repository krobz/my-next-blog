'use client'

import { useState } from 'react'
import type { AskMetadata, AskUIMessage } from '@/lib/ai/types'

type Part = AskUIMessage['parts'][number]
type StepState = 'running' | 'done' | 'error'
type Step = { key: string; label: string; call?: string; detail?: string; state: StepState }

function stateOf(state: string): StepState {
  if (state === 'output-available') return 'done'
  if (state === 'output-error' || state === 'output-denied') return 'error'
  return 'running'
}

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`
const callOf = (name: string, input: unknown) => `${name}(${input ? JSON.stringify(input) : ''})`

function toSteps(parts: Part[]): Step[] {
  return parts.flatMap<Step>((part, i) => {
    const key = `${part.type}-${i}`
    switch (part.type) {
      case 'reasoning': {
        const text = part.text.trim()
        if (!text) return []
        return [
          {
            key,
            label: 'Thinking',
            detail: text,
            state: part.state === 'streaming' ? 'running' : 'done',
          },
        ]
      }
      case 'tool-searchPosts': {
        const query = part.input?.query
        return [
          {
            key,
            label: query ? `Searched posts for “${query}”` : 'Searching posts',
            call: callOf('searchPosts', part.input),
            detail:
              part.state === 'output-available'
                ? plural(part.output.results.length, 'match', 'matches')
                : undefined,
            state: stateOf(part.state),
          },
        ]
      }
      case 'tool-getPost': {
        const output = part.state === 'output-available' ? part.output : undefined
        const title = output && !('error' in output) ? output.title : part.input?.slug
        return [
          {
            key,
            label: title ? `Read “${title}”` : 'Reading a post',
            call: callOf('getPost', part.input),
            detail: output && 'error' in output ? output.error : output?.section,
            state: output && 'error' in output ? 'error' : stateOf(part.state),
          },
        ]
      }
      case 'tool-showPosts':
        return [
          {
            key,
            label:
              part.state === 'output-available'
                ? `Rendered ${plural(part.output.posts.length, 'post card')}`
                : 'Rendering post cards',
            call: callOf('showPosts', part.input),
            state: stateOf(part.state),
          },
        ]
      case 'tool-showTimeline':
        return [
          {
            key,
            label: part.state === 'output-available' ? 'Rendered timeline' : 'Rendering timeline',
            call: callOf('showTimeline', part.input),
            state: stateOf(part.state),
          },
        ]
      default:
        return []
    }
  })
}

function Dot({ state }: { state: StepState }) {
  const color =
    state === 'running'
      ? 'bg-primary-500 animate-pulse'
      : state === 'error'
        ? 'bg-red-500'
        : 'bg-gray-400'
  return <span className={`mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${color}`} />
}

interface Props {
  parts: Part[]
  running: boolean
  metadata?: AskMetadata
}

export default function AgentTrace({ parts, running, metadata }: Props) {
  const [open, setOpen] = useState(false)
  const steps = toSteps(parts)
  if (!running && steps.length === 0) return null

  const current = steps[steps.length - 1]
  const summary = running
    ? `${current?.label ?? 'Thinking'}…`
    : [
        plural(steps.length, 'step'),
        metadata?.durationMs !== undefined && `${(metadata.durationMs / 1000).toFixed(1)}s`,
        metadata?.totalTokens !== undefined && `${metadata.totalTokens.toLocaleString()} tokens`,
      ]
        .filter(Boolean)
        .join(' · ')

  return (
    <div className="font-mono text-xs text-gray-500 dark:text-gray-400">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={steps.length === 0}
        aria-expanded={open}
        className="flex items-center gap-2 hover:text-gray-700 disabled:cursor-default dark:hover:text-gray-200"
      >
        {running ? (
          <span className="bg-primary-500 inline-block h-1.5 w-1.5 animate-pulse rounded-full" />
        ) : (
          <span aria-hidden>✓</span>
        )}
        <span>{summary}</span>
        {steps.length > 0 && <span aria-hidden>{open ? '▾' : '▸'}</span>}
      </button>
      {open && (
        <ol className="mt-2 space-y-2 border-l border-gray-200 pl-3 dark:border-gray-700">
          {steps.map((step) => (
            <li key={step.key} className="flex gap-2">
              <Dot state={step.state} />
              <div className="min-w-0 space-y-0.5">
                <div className="text-gray-700 dark:text-gray-300">{step.label}</div>
                {step.call && (
                  <div className="break-all text-gray-400 dark:text-gray-500">{step.call}</div>
                )}
                {step.detail && (
                  <div className="whitespace-pre-wrap text-gray-400 dark:text-gray-500">
                    {step.detail}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
