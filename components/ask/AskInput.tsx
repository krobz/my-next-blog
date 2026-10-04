'use client'

import { MAX_QUESTION_CHARS } from '@/lib/ai/config'

interface Props {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onFocus?: () => void
  onStop?: () => void
  busy?: boolean
  placeholder: string
}

export default function AskInput({
  value,
  onChange,
  onSubmit,
  onFocus,
  onStop,
  busy = false,
  placeholder,
}: Props) {
  return (
    <form
      className="relative"
      onSubmit={(event) => {
        event.preventDefault()
        if (!busy && value.trim()) onSubmit()
      }}
    >
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={onFocus}
        placeholder={placeholder}
        maxLength={MAX_QUESTION_CHARS}
        aria-label="Ask a question about krob"
        className="focus:border-primary-500 focus:ring-primary-500 w-full rounded-xl border border-gray-300 bg-white py-3.5 pr-14 pl-4 text-base text-gray-900 shadow-sm placeholder:text-gray-400 focus:ring-1 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
      />
      {busy && onStop ? (
        <button
          type="button"
          onClick={onStop}
          aria-label="Stop"
          className="hover:text-primary-500 absolute top-1/2 right-2 -translate-y-1/2 rounded-lg p-2 text-gray-500"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
            <rect x="7" y="7" width="10" height="10" rx="1.5" />
          </svg>
        </button>
      ) : (
        <button
          type="submit"
          aria-label="Ask"
          disabled={busy || !value.trim()}
          className="hover:text-primary-500 absolute top-1/2 right-2 -translate-y-1/2 rounded-lg p-2 text-gray-500 disabled:opacity-40 disabled:hover:text-gray-500"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            className="h-5 w-5"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m-6-6 6 6-6 6" />
          </svg>
        </button>
      )}
    </form>
  )
}
