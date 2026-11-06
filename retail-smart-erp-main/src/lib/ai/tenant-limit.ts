import { consumeRateLimit, rateLimitedResponse } from '@/lib/auth/rate-limit'

/**
 * Per-company AI request limit (shared across app instances via rate_limit_attempts), so one shop
 * cannot use up the platform's AI quota for everyone. The process-wide limiter in gemini.ts still
 * guards the provider quota on top of this.
 */
const PER_HOUR = { maxAttempts: 40, windowMs: 60 * 60 * 1000, category: 'ai_tenant_hour' }
const PER_DAY = { maxAttempts: 150, windowMs: 24 * 60 * 60 * 1000, category: 'ai_tenant_day' }

/** Counts one AI request for the tenant; returns a 429 response when over the limit, else null. */
export async function limitAiForTenant(tenantId: string | null | undefined): Promise<Response | null> {
  const key = tenantId || 'no-tenant'
  const hour = await consumeRateLimit(key, PER_HOUR)
  if (hour.limited) return rateLimitedResponse(hour, 'AI request limit reached for this company. Please try again later.')
  const day = await consumeRateLimit(key, PER_DAY)
  if (day.limited) return rateLimitedResponse(day, 'Daily AI request limit reached for this company.')
  return null
}
