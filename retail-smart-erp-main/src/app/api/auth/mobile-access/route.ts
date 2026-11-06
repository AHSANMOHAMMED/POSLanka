import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { tenants } from '@/lib/db/schema'
import { resolveLockMessage } from '@/lib/tenant/lock-message'

/**
 * GET /api/auth/mobile-access — shop app probe: is this Bearer session still allowed?
 * Returns 200 { ok:true } when the company is active; 403 TENANT_LOCKED with a full
 * reason when suspended / locked / archived (so the app can show a proper screen).
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization') || ''
  if (!authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  let payload: { type?: string; tenantId?: string }
  try {
    payload = jwt.verify(authHeader.slice(7), secret, { algorithms: ['HS256'] }) as { type?: string; tenantId?: string }
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (payload.type !== 'mobile' || !payload.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, payload.tenantId),
    columns: { id: true, status: true, lockedReason: true, settings: true, name: true, slug: true },
  })
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (tenant.status === 'active') {
    return NextResponse.json({ ok: true, status: 'active' })
  }

  const msg = resolveLockMessage({
    status: tenant.status,
    lockedReason: tenant.lockedReason,
    settings: tenant.settings,
  })
  return NextResponse.json({
    ok: false,
    code: 'TENANT_LOCKED',
    status: tenant.status,
    lockedReason: tenant.lockedReason,
    title: msg.title,
    description: msg.description,
    tenantName: tenant.name,
    tenantSlug: tenant.slug,
    error: `${msg.title}. ${msg.description}`,
  }, { status: 403 })
}
