import { openai } from '@ai-sdk/openai'
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
} from 'ai'
import { z } from 'zod'
import { askConfig, MAX_QUESTION_CHARS } from '@/lib/ai/config'
import { checkGuards, recordUsage } from '@/lib/ai/guard'
import { getInstructions } from '@/lib/ai/prompt'
import { tools, type AskTools } from '@/lib/ai/tools'
import type { AskUIMessage } from '@/lib/ai/types'

export const maxDuration = 60

const requestSchema = z.object({
  messages: z
    .array(
      z.object({
        id: z.string().max(100),
        role: z.enum(['system', 'user', 'assistant']),
        parts: z.array(z.looseObject({ type: z.string() })).max(100),
      })
    )
    .min(1)
    .max(100),
})

const errorResponse = (status: number, error: string) => Response.json({ error }, { status })

const textOf = (message: Pick<AskUIMessage, 'parts'>) =>
  message.parts
    .map((part) => (part.type === 'text' && typeof part.text === 'string' ? part.text : ''))
    .join('')

function clientId(req: Request) {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'anonymous'
  )
}

// Earlier turns are reduced to plain text: tool outputs and reasoning are dropped to keep
// the prompt small, and provider item references are stripped so they can't dangle.
function compactHistory(messages: AskUIMessage[]): AskUIMessage[] {
  const compacted = messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-askConfig.maxHistoryMessages)
    .map((message) => ({
      id: message.id,
      role: message.role,
      parts: [{ type: 'text' as const, text: textOf(message) }],
    }))
    .filter((message) => message.parts[0].text.trim().length > 0)

  let total = compacted.reduce((sum, message) => sum + message.parts[0].text.length, 0)
  while (
    compacted.length > 1 &&
    (total > askConfig.maxHistoryChars || compacted[0].role !== 'user')
  ) {
    total -= compacted.shift()!.parts[0].text.length
  }
  return compacted
}

export async function POST(req: Request) {
  const parsed = requestSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return errorResponse(400, 'Invalid request.')

  const messages = parsed.data.messages as AskUIMessage[]
  const question = messages[messages.length - 1]
  const questionText = textOf(question).trim()
  if (question.role !== 'user' || !questionText) return errorResponse(400, 'Invalid request.')
  if (questionText.length > MAX_QUESTION_CHARS) {
    return errorResponse(400, `Please keep questions under ${MAX_QUESTION_CHARS} characters.`)
  }

  const guard = await checkGuards(clientId(req))
  if (!guard.ok) return errorResponse(guard.status, guard.message)

  const startedAt = Date.now()
  const result = streamText({
    model: openai(askConfig.model),
    instructions: getInstructions(),
    messages: await convertToModelMessages(compactHistory(messages)),
    tools,
    stopWhen: isStepCount(askConfig.maxSteps),
    maxOutputTokens: askConfig.maxOutputTokens,
    reasoning: 'low',
    abortSignal: req.signal,
    onStepEnd: async ({ usage }) => {
      await recordUsage(usage).catch((error) =>
        console.error('[ask] failed to record usage', error)
      )
    },
  })

  return createUIMessageStreamResponse({
    stream: toUIMessageStream<AskTools, AskUIMessage>({
      stream: result.stream,
      originalMessages: messages,
      messageMetadata: ({ part }) =>
        part.type === 'finish'
          ? { durationMs: Date.now() - startedAt, totalTokens: part.totalUsage.totalTokens }
          : undefined,
      onError: (error) => {
        console.error('[ask] stream error', error)
        return 'Something went wrong while answering. Please try again.'
      },
    }),
  })
}
