// Per-account submission limiter — ported from elliptic-rank. Backed by
// Cloudflare's native Workers Rate Limiting binding. It is intentionally
// checked before body parsing and verification work.

import type { Bindings } from './auth'

export const SUBMISSION_RATE_LIMIT = 60
export const SUBMISSION_RATE_PERIOD_SEC = 60

export interface RateLimitResult {
  allowed: boolean
  limit: number
  retryAfter: number
}

export async function checkSubmissionRateLimit(
  env: Bindings,
  userId: number,
): Promise<RateLimitResult> {
  const { success } = await env.SUBMISSION_RATE_LIMITER.limit({
    key: `user:${userId}:submit`,
  })
  return {
    allowed: success,
    limit: SUBMISSION_RATE_LIMIT,
    retryAfter: SUBMISSION_RATE_PERIOD_SEC,
  }
}
