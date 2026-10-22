import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { desc, eq, sql } from 'drizzle-orm'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { einvoiceOutbox, tenants } from '@/lib/db/schema'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation/helpers'
import { getTransmitter } from '@/lib/einvoice/transmitter'

async function state(db: Parameters<Parameters<typeof withTenant>[1]>[0], tenantId: string) {
  const [t] = await db.select({ enabled: tenants.einvoiceEnabled, enabledAt: tenants.einvoiceEnabledAt, taxId: tenants.taxId })
    .from(tenants).where(eq(tenants.id, tenantId)).limit(1)
  const counts = await db.select({ status: einvoiceOutbox.status, count: sql<number>`count(*)::int` })
    .from(einvoiceOutbox).groupBy(einvoiceOutbox.status)
  const recent = await db.select({
    id: einvoiceOutbox.id, documentType: einvoiceOutbox.documentType, documentNo: einvoiceOutbox.documentNo,
    documentDate: einvoiceOutbox.documentDate, status: einvoiceOutbox.status, attempts: einvoiceOutbox.attempts,
    lastError: einvoiceOutbox.lastError, irn: einvoiceOutbox.irn, updatedAt: einvoiceOutbox.updatedAt,
  }).from(einvoiceOutbox).orderBy(desc(einvoiceOutbox.createdAt)).limit(25)
  const transmitter = getTransmitter()
  return {
    recent,
    enabled: !!t?.enabled,
    enabledAt: t?.enabledAt || null,
    vatRegistered: !!t?.taxId,
    transmitter: transmitter.name,
    transmitterActive: transmitter.enabled,
    outbox: Object.fromEntries(counts.map((c) => [c.status, Number(c.count)])),
  }
}

// GET /api/einvoice/settings — e-invoicing switch, transmitter and outbox status counts
export async function GET() {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'viewAccounting')
    if (permError) return permError
    return await withTenant(session.user.tenantId, async (db) => NextResponse.json(await state(db, session.user.tenantId)))
  } catch (error) {
    logError('api/einvoice/settings', error)
    return NextResponse.json({ error: 'Failed to load e-invoice settings' }, { status: 500 })
  }
}

const putSchema = z.object({ enabled: z.boolean() })

// PUT /api/einvoice/settings {enabled} — documents issued from the moment it is enabled are queued
export async function PUT(request: NextRequest) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageAccounting')
    if (permError) return permError
    const parsed = await validateBody(request, putSchema)
    if (!parsed.success) return parsed.response
    const tenantId = session!.user.tenantId
    return await withTenant(tenantId, async (db) => {
      const [current] = await db.select({ enabled: tenants.einvoiceEnabled, taxId: tenants.taxId }).from(tenants).where(eq(tenants.id, tenantId)).limit(1)
      if (parsed.data.enabled && !current?.taxId) {
        return NextResponse.json({ error: 'Set the company VAT / TIN number (Settings → Business profile) before enabling e-invoicing' }, { status: 400 })
      }
      if (parsed.data.enabled !== !!current?.enabled) {
        await db.update(tenants).set({
          einvoiceEnabled: parsed.data.enabled,
          ...(parsed.data.enabled ? { einvoiceEnabledAt: new Date() } : {}),
          updatedAt: new Date(),
        }).where(eq(tenants.id, tenantId))
      }
      return NextResponse.json(await state(db, tenantId))
    })
  } catch (error) {
    logError('api/einvoice/settings', error)
    return NextResponse.json({ error: 'Failed to update e-invoice settings' }, { status: 500 })
  }
}
