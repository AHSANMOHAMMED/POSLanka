import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { tenants } from '@/lib/db/schema'
import { requirePermission } from '@/lib/auth/roles'
import { validateBody } from '@/lib/validation'
import { logError } from '@/lib/ai/error-logger'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { appearanceSchema, sanitizeAppearance } from '@/lib/ui/appearance'

/**
 * GET / PUT /api/tenant/appearance — the business's look (palette, UI style, sidebar, light / dark),
 * stored in tenants.settings.appearance. Everyone in the business reads it; owners / admins
 * (manageSettings) change it.
 */
export async function GET() {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const row = await withTenant(session.user.tenantId, (db) =>
      db.query.tenants.findFirst({ where: eq(tenants.id, session.user.tenantId), columns: { settings: true } }))
    const settings = (row?.settings || {}) as Record<string, unknown>
    return NextResponse.json(sanitizeAppearance(settings.appearance))
  } catch (error) {
    logError('api/tenant/appearance GET', error)
    return NextResponse.json({ error: 'Failed to load the appearance' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'manageSettings')
    if (permError) return permError
    // mode may be null ("each user chooses"): validateBody drops nulls, so read it as optional
    const parsed = await validateBody(request, appearanceSchema.extend({ mode: appearanceSchema.shape.mode.optional() }))
    if (!parsed.success) return parsed.response
    const next = { ...parsed.data, mode: parsed.data.mode ?? null, updatedAt: new Date().toISOString() }
    await withTenant(session.user.tenantId, async (db) => {
      const row = await db.query.tenants.findFirst({ where: eq(tenants.id, session.user.tenantId), columns: { settings: true } })
      const settings = { ...((row?.settings || {}) as Record<string, unknown>), appearance: next }
      await db.update(tenants).set({ settings }).where(eq(tenants.id, session.user.tenantId))
    })
    logAndBroadcast(session.user.tenantId, 'settings', 'updated', 'appearance', { userId: session.user.id })
    return NextResponse.json(next)
  } catch (error) {
    logError('api/tenant/appearance PUT', error)
    return NextResponse.json({ error: 'Failed to save the appearance' }, { status: 500 })
  }
}
