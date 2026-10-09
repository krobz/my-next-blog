'use client'

import { useChat } from '@ai-sdk/react'
import { APICallError } from 'ai'
import { useEffect, useRef, useState } from 'react'
import type { AskUIMessage } from '@/lib/ai/types'
import AgentTrace from './AgentTrace'
import AskInput from './AskInput'
import Markdown from './Markdown'
import PostCards from './PostCards'
import Timeline from './Timeline'
import type { PublicCitation } from '@/lib/ai/rag/types'

function errorMessage(error: Error) {
  if (APICallError.isInstance(error)) {
    try {
      const body = JSON.parse(error.responseBody ?? '')
      if (typeof body?.error === 'string') return body.error
    } catch {
      // fall through to the generic message
    }
  }
  return 'Something went wrong. Please try again.'
}

function ShimmerSkeleton() {
  return (
    <div className="animate-pulse space-y-3 pt-1">
      <div className="h-3.5 w-4/5 rounded-md bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 dark:from-gray-800 dark:via-gray-700/60 dark:to-gray-800" />
      <div className="h-3.5 w-full rounded-md bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 dark:from-gray-800 dark:via-gray-700/60 dark:to-gray-800" />
      <div className="h-3.5 w-3/5 rounded-md bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 dark:from-gray-800 dark:via-gray-700/60 dark:to-gray-800" />
    </div>
  )
}

function AssistantTurn({ message, running }: { message: AskUIMessage; running: boolean }) {
  const text = message.parts
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('\n\n')
    .trim()

  const widgets = message.parts.flatMap((part, i) => {
    if (
      part.type === 'tool-showPosts' &&
      part.state === 'output-available' &&
      part.output.posts.length
    ) {
      return [<PostCards key={i} posts={part.output.posts} />]
    }
    if (
      part.type === 'tool-showTimeline' &&
      part.state === 'output-available' &&
      part.output.items.length
    ) {
      return [<Timeline key={i} items={part.output.items} />]
    }
    return []
  })

  const sources = new Map<string, string>()
  const privateCitations = message.parts.flatMap((part) =>
    part.type === 'data-citations' && Array.isArray(part.data)
      ? (part.data as PublicCitation[])
      : []
  )
  for (const part of message.parts) {
    if (
      part.type === 'tool-getPost' &&
      part.state === 'output-available' &&
      !('error' in part.output)
    ) {
      sources.set(part.output.url, part.output.title)
    }
  }

  return (
    <div className="space-y-4">
      <AgentTrace parts={message.parts} running={running} metadata={message.metadata} />
      {running && !text && widgets.length === 0 && <ShimmerSkeleton />}
      {text && <Markdown text={text} />}
      {widgets}
      {privateCitations.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
          <span>Sources</span>
          {privateCitations.map((c) =>
            c.url ? (
              <a key={c.id} href={c.url} className="underline">
                [{c.id}] {c.title}
              </a>
            ) : (
              <span key={c.id} title={c.section}>
                [{c.id}] {c.title}
                {c.section ? ` · ${c.section}` : ''}
              </span>
            )
          )}
        </div>
      )}
      {sources.size > 0 && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
          <span>Sources</span>
          {[...sources].map(([url, title], i) => (
            <a
              key={url}
              href={url}
              className="hover:text-primary-500 dark:hover:text-primary-400 underline"
            >
              [{i + 1}] {title}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

interface Props {
  initialQuestion: string
  onReset: () => void
}

export default function Conversation({ initialQuestion, onReset }: Props) {
  const { messages, sendMessage, status, error, stop, regenerate } = useChat<AskUIMessage>()
  const [input, setInput] = useState('')
  const started = useRef(false)
  const endRef = useRef<HTMLDivElement>(null)
  const busy = status === 'submitted' || status === 'streaming'

  // Deferred so React's dev-only unmount/remount (which calls chat.stop()) can't abort it.
  useEffect(() => {
    if (started.current) return
    const timer = setTimeout(() => {
      started.current = true
      void sendMessage({ text: initialQuestion })
    }, 0)
    return () => clearTimeout(timer)
  }, [initialQuestion, sendMessage])

  useEffect(() => {
    if (messages.length > 1)
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [messages.length])

  const last = messages[messages.length - 1]

  return (
    <div className="space-y-8">
      {messages.map((message) =>
        message.role === 'user' ? (
          <p key={message.id} className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {message.parts.map((part) => (part.type === 'text' ? part.text : '')).join('')}
          </p>
        ) : (
          <AssistantTurn
            key={message.id}
            message={message}
            running={busy && message.id === last?.id}
          />
        )
      )}

      {status === 'submitted' && last?.role === 'user' && (
        <div className="space-y-4">
          <AgentTrace parts={[]} running />
          <ShimmerSkeleton />
        </div>
      )}

      {error && (
        <div className="flex items-center gap-3 text-sm text-red-500">
          <span>{errorMessage(error)}</span>
          <button type="button" onClick={() => void regenerate()} className="underline">
            Retry
          </button>
        </div>
      )}

      <div ref={endRef} className="space-y-2">
        <AskInput
          value={input}
          onChange={setInput}
          onSubmit={() => {
            void sendMessage({ text: input.trim() })
            setInput('')
          }}
          onStop={() => void stop()}
          busy={busy}
          placeholder="Ask a follow-up…"
        />
        <div className="flex justify-between text-xs text-gray-400 dark:text-gray-500">
          <span>AI answers can be wrong. Sources are linked when available.</span>
          <button
            type="button"
            onClick={onReset}
            className="hover:text-primary-500 dark:hover:text-primary-400"
          >
            New chat
          </button>
        </div>
      </div>
    </div>
  )
}
