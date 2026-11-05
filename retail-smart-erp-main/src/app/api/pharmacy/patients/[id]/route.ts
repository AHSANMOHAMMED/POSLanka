import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { customers } from '@/lib/db/schema'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { requireAnyPermission } from '@/lib/pharmacy/route-helpers'

/**
 * GET   /api/pharmacy/patients/[customerId] — allergies / medical notes (the POS warning)
 * PATCH /api/pharmacy/patients/[customerId] { allergies?, medicalNotes? } — '' clears a field
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requireAnyPermission(session, ['createSales', 'viewReports'])
    if (permError) return permError
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const row = await withTenant(session.user.tenantId, async (db) => {
      const [c] = await db.select({ id: customers.id, name: customers.name, phone: customers.phone, allergies: customers.allergies, medicalNotes: customers.medicalNotes })
        .from(customers).where(and(eq(customers.tenantId, session.user.tenantId), eq(customers.id, p.data.id))).limit(1)
      return c
    })
    if (!row) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    return NextResponse.json({ ...row, hasWarning: !!(row.allergies?.trim() || row.medicalNotes?.trim()) })
  } catch (error) {
    logError('api/pharmacy/patients/[id] GET', error)
    return NextResponse.json({ error: 'Failed to load the patient' }, { status: 500 })
  }
}

const patchSchema = z.object({
  allergies: z.string().max(2000).optional(),
  medicalNotes: z.string().max(4000).optional(),
})

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'createSales')
    if (permError) return permError
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const body = await validateBody(request, patchSchema, { keepEmptyStrings: true })
    if (!body.success) return body.response
    const set: { allergies?: string | null; medicalNotes?: string | null; updatedAt: Date } = { updatedAt: new Date() }
    if (body.data.allergies !== undefined) set.allergies = body.data.allergies.trim() || null
    if (body.data.medicalNotes !== undefined) set.medicalNotes = body.data.medicalNotes.trim() || null
    const row = await withTenant(session.user.tenantId, async (db) => {
      const [c] = await db.update(customers).set(set)
        .where(and(eq(customers.tenantId, session.user.tenantId), eq(customers.id, p.data.id)))
        .returning({ id: customers.id, allergies: customers.allergies, medicalNotes: customers.medicalNotes })
      return c
    })
    if (!row) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    logAndBroadcast(session.user.tenantId, 'customer', 'updated', row.id, { userId: session.user.id })
    return NextResponse.json(row)
  } catch (error) {
    logError('api/pharmacy/patients/[id] PATCH', error)
    return NextResponse.json({ error: 'Failed to save the patient notes' }, { status: 500 })
  }
}
