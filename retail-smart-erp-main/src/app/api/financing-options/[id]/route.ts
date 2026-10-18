import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { financingOptions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateFinancingOptionSchema } from '@/lib/validation/schemas/dealership'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET single financing option
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      const option = await db.query.financingOptions.findFirst({
        where: eq(financingOptions.id, id),
      })

      if (!option) {
        return NextResponse.json({ error: 'Financing option not found' }, { status: 404 })
      }

      return NextResponse.json(option)
    })
  } catch (error) {
    logError('api/financing-options/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch financing option' }, { status: 500 })
  }
}

// PUT update financing option
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageSettings')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateFinancingOptionSchema)
    if (!parsed.success) return parsed.response
    const {
      lenderName, contactInfo, loanType,
      minAmount, maxAmount, minTermMonths, maxTermMonths,
      interestRateMin, interestRateMax,
      notes, isActive,
    } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      const [updated] = await db.update(financingOptions)
        .set({
          lenderName: lenderName!,
          contactInfo: contactInfo || null,
          loanType: loanType || null,
          minAmount: minAmount ? String(minAmount) : null,
          maxAmount: maxAmount ? String(maxAmount) : null,
          minTermMonths: minTermMonths ?? null,
          maxTermMonths: maxTermMonths ?? null,
          interestRateMin: interestRateMin ? String(interestRateMin) : null,
          interestRateMax: interestRateMax ? String(interestRateMax) : null,
          notes: notes || null,
          isActive: isActive !== undefined ? isActive : undefined,
          updatedAt: new Date(),
        })
        .where(eq(financingOptions.id, id))
        .returning()

      if (!updated) {
        return NextResponse.json({ error: 'Financing option not found' }, { status: 404 })
      }

      // Broadcast the change to connected clients
      logAndBroadcast(session!.user.tenantId, 'financing-option', 'updated', id)

      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/financing-options/[id]', error)
    return NextResponse.json({ error: 'Failed to update financing option' }, { status: 500 })
  }
}

// DELETE financing option
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageSettings')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      // Soft delete - set isActive to false
      const [updated] = await db.update(financingOptions)
        .set({
          isActive: false,
          updatedAt: new Date(),
        })
        .where(eq(financingOptions.id, id))
        .returning()

      if (!updated) {
        return NextResponse.json({ error: 'Financing option not found' }, { status: 404 })
      }

      // Broadcast the change to connected clients
      logAndBroadcast(session!.user.tenantId, 'financing-option', 'deleted', id)

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/financing-options/[id]', error)
    return NextResponse.json({ error: 'Failed to delete financing option' }, { status: 500 })
  }
}
