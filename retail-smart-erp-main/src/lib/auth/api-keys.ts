/**
 * H4: tenant API keys for the public /api/v1 API.
 *
 *   key format:  plk_<12 base62 id>_<43 char base64url secret>     (only shown once, at creation)
 *   stored:      key_prefix = "plk_<id>"  (unique, used for lookup)  +  key_hash = sha256(full key)
 *
 * A key acts as the user who created it (owner/manager), re-checked on every request: a revoked
 * or expired key, a deactivated / demoted creator or a suspended company stops it immediately.
 * Scopes limit what the key may call; rate limiting is per key (fixed window, DB-backed so it
 * holds across instances) plus a per-IP limit on failed authentications.
 */
import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { and, eq, sql } from 'drizzle-orm'
import { db, withoutTenant } from '@/lib/db'
import { apiKeys, tenants, users } from '@/lib/db/schema'
import { checkRateLimit, recordRateLimitAttempt } from './rate-limit'
import { getLiveCompanyUser } from './live-user'
import type { CompanySession } from './index'
import { runWithApiPrincipal, type ApiKeyPrincipal } from './api-key-context'
import { logError } from '@/lib/ai/error-logger'
import { API_SCOPES, type ApiScope } from './api-key-scopes'
export { API_SCOPES, API_SCOPE_LABELS, type ApiScope } from './api-key-scopes'

/** Roles that may create / revoke keys (and whose keys keep working). */
export const API_KEY_ADMIN_ROLES = ['owner', 'manager'] as const

const KEY_RE = /^(plk_[A-Za-z0-9]{12})_([A-Za-z0-9_-]{43})$/
const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

export const API_RATE_LIMIT_PER_MIN = Math.max(1, Number(process.env.API_KEY_RATE_LIMIT_PER_MIN) || 120)
const FAILED_AUTH_LIMIT = { maxAttempts: 20, windowMs: 5 * 60_000, category: 'api_key_auth_fail' }

export function hashApiKey(fullKey: string): string {
  return createHash('sha256').update(fullKey, 'utf8').digest('hex')
}

/** New random key. Returns the full secret (show once) and what to store. */
export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const idBytes = randomBytes(12)
  let id = ''
  for (const b of idBytes) id += BASE62[b % 62]
  const prefix = `plk_${id}`
  const key = `${prefix}_${randomBytes(32).toString('base64url')}`
  return { key, prefix, hash: hashApiKey(key) }
}

export function parseApiKey(raw: string | null | undefined): { prefix: string; key: string } | null {
  if (!raw) return null
  const m = KEY_RE.exec(raw.trim())
  return m ? { prefix: m[1], key: m[0] } : null
}

/** `Authorization: Bearer plk_…` or `X-API-Key: plk_…` */
export function extractApiKey(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (header?.toLowerCase().startsWith('bearer ')) {
    const token = header.slice(7).trim()
    if (token.startsWith('plk_')) return token
  }
  return request.headers.get('x-api-key')?.trim() || null
}

export function sanitizeScopes(scopes: unknown): ApiScope[] {
  if (!Array.isArray(scopes)) return []
  const allowed = new Set<string>(API_SCOPES)
  return [...new Set(scopes.filter((s): s is ApiScope => typeof s === 'string' && allowed.has(s)))]
}

function clientIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown'
}

function apiError(status: number, error: string, code: string, headers?: Record<string, string>) {
  return NextResponse.json({ error, code }, { status, headers })
}

/** Fixed-window counter per key; one atomic upsert per request. */
async function hitKeyRateLimit(keyId: string): Promise<{ limited: boolean; remaining: number; resetSec: number }> {
  const windowMs = 60_000
  const now = new Date()
  const windowStart = new Date(now.getTime() - windowMs)
  try {
    const res = await db.execute(sql`
      INSERT INTO rate_limit_attempts (key, category, attempts, first_attempt_at, updated_at)
      VALUES (${keyId}, 'api_key', 1, ${now}, ${now})
      ON CONFLICT (key, category) DO UPDATE SET
        attempts = CASE WHEN rate_limit_attempts.first_attempt_at < ${windowStart} THEN 1 ELSE rate_limit_attempts.attempts + 1 END,
        first_attempt_at = CASE WHEN rate_limit_attempts.first_attempt_at < ${windowStart} THEN ${now} ELSE rate_limit_attempts.first_attempt_at END,
        updated_at = ${now}
      RETURNING attempts, first_attempt_at
    `)
    const row = res.rows?.[0] as { attempts: number; first_attempt_at: Date | string } | undefined
    const attempts = Number(row?.attempts || 1)
    const first = row ? new Date(row.first_attempt_at).getTime() : now.getTime()
    const resetSec = Math.max(1, Math.ceil((first + windowMs - now.getTime()) / 1000))
    return { limited: attempts > API_RATE_LIMIT_PER_MIN, remaining: Math.max(0, API_RATE_LIMIT_PER_MIN - attempts), resetSec }
  } catch {
    // Rate limiting is defense in depth: fail open when the table is unavailable
    return { limited: false, remaining: API_RATE_LIMIT_PER_MIN, resetSec: 60 }
  }
}

export type ApiKeyAuthResult =
  | { ok: true; principal: ApiKeyPrincipal; rateHeaders: Record<string, string> }
  | { ok: false; response: NextResponse }

/** Authenticate the API key of a request and check one scope. */
export async function authenticateApiKey(request: Request, scope: ApiScope): Promise<ApiKeyAuthResult> {
  const ip = clientIp(request)
  const failLimit = await checkRateLimit(`ip:${ip}`, FAILED_AUTH_LIMIT)
  if (failLimit.limited) {
    const retry = String(Math.ceil((failLimit.retryAfterMs || 60_000) / 1000))
    return { ok: false, response: apiError(429, 'Too many failed authentication attempts', 'RATE_LIMITED', { 'Retry-After': retry }) }
  }

  const unauthorized = async (error: string, code = 'INVALID_API_KEY') => {
    await recordRateLimitAttempt(`ip:${ip}`, FAILED_AUTH_LIMIT)
    return { ok: false as const, response: apiError(401, error, code, { 'WWW-Authenticate': 'Bearer realm="poslanka-api"' }) }
  }

  const parsed = parseApiKey(extractApiKey(request))
  if (!parsed) return unauthorized('Missing or malformed API key', 'MISSING_API_KEY')

  // Lookup happens before a tenant is known (like login): global read by the unique prefix.
  const row = await withoutTenant(async (tdb) => {
    const [k] = await tdb
      .select({
        id: apiKeys.id, tenantId: apiKeys.tenantId, name: apiKeys.name, keyHash: apiKeys.keyHash,
        scopes: apiKeys.scopes, createdBy: apiKeys.createdBy, expiresAt: apiKeys.expiresAt,
        revokedAt: apiKeys.revokedAt, lastUsedAt: apiKeys.lastUsedAt,
        tenantSlug: tenants.slug, tenantName: tenants.name, tenantStatus: tenants.status,
        businessType: tenants.businessType, aiEnabled: tenants.aiEnabled,
      })
      .from(apiKeys)
      .innerJoin(tenants, eq(tenants.id, apiKeys.tenantId))
      .where(eq(apiKeys.keyPrefix, parsed.prefix))
      .limit(1)
    return k
  })

  const expected = Buffer.from(row?.keyHash || '0'.repeat(64), 'hex')
  const actual = Buffer.from(hashApiKey(parsed.key), 'hex')
  const hashOk = expected.length === actual.length && timingSafeEqual(expected, actual)
  if (!row || !hashOk) return unauthorized('Invalid API key')
  if (row.revokedAt) return unauthorized('API key has been revoked', 'API_KEY_REVOKED')
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return unauthorized('API key has expired', 'API_KEY_EXPIRED')
  if (row.tenantStatus !== 'active') return { ok: false, response: apiError(403, 'Company account is not active', 'TENANT_INACTIVE') }

  const live = await getLiveCompanyUser(row.tenantId, row.createdBy)
  if (!live.ok || !(API_KEY_ADMIN_ROLES as readonly string[]).includes(live.role)) {
    return unauthorized('The user who created this API key is no longer allowed to use it', 'API_KEY_OWNER_INACTIVE')
  }

  const scopes = sanitizeScopes(row.scopes)
  if (!scopes.includes(scope)) {
    return { ok: false, response: apiError(403, `API key lacks the "${scope}" scope`, 'INSUFFICIENT_SCOPE') }
  }

  const rate = await hitKeyRateLimit(row.id)
  const rateHeaders = {
    'X-RateLimit-Limit': String(API_RATE_LIMIT_PER_MIN),
    'X-RateLimit-Remaining': String(rate.remaining),
    'X-RateLimit-Reset': String(rate.resetSec),
  }
  if (rate.limited) {
    return { ok: false, response: apiError(429, 'Rate limit exceeded', 'RATE_LIMITED', { ...rateHeaders, 'Retry-After': String(rate.resetSec) }) }
  }

  const user = await withoutTenant(async (tdb) => tdb.query.users.findFirst({
    where: and(eq(users.id, row.createdBy), eq(users.tenantId, row.tenantId)),
    columns: { id: true, accountId: true, email: true, fullName: true },
  }))
  if (!user) return unauthorized('Invalid API key')

  // Touch last_used_at at most once a minute (no write per request).
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    void withoutTenant((tdb) => tdb.update(apiKeys)
      .set({ lastUsedAt: new Date(), lastUsedIp: ip.slice(0, 64) })
      .where(eq(apiKeys.id, row.id)))
      .catch((err) => logError('api-keys/touch', err))
  }

  const session: CompanySession = {
    user: {
      id: user.id,
      accountId: user.accountId ?? null,
      email: user.email,
      name: `${user.fullName || user.email} (API: ${row.name})`.slice(0, 255),
      role: live.role,
      customRoleId: live.customRoleId,
      tenantId: row.tenantId,
      tenantSlug: row.tenantSlug,
      tenantName: row.tenantName,
      businessType: row.businessType,
      aiEnabled: row.aiEnabled,
      isSuperAdmin: false,
      isOwner: live.role === 'owner',
      mode: 'company',
    },
  }

  // Same permission cache wiring authWithCompany does for cookie / mobile sessions.
  try {
    const cache = await import('./permission-cache')
    const { registerPermissionOverrides } = await import('./roles')
    registerPermissionOverrides({
      getPermissionOverride: cache.getPermissionOverride,
      getCustomRolePermission: cache.getCustomRolePermission,
      getCustomRoleBaseRole: cache.getCustomRoleBaseRole,
    })
    await cache.warmPermissionCache(row.tenantId)
  } catch {
    // non-fatal: falls back to system defaults
  }

  return { ok: true, principal: { session, apiKeyId: row.id, apiKeyName: row.name, scopes }, rateHeaders }
}

/**
 * Wrap a v1 handler: authenticate + scope check + rate limit, then run `handler` with the
 * API-key principal installed (authWithCompany() inside it returns the principal's session).
 */
export async function withApiKey(
  request: NextRequest,
  scope: ApiScope,
  handler: (principal: ApiKeyPrincipal) => Promise<Response>,
): Promise<Response> {
  try {
    const auth = await authenticateApiKey(request, scope)
    if (!auth.ok) return auth.response
    // The platform can switch API access off per business (super admin → Features)
    const { requireTenantFeature } = await import('@/lib/features/check')
    if (!(await requireTenantFeature(auth.principal.session.user.tenantId, 'api_access')).ok) {
      return apiError(403, 'API access is turned off for this business', 'FEATURE_DISABLED')
    }
    const res = await runWithApiPrincipal(auth.principal, () => handler(auth.principal))
    for (const [k, v] of Object.entries(auth.rateHeaders)) res.headers.set(k, v)
    res.headers.set('Cache-Control', 'no-store')
    return res
  } catch (error) {
    logError('api/v1', error, { path: new URL(request.url).pathname })
    return apiError(500, 'Internal error', 'INTERNAL')
  }
}
