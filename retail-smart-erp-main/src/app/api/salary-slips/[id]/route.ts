import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { salarySlips } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateSalarySlipSchema } from '@/lib/validation/schemas/hr'
import { idParamSchema } from '@/lib/validation/schemas/common'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'viewPayroll')
    if (permError) return permError

    return await withTenant(session.user.tenantId, async (db) => {
      const slip = await db.query.salarySlips.findFirst({
        where: eq(salarySlips.id, id),
        with: {
          components: { orderBy: (c, { asc }) => [asc(c.sortOrder)] },
          employeeProfile: { with: { user: true } },
        },
      })

      if (!slip) {
        return NextResponse.json({ error: 'Salary slip not found' }, { status: 404 })
      }

      return NextResponse.json(slip)
    })
  } catch (error) {
    logError('api/salary-slips/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch salary slip' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'processPayroll')
    if (permError) return permError

    const parsed = await validateBody(request, updateSalarySlipSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const existing = await db.query.salarySlips.findFirst({
        where: eq(salarySlips.id, id),
      })

      if (!existing) {
        return NextResponse.json({ error: 'Salary slip not found' }, { status: 404 })
      }

      if (existing.status !== 'draft') {
        return NextResponse.json({ error: 'Only draft slips can be edited' }, { status: 400 })
      }

      const updateData: Record<string, unknown> = { updatedAt: new Date() }
      if (body.totalWorkingDays !== undefined) updateData.totalWorkingDays = String(body.totalWorkingDays)
      if (body.paymentDays !== undefined) updateData.paymentDays = String(body.paymentDays)
      if (body.paymentMethod !== undefined) updateData.paymentMethod = body.paymentMethod
      if (body.paymentReference !== undefined) updateData.paymentReference = body.paymentReference

      const [updated] = await db
        .update(salarySlips)
        .set(updateData)
        .where(eq(salarySlips.id, id))
        .returning()

      logAndBroadcast(session.user.tenantId, 'salary-slip', 'updated', id)

      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/salary-slips/[id]', error)
    return NextResponse.json({ error: 'Failed to update salary slip' }, { status: 500 })
  }
}
