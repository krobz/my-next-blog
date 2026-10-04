import type { InferUITools, UIDataTypes, UIMessage } from 'ai'
import type { AskTools } from './tools'

export type AskMetadata = {
  durationMs?: number
  totalTokens?: number
}

export type AskUIMessage = UIMessage<AskMetadata, UIDataTypes, InferUITools<AskTools>>
