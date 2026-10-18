import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { insuranceEstimates, insuranceEstimateItems, estimateTemplates } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { applyTemplateSchema } from '@/lib/validation/schemas/insurance'
import { idParamSchema } from '@/lib/validation/schemas/common'

interface TemplateItem {
  itemType: 'service' | 'part'
  serviceTypeId?: string | null
  description?: string | null
  hours?: number | null
  rate?: number | null
  itemId?: string | null
  partName?: string | null
  quantity?: number | null
  unitPrice?: number | null
}

// E25: Apply a template to an estimate
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageInsuranceEstimates')
    if (permError) return permError

    const quotaError = await requireQuota(session!.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id: estimateId } = paramsParsed.data
    const parsed = await validateBody(request, applyTemplateSchema)
    if (!parsed.success) return parsed.response
    const { templateId } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Verify estimate exists and is in draft status (RLS scopes to tenant)
      const estimate = await db.query.insuranceEstimates.findFirst({
        where: eq(insuranceEstimates.id, estimateId),
      })

      if (!estimate) {
        return NextResponse.json({ error: 'Estimate not found' }, { status: 404 })
      }

      if (estimate.status !== 'draft') {
        return NextResponse.json({ error: 'Can only apply templates to draft estimates' }, { status: 400 })
      }

      // Get the template (RLS scopes to tenant)
      const template = await db.query.estimateTemplates.findFirst({
        where: eq(estimateTemplates.id, templateId),
      })

      if (!template || !template.isActive) {
        return NextResponse.json({ error: 'Template not found' }, { status: 404 })
      }

      const templateItems = template.itemsTemplate as TemplateItem[]

      // Get current max sort order
      const existingItems = await db.query.insuranceEstimateItems.findMany({
        where: eq(insuranceEstimateItems.estimateId, estimateId),
      })
      let maxSortOrder = existingItems.reduce((max, item) => Math.max(max, item.sortOrder), 0)

      // Add template items to the estimate
      const addedItems = []
      for (const templateItem of templateItems) {
        maxSortOrder++

        let originalAmount = 0
        if (templateItem.itemType === 'service') {
          originalAmount = (templateItem.hours || 0) * (templateItem.rate || 0)
        } else {
          originalAmount = (templateItem.quantity || 0) * (templateItem.unitPrice || 0)
        }

        const [newItem] = await db.insert(insuranceEstimateItems).values({
          tenantId: session.user.tenantId,
          estimateId,
          itemType: templateItem.itemType,
          serviceTypeId: templateItem.serviceTypeId || null,
          description: templateItem.description || null,
          hours: templateItem.hours?.toString() || null,
          rate: templateItem.rate?.toString() || null,
          itemId: templateItem.itemId || null,
          partName: templateItem.partName || null,
          quantity: templateItem.quantity?.toString() || null,
          unitPrice: templateItem.unitPrice?.toString() || null,
          originalAmount: originalAmount.toString(),
          status: 'pending',
          sortOrder: maxSortOrder,
        }).returning()

        addedItems.push(newItem)
      }

      // Recalculate estimate totals
      const allItems = await db.query.insuranceEstimateItems.findMany({
        where: eq(insuranceEstimateItems.estimateId, estimateId),
      })

      const subtotal = allItems.reduce((sum, item) => sum + parseFloat(item.originalAmount), 0)
      const taxAmount = subtotal * 0 // No tax by default, adjust if needed

      await db.update(insuranceEstimates)
        .set({
          originalSubtotal: subtotal.toString(),
          originalTaxAmount: taxAmount.toString(),
          originalTotal: (subtotal + taxAmount).toString(),
          updatedAt: new Date(),
        })
        .where(eq(insuranceEstimates.id, estimateId))

      // Broadcast the change
      logAndBroadcast(session.user.tenantId, 'estimate', 'updated', estimateId)

      return NextResponse.json({
        success: true,
        itemsAdded: addedItems.length,
        templateName: template.name,
      })
    })
  } catch (error) {
    logError('api/insurance-estimates/[id]/apply-template', error)
    return NextResponse.json({ error: 'Failed to apply template' }, { status: 500 })
  }
}
