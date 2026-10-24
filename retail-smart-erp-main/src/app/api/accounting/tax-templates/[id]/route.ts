import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant, withTenantTransaction } from '@/lib/db'
import { taxTemplates, taxTemplateItems, items } from '@/lib/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateTaxTemplateSchema } from '@/lib/validation/schemas/accounting'
import { TAX_CATEGORIES } from '@/lib/utils/tax-category'
import { z } from 'zod'

const updateWithCategorySchema = updateTaxTemplateSchema.extend({
  taxCategory: z.enum(TAX_CATEGORIES).optional(),
})
import { idParamSchema } from '@/lib/validation/schemas/common'
import { moveToRecycleBin } from '@/lib/recycle-bin'

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

    return await withTenant(session.user.tenantId, async (db) => {
      const template = await db.query.taxTemplates.findFirst({
        where: eq(taxTemplates.id, id),
        with: {
          items: {
            with: {
              account: true,
            },
          },
        },
      })

      if (!template) {
        return NextResponse.json({ error: 'Tax template not found' }, { status: 404 })
      }

      return NextResponse.json(template)
    })
  } catch (error) {
    logError('api/accounting/tax-templates/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch tax template' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageAccounting')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateWithCategorySchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data
    const tenantId = session!.user.tenantId

    return await withTenantTransaction(tenantId, async (tx) => {
      const existing = await tx.query.taxTemplates.findFirst({
        where: eq(taxTemplates.id, id),
      })

      if (!existing) {
        return NextResponse.json({ error: 'Tax template not found' }, { status: 404 })
      }

      // Build update data - only include provided fields
      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      }

      if (body.name !== undefined) updateData.name = body.name
      if (body.isActive !== undefined) updateData.isActive = body.isActive
      if (body.taxCategory !== undefined) updateData.taxCategory = body.taxCategory

      const [updated] = await tx.update(taxTemplates)
        .set(updateData)
        .where(eq(taxTemplates.id, id))
        .returning()

      // If items are provided, replace all items
      if (body.items && Array.isArray(body.items)) {
        // Delete existing items
        await tx.delete(taxTemplateItems).where(eq(taxTemplateItems.taxTemplateId, id))

        // Insert new items
        for (const item of body.items) {
          if (!item.taxName || item.rate === undefined) continue

          await tx.insert(taxTemplateItems).values({
            tenantId,
            taxTemplateId: id,
            taxName: item.taxName,
            rate: String(Number(item.rate)),
            accountId: item.accountId || null,
            includedInPrice: item.includedInPrice ?? false,
          })
        }
      }

      logAndBroadcast(tenantId, 'tax-template', 'updated', id)
      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/accounting/tax-templates/[id]', error)
    return NextResponse.json({ error: 'Failed to update tax template' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageAccounting')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const tenantId = session!.user.tenantId

    return await withTenant(tenantId, async (db) => {
      const existing = await db.query.taxTemplates.findFirst({
        where: eq(taxTemplates.id, id),
      })

      if (!existing) {
        return NextResponse.json({ error: 'Tax template not found' }, { status: 404 })
      }

      // Items that still charge this tax must be moved to another template first
      const [{ itemRefCount }] = await db
        .select({ itemRefCount: sql<number>`count(*)::int` })
        .from(items)
        .where(and(eq(items.taxTemplateId, id), eq(items.isActive, true)))

      if (Number(itemRefCount) > 0) {
        return NextResponse.json(
          { error: 'Cannot move a tax template that is assigned to items to the recycle bin' },
          { status: 400 }
        )
      }

      // Vendors never hard-delete: archive + recycle bin (only a super admin can restore or purge)
      const binned = await moveToRecycleBin(db, {
        tenantId: tenantId, entityType: 'tax_template', entityId: id, userId: session!.user.id, userName: session!.user.name,
      })
      if (!binned) {
        return NextResponse.json({ error: 'Tax template not found' }, { status: 404 })
      }

      logAndBroadcast(tenantId, 'tax-template', 'deleted', id)
      return NextResponse.json({ success: true, archived: true, recycleBinId: binned.binId })
    })
  } catch (error) {
    logError('api/accounting/tax-templates/[id]', error)
    return NextResponse.json({ error: 'Failed to delete tax template' }, { status: 500 })
  }
}
