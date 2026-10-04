function numberFromEnv(value: string | undefined, fallback: number) {
  if (value === undefined || value.trim() === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const MAX_QUESTION_CHARS = 500

export const askConfig = {
  model: process.env.OPENAI_MODEL || 'gpt-6-luna',
  maxSteps: 5,
  maxOutputTokens: 1200,
  maxHistoryMessages: 12,
  maxHistoryChars: 16_000,
  rateLimit: {
    perMinute: numberFromEnv(process.env.ASK_RATE_LIMIT_PER_MINUTE, 5),
    perDay: numberFromEnv(process.env.ASK_RATE_LIMIT_PER_DAY, 30),
  },
  dailyBudgetUsd: numberFromEnv(process.env.ASK_DAILY_BUDGET_USD, 2),
  // Budget estimates use standard token prices; update these when changing models.
  usdPerMillionTokens: {
    input: numberFromEnv(process.env.OPENAI_INPUT_USD_PER_1M, 0.1),
    output: numberFromEnv(process.env.OPENAI_OUTPUT_USD_PER_1M, 0.5),
  },
}
