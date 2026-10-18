import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { salaryStructures, salaryStructureComponents } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateSalaryStructureSchema } from '@/lib/validation/schemas/hr'
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

    const permError = requirePermission(session, 'manageSalaryComponents')
    if (permError) return permError

    return await withTenant(session.user.tenantId, async (db) => {
      const structure = await db.query.salaryStructures.findFirst({
        where: eq(salaryStructures.id, id),
        with: { components: { with: { component: true }, orderBy: (c, { asc }) => [asc(c.sortOrder)] } },
      })

      if (!structure) {
        return NextResponse.json({ error: 'Salary structure not found' }, { status: 404 })
      }

      return NextResponse.json(structure)
    })
  } catch (error) {
    logError('api/salary-structures/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch salary structure' }, { status: 500 })
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

    const permError = requirePermission(session, 'manageSalaryComponents')
    if (permError) return permError

    const parsed = await validateBody(request, updateSalaryStructureSchema)
    if (!parsed.success) return parsed.response
    const { name, description, isActive, components: componentEntries, expectedUpdatedAt } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const existing = await db.query.salaryStructures.findFirst({
        where: eq(salaryStructures.id, id),
      })

      if (!existing) {
        return NextResponse.json({ error: 'Salary structure not found' }, { status: 404 })
      }

      // Optimistic locking
      if (expectedUpdatedAt) {
        const clientTime = new Date(expectedUpdatedAt).getTime()
        const serverTime = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0
        if (serverTime > clientTime) {
          return NextResponse.json({
            error: 'This record was modified by another user. Please refresh and try again.',
            code: 'CONFLICT',
          }, { status: 409 })
        }
      }

      // Update structure
      const updateData: Record<string, unknown> = { updatedAt: new Date() }
      if (name !== undefined) updateData.name = name.trim()
      if (description !== undefined) updateData.description = description
      if (isActive !== undefined) updateData.isActive = isActive

      await db
        .update(salaryStructures)
        .set(updateData)
        .where(eq(salaryStructures.id, id))

      // Replace components if provided (atomic delete+insert in transaction)
      if (componentEntries !== undefined) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await db.transaction(async (tx: any) => {
          // Delete existing
          await tx
            .delete(salaryStructureComponents)
            .where(eq(salaryStructureComponents.structureId, id))

          // Insert new
          if (componentEntries.length > 0) {
            await tx.insert(salaryStructureComponents).values(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              componentEntries.map((c: any, idx: number) => ({
                tenantId: session.user.tenantId,
                structureId: id,
                componentId: c.componentId,
                overrideFormula: c.overrideFormula || null,
                overrideAmount: c.overrideAmount != null ? String(c.overrideAmount) : null,
                sortOrder: c.sortOrder ?? idx,
                isActive: true,
              }))
            )
          }
        })
      }

      const result = await db.query.salaryStructures.findFirst({
        where: eq(salaryStructures.id, id),
        with: { components: { with: { component: true }, orderBy: (c, { asc }) => [asc(c.sortOrder)] } },
      })

      logAndBroadcast(session.user.tenantId, 'salary-structure', 'updated', id)

      return NextResponse.json(result)
    })
  } catch (error) {
    logError('api/salary-structures/[id]', error)
    return NextResponse.json({ error: 'Failed to update salary structure' }, { status: 500 })
  }
}

export async function DELETE(
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

    const permError = requirePermission(session, 'manageSalaryComponents')
    if (permError) return permError

    return await withTenant(session.user.tenantId, async (db) => {
      const existing = await db.query.salaryStructures.findFirst({
        where: eq(salaryStructures.id, id),
      })

      if (!existing) {
        return NextResponse.json({ error: 'Salary structure not found' }, { status: 404 })
      }

      await db
        .update(salaryStructures)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(salaryStructures.id, id))

      logAndBroadcast(session.user.tenantId, 'salary-structure', 'updated', id)

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/salary-structures/[id]', error)
    return NextResponse.json({ error: 'Failed to deactivate salary structure' }, { status: 500 })
  }
}
