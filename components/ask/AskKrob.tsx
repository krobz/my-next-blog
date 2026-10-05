'use client'

import dynamic from 'next/dynamic'
import { useState } from 'react'
import AskInput from './AskInput'

const loadConversation = () => import('./Conversation')

const Conversation = dynamic(loadConversation, {
  ssr: false,
  loading: () => (
    <div className="animate-pulse space-y-3 py-2">
      <div className="bg-primary-500/10 text-primary-600 dark:text-primary-400 border-primary-500/20 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs">
        <span className="relative flex h-2 w-2">
          <span className="bg-primary-400 absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"></span>
          <span className="bg-primary-500 relative inline-flex h-2 w-2 rounded-full"></span>
        </span>
        <span>Connecting to AI twin…</span>
      </div>
      <div className="space-y-2 pt-1">
        <div className="h-3.5 w-3/4 rounded-md bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 dark:from-gray-800 dark:via-gray-700/60 dark:to-gray-800" />
        <div className="h-3.5 w-1/2 rounded-md bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 dark:from-gray-800 dark:via-gray-700/60 dark:to-gray-800" />
      </div>
    </div>
  ),
})

const suggestions = [
  { label: 'About me', prompt: 'Tell me about krob.' },
  { label: 'What has he built?', prompt: 'What has krob built?' },
  { label: 'Tech stack', prompt: "What's krob's tech stack?" },
  { label: 'Latest writing', prompt: 'What has krob written recently?' },
]

export default function AskKrob() {
  const [question, setQuestion] = useState<string | null>(null)
  const [session, setSession] = useState(0)
  const [input, setInput] = useState('')

  const ask = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    setQuestion(trimmed)
    setInput('')
  }

  if (question) {
    return (
      <Conversation
        key={session}
        initialQuestion={question}
        onReset={() => {
          setQuestion(null)
          setSession((n) => n + 1)
        }}
      />
    )
  }

  return (
    <div className="space-y-3">
      <AskInput
        value={input}
        onChange={setInput}
        onSubmit={() => ask(input)}
        onFocus={() => void loadConversation()}
        placeholder="Ask me anything about krob…"
      />
      <div className="flex flex-wrap gap-2">
        {suggestions.map(({ label, prompt }) => (
          <button
            key={label}
            type="button"
            onClick={() => ask(prompt)}
            onPointerEnter={() => void loadConversation()}
            className="hover:border-primary-500 hover:text-primary-500 dark:hover:border-primary-400 dark:hover:text-primary-400 rounded-full border border-gray-200 px-3 py-1 text-sm text-gray-600 transition-colors dark:border-gray-700 dark:text-gray-300"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
