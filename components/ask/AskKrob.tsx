'use client'

import dynamic from 'next/dynamic'
import { useState } from 'react'
import AskInput from './AskInput'

const loadConversation = () => import('./Conversation')

const Conversation = dynamic(loadConversation, {
  ssr: false,
  loading: () => (
    <p className="animate-pulse text-sm text-gray-500 dark:text-gray-400">Starting…</p>
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
