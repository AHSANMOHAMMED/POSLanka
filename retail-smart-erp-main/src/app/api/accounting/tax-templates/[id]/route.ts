import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant, withTenantTransaction } from '@/lib/db'
import { taxTemplates, taxTemplateItems } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateTaxTemplateSchema } from '@/lib/validation/schemas/accounting'
import { idParamSchema } from '@/lib/validation/schemas/common'

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
    const parsed = await validateBody(request, updateTaxTemplateSchema)
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

      // Check if tax template is referenced anywhere
      // Check items table for tax_template_id references
      const [{ refCount: _refCount }] = await db
        .select({ refCount: sql<number>`count(*)::int` })
        .from(taxTemplateItems)
        .where(eq(taxTemplateItems.taxTemplateId, id))

      // Note: taxTemplateItems have onDelete: 'cascade', so they'll be auto-deleted.
      // The real concern is external references (e.g., sales, items using this template).
      // For now, we check if the template is referenced via a generic query on known tables.
      // Since tax templates are configuration objects, we allow deletion if no external
      // references exist. Items with cascade delete will be cleaned up automatically.

      // Check for references in items table (if items have a taxTemplateId column)
      try {
        const [{ itemRefCount }] = await db
          .execute(sql`
            SELECT count(*)::int as "itemRefCount"
            FROM items
            WHERE tax_template_id = ${id}
          `) as unknown as { itemRefCount: number }[]

        if (Number(itemRefCount) > 0) {
          return NextResponse.json(
            { error: 'Cannot delete tax template that is assigned to items' },
            { status: 400 }
          )
        }
      } catch {
        // Column may not exist yet - skip this check
      }

      // Delete template (items cascade-deleted)
      await db.delete(taxTemplates).where(eq(taxTemplates.id, id))

      logAndBroadcast(tenantId, 'tax-template', 'deleted', id)
      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/accounting/tax-templates/[id]', error)
    return NextResponse.json({ error: 'Failed to delete tax template' }, { status: 500 })
  }
}
