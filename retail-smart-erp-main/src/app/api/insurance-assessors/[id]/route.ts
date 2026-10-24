import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { insuranceAssessors } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateInsuranceAssessorSchema } from '@/lib/validation/schemas/insurance'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { moveToRecycleBin } from '@/lib/recycle-bin'

// GET single insurance assessor
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
      const assessor = await db.query.insuranceAssessors.findFirst({
        where: eq(insuranceAssessors.id, id),
        with: {
          insuranceCompany: true,
        },
      })

      if (!assessor) {
        return NextResponse.json({ error: 'Assessor not found' }, { status: 404 })
      }

      return NextResponse.json(assessor)
    })
  } catch (error) {
    logError('api/insurance-assessors/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch insurance assessor' }, { status: 500 })
  }
}

// PUT update insurance assessor
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
    const parsed = await validateBody(request, updateInsuranceAssessorSchema)
    if (!parsed.success) return parsed.response
    const { insuranceCompanyId, name, phone, email, isActive } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      const [updated] = await db.update(insuranceAssessors)
        .set({
          insuranceCompanyId: insuranceCompanyId || null,
          name,
          phone: phone || null,
          email: email || null,
          isActive: isActive ?? true,
          updatedAt: new Date(),
        })
        .where(eq(insuranceAssessors.id, id))
        .returning()

      if (!updated) {
        return NextResponse.json({ error: 'Assessor not found' }, { status: 404 })
      }

      // Broadcast the change
      logAndBroadcast(session!.user.tenantId, 'insurance-assessor', 'updated', id)

      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/insurance-assessors/[id]', error)
    return NextResponse.json({ error: 'Failed to update insurance assessor' }, { status: 500 })
  }
}

// DELETE insurance assessor
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
      // Vendors never hard-delete: archive + recycle bin (only a super admin can restore or purge)
      const binned = await moveToRecycleBin(db, {
        tenantId: session!.user.tenantId, entityType: 'insurance_assessor', entityId: id, userId: session!.user.id, userName: session!.user.name,
      })
      if (!binned) {
        return NextResponse.json({ error: 'Assessor not found' }, { status: 404 })
      }

      // Broadcast the change
      logAndBroadcast(session!.user.tenantId, 'insurance-assessor', 'deleted', id)

      return NextResponse.json({ success: true, archived: true, recycleBinId: binned.binId })
    })
  } catch (error) {
    logError('api/insurance-assessors/[id]', error)
    return NextResponse.json({ error: 'Failed to delete insurance assessor' }, { status: 500 })
  }
}
