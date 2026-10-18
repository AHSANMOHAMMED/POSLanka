import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { insuranceCompanies } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateInsuranceCompanySchema } from '@/lib/validation/schemas/insurance'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET single insurance company
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
      const company = await db.query.insuranceCompanies.findFirst({
        where: eq(insuranceCompanies.id, id),
      })

      if (!company) {
        return NextResponse.json({ error: 'Insurance company not found' }, { status: 404 })
      }

      return NextResponse.json(company)
    })
  } catch (error) {
    logError('api/insurance-companies/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch insurance company' }, { status: 500 })
  }
}

// PUT update insurance company
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageInsuranceCompanies')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateInsuranceCompanySchema)
    if (!parsed.success) return parsed.response
    const { name, shortName, phone, email, claimHotline, isPartnerGarage, estimateThreshold, isActive } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      const [updated] = await db.update(insuranceCompanies)
        .set({
          name,
          shortName: shortName || null,
          phone: phone || null,
          email: email || null,
          claimHotline: claimHotline || null,
          isPartnerGarage: isPartnerGarage ?? false,
          estimateThreshold: estimateThreshold || null,
          isActive: isActive ?? true,
          updatedAt: new Date(),
        })
        .where(eq(insuranceCompanies.id, id))
        .returning()

      if (!updated) {
        return NextResponse.json({ error: 'Insurance company not found' }, { status: 404 })
      }

      // Broadcast the change
      logAndBroadcast(session!.user.tenantId, 'insurance-company', 'updated', id)

      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/insurance-companies/[id]', error)
    return NextResponse.json({ error: 'Failed to update insurance company' }, { status: 500 })
  }
}

// DELETE insurance company
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageInsuranceCompanies')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      const [deleted] = await db.delete(insuranceCompanies)
        .where(eq(insuranceCompanies.id, id))
        .returning()

      if (!deleted) {
        return NextResponse.json({ error: 'Insurance company not found' }, { status: 404 })
      }

      // Broadcast the change
      logAndBroadcast(session!.user.tenantId, 'insurance-company', 'deleted', id)

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/insurance-companies/[id]', error)
    return NextResponse.json({ error: 'Failed to delete insurance company' }, { status: 500 })
  }
}
