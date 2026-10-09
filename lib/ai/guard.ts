import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import type { LanguageModelUsage } from 'ai'
import { askConfig } from './config'

export type GuardResult = { ok: true } | { ok: false; status: number; message: string }

const hasRedis = Boolean(
  (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) &&
    (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN)
)
const redis = hasRedis ? Redis.fromEnv() : null

const limiters = redis && [
  new Ratelimit({
    redis,
    prefix: 'ask:rl:minute',
    limiter: Ratelimit.slidingWindow(askConfig.rateLimit.perMinute, '1 m'),
  }),
  new Ratelimit({
    redis,
    prefix: 'ask:rl:day',
    limiter: Ratelimit.fixedWindow(askConfig.rateLimit.perDay, '1 d'),
  }),
]

const budgetKey = () => `ask:budget:${new Date().toISOString().slice(0, 10)}`
const toMicroUsd = (usd: number) => Math.round(usd * 1_000_000)

export async function checkGuards(clientId: string): Promise<GuardResult> {
  if (!process.env.OPENAI_API_KEY) {
    return { ok: false, status: 503, message: 'The assistant is not configured yet.' }
  }
  if (!redis || !limiters) {
    return process.env.NODE_ENV === 'production'
      ? { ok: false, status: 503, message: 'The assistant is not configured yet.' }
      : { ok: true }
  }

  const spent = Number(await redis.get<number>(budgetKey())) || 0
  if (spent >= toMicroUsd(askConfig.dailyBudgetUsd)) {
    return {
      ok: false,
      status: 503,
      message:
        "Today's budget for the assistant is used up. Please come back tomorrow, or email krob directly.",
    }
  }

  const results = await Promise.all(limiters.map((limiter) => limiter.limit(clientId)))
  if (results.some((result) => !result.success)) {
    return {
      ok: false,
      status: 429,
      message: "You're asking a bit fast. Please wait a moment and try again.",
    }
  }
  return { ok: true }
}

export async function recordUsage(usage: LanguageModelUsage) {
  if (!redis) return
  const { input, output } = askConfig.usdPerMillionTokens
  const usd = ((usage.inputTokens ?? 0) * input + (usage.outputTokens ?? 0) * output) / 1_000_000
  await recordExternalUsage(usd)
}

export async function recordExternalUsage(usd: number) {
  if (!redis || !Number.isFinite(usd) || usd <= 0) return
  const key = budgetKey()
  await redis
    .pipeline()
    .incrby(key, toMicroUsd(usd))
    .expire(key, 60 * 60 * 48)
    .exec()
}
