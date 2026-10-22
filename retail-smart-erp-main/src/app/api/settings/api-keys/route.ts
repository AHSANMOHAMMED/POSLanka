import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { requireRole } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { apiKeys, users } from '@/lib/db/schema'
import { validateBody } from '@/lib/validation'
import { API_SCOPES, generateApiKey } from '@/lib/auth/api-keys'
import { logActivity } from '@/lib/utils/activity-log'
import { logError } from '@/lib/ai/error-logger'

const MAX_ACTIVE_KEYS = 25

const createApiKeySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  scopes: z.array(z.enum(API_SCOPES)).min(1, 'Select at least one scope').max(API_SCOPES.length),
  /** Days until the key expires; omitted = never */
  expiresInDays: z.coerce.number().int().min(1).max(3650).optional(),
})

const KEY_COLUMNS = {
  id: apiKeys.id,
  name: apiKeys.name,
  keyPrefix: apiKeys.keyPrefix,
  scopes: apiKeys.scopes,
  createdAt: apiKeys.createdAt,
  lastUsedAt: apiKeys.lastUsedAt,
  lastUsedIp: apiKeys.lastUsedIp,
  expiresAt: apiKeys.expiresAt,
  revokedAt: apiKeys.revokedAt,
  createdBy: apiKeys.createdBy,
  createdByName: users.fullName,
}

// GET /api/settings/api-keys — list the company's API keys (never the secret or its hash)
export async function GET() {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const roleError = requireRole(session, ['owner', 'manager'])
    if (roleError) return roleError

    return await withTenant(session.user.tenantId, async (db) => {
      const rows = await db
        .select(KEY_COLUMNS)
        .from(apiKeys)
        .leftJoin(users, eq(users.id, apiKeys.createdBy))
        .orderBy(desc(apiKeys.createdAt))
      return NextResponse.json(rows)
    })
  } catch (error) {
    logError('api/settings/api-keys', error)
    return NextResponse.json({ error: 'Failed to fetch API keys' }, { status: 500 })
  }
}

// POST /api/settings/api-keys — create a key; the secret is returned ONCE and only its hash is stored
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const roleError = requireRole(session, ['owner', 'manager'])
    if (roleError) return roleError

    const parsed = await validateBody(request, createApiKeySchema)
    if (!parsed.success) return parsed.response
    const { name, scopes, expiresInDays } = parsed.data
    const tenantId = session.user.tenantId
    const userId = await resolveUserIdRequired(session)

    const generated = generateApiKey()
    const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000) : null

    const created = await withTenant(tenantId, async (db) => {
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(apiKeys)
        .where(and(isNull(apiKeys.revokedAt), sql`(${apiKeys.expiresAt} IS NULL OR ${apiKeys.expiresAt} > now())`))
      if (Number(count) >= MAX_ACTIVE_KEYS) return null
      const [row] = await db.insert(apiKeys).values({
        tenantId,
        name,
        keyPrefix: generated.prefix,
        keyHash: generated.hash,
        scopes: [...new Set(scopes)],
        createdBy: userId,
        expiresAt,
      }).returning({ id: apiKeys.id, name: apiKeys.name, keyPrefix: apiKeys.keyPrefix, scopes: apiKeys.scopes, createdAt: apiKeys.createdAt, expiresAt: apiKeys.expiresAt })
      return row
    })
    if (!created) {
      return NextResponse.json({ error: `A company can have at most ${MAX_ACTIVE_KEYS} active API keys. Revoke unused keys first.` }, { status: 400 })
    }

    await logActivity({
      tenantId,
      userId,
      action: 'create',
      entityType: 'api_key',
      entityId: created.id,
      entityName: created.name,
      description: `Created API key "${created.name}" (${created.keyPrefix}) with scopes ${created.scopes.join(', ')}`,
      metadata: { keyPrefix: created.keyPrefix, scopes: created.scopes, expiresAt: created.expiresAt },
    })

    return NextResponse.json({ ...created, secret: generated.key }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    logError('api/settings/api-keys', error)
    return NextResponse.json({ error: 'Failed to create API key' }, { status: 500 })
  }
}
