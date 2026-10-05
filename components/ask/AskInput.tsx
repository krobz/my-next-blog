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
        disabled={busy}
        placeholder={busy ? 'Thinking…' : placeholder}
        maxLength={MAX_QUESTION_CHARS}
        aria-label="Ask a question about krob"
        className={`w-full rounded-xl border py-3.5 pr-14 pl-4 text-base shadow-sm transition-all duration-200 focus:outline-none ${
          busy
            ? 'border-primary-500/50 ring-primary-500/15 placeholder:text-primary-500/60 cursor-not-allowed bg-gray-50/60 text-gray-500 ring-2 dark:bg-gray-900/60 dark:text-gray-400'
            : 'focus:border-primary-500 focus:ring-primary-500 border-gray-300 bg-white text-gray-900 placeholder:text-gray-400 focus:ring-1 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100'
        }`}
      />
      {busy && onStop ? (
        <button
          type="button"
          onClick={onStop}
          aria-label="Stop generation"
          title="Stop"
          className="hover:text-primary-500 absolute top-1/2 right-2 -translate-y-1/2 rounded-lg p-2 text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-200"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-sm bg-gray-200/80 dark:bg-gray-700/80">
            <span className="h-2 w-2 animate-pulse rounded-[1px] bg-gray-700 dark:bg-gray-200" />
          </span>
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
