import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { insuranceEstimates, insuranceEstimateItems } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { requirePermission } from '@/lib/auth/roles'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { recalculateDocumentTax } from '@/lib/utils/tax-recalculate'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { reviewEstimateSchema } from '@/lib/validation/schemas/insurance'
import { idParamSchema } from '@/lib/validation/schemas/common'

// PUT record insurance review response
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // E5: Check permission
    const permError = requirePermission(session, 'manageInsuranceEstimates')
    if (permError) return permError

    const quotaError = await requireQuota(session.user.tenantId, 'essential')
    if (quotaError) return quotaError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id: estimateId } = paramsParsed.data
    const parsed = await validateBody(request, reviewEstimateSchema)
    if (!parsed.success) return parsed.response
    const { status, insuranceRemarks, items } = parsed.data

    // Validate status value early (before transaction)
    const validResponseStatuses = ['under_review', 'approved', 'partially_approved', 'rejected']

    // Execute with RLS tenant context
    // withTenant already wraps in a transaction — no nested db.transaction() which resets SET LOCAL RLS context.
    return await withTenant(session.user.tenantId, async (db) => {
      // Lock and get estimate with items (RLS scopes to tenant)
      const [lockedEstimate] = await db
        .select()
        .from(insuranceEstimates)
        .where(eq(insuranceEstimates.id, estimateId))
        .for('update')

      if (!lockedEstimate) {
        throw new Error('NOT_FOUND')
      }

      // Get items (they're locked implicitly via estimate lock for most operations)
      const estimateItems = await db.query.insuranceEstimateItems.findMany({
        where: eq(insuranceEstimateItems.estimateId, estimateId),
      })

      // Check if this is an unreviewed items update (after review is complete)
      const hasUnreviewedItems = estimateItems.some(i => i.status === 'requires_reinspection' || i.status === 'pending')
      const isUnreviewedUpdate = ['approved', 'partially_approved', 'rejected'].includes(lockedEstimate.status) && hasUnreviewedItems

      // Validate current status
      if (!isUnreviewedUpdate && !['submitted', 'under_review'].includes(lockedEstimate.status)) {
        throw new Error('INVALID_STATUS')
      }

      // For unreviewed updates, only allow updating pending/re-inspection/price_adjusted items
      if (isUnreviewedUpdate && items && Array.isArray(items)) {
        const editableItemIds = estimateItems.filter(i =>
          i.status === 'requires_reinspection' || i.status === 'pending' || i.status === 'price_adjusted'
        ).map(i => i.id)
        const invalidItems = items.filter((item: { id: string }) => !editableItemIds.includes(item.id))
        if (invalidItems.length > 0) {
          throw new Error('INVALID_ITEMS')
        }
      }

      // Validate status for normal review (not re-inspection update)
      if (!isUnreviewedUpdate && (!status || !validResponseStatuses.includes(status))) {
        throw new Error('INVALID_REVIEW_STATUS')
      }
      // Update individual item statuses if provided
      if (items && Array.isArray(items)) {
        for (const itemUpdate of items) {
          const { id: itemId, status: itemStatus, approvedAmount, rejectionReason, assessorNotes } = itemUpdate

          if (!itemId) continue

          const updateData: Record<string, unknown> = {}

          if (itemStatus) {
            const validItemStatuses = ['pending', 'approved', 'price_adjusted', 'rejected', 'requires_reinspection']
            if (!validItemStatuses.includes(itemStatus)) continue
            updateData.status = itemStatus
          }

          // E3: Handle approvedAmount - when status is approved/price_adjusted, ensure amount is set
          if (approvedAmount != null) {
            updateData.approvedAmount = String(approvedAmount)
          } else if (['approved', 'price_adjusted'].includes(itemStatus!) && approvedAmount === undefined) {
            // E3: When changing to approved/price_adjusted without explicit amount,
            // fetch the item's original amount and use it as default
            const currentItem = estimateItems.find(i => i.id === itemId)
            if (currentItem && !currentItem.approvedAmount) {
              updateData.approvedAmount = currentItem.originalAmount
            }
          }

          if (rejectionReason !== undefined) {
            updateData.rejectionReason = rejectionReason || null
          }

          if (assessorNotes !== undefined) {
            updateData.assessorNotes = assessorNotes || null
          }

          if (Object.keys(updateData).length > 0) {
            await db.update(insuranceEstimateItems)
              .set(updateData)
              .where(and(
                eq(insuranceEstimateItems.id, itemId),
                eq(insuranceEstimateItems.estimateId, estimateId)
              ))
          }
        }
      }

      // E2: Calculate approved totals after item updates
      // Use COALESCE to fall back to original_amount when approved_amount is NULL
      const [totalsResult] = await db
        .select({
          approvedSubtotal: sql<string>`COALESCE(SUM(CAST(COALESCE(approved_amount, original_amount) AS DECIMAL)), 0)`,
        })
        .from(insuranceEstimateItems)
        .where(and(
          eq(insuranceEstimateItems.estimateId, estimateId),
          sql`${insuranceEstimateItems.status} IN ('approved', 'price_adjusted')`
        ))

      const approvedSubtotal = parseFloat(totalsResult?.approvedSubtotal || '0')

      // Fetch approved items for per-item template tax calculation
      const approvedItems = await db.query.insuranceEstimateItems.findMany({
        where: and(
          eq(insuranceEstimateItems.estimateId, estimateId),
          sql`${insuranceEstimateItems.status} IN ('approved', 'price_adjusted')`
        ),
      })
      const approvedLineItems = approvedItems.map(item => ({
        itemId: item.itemId,
        lineTotal: parseFloat(item.approvedAmount || item.originalAmount),
      }))
      const approvedTaxResult = await recalculateDocumentTax(db, session.user.tenantId, approvedLineItems, { type: 'sales' })
      const approvedTaxAmount = approvedTaxResult.totalTax
      const approvedTotal = approvedTaxResult.total

      // Update estimate status and totals
      // For re-inspection updates, don't change the status - just update totals
      if (isUnreviewedUpdate) {
        await db.update(insuranceEstimates)
          .set({
            approvedSubtotal: String(approvedSubtotal),
            approvedTaxAmount: String(approvedTaxAmount),
            approvedTotal: String(approvedTotal),
            updatedAt: new Date(),
          })
          .where(eq(insuranceEstimates.id, estimateId))
      } else {
        await db.update(insuranceEstimates)
          .set({
            status,
            insuranceRemarks: insuranceRemarks || null,
            reviewedAt: status && ['approved', 'partially_approved', 'rejected'].includes(status) ? new Date() : null,
            approvedSubtotal: String(approvedSubtotal),
            approvedTaxAmount: String(approvedTaxAmount),
            approvedTotal: String(approvedTotal),
            updatedAt: new Date(),
          })
          .where(eq(insuranceEstimates.id, estimateId))
      }

      // Fetch and return updated estimate
      const updatedEstimate = await db.query.insuranceEstimates.findFirst({
        where: eq(insuranceEstimates.id, estimateId),
        with: {
          customer: true,
          vehicle: true,
          insuranceCompany: true,
          items: {
            with: {
              serviceType: true,
              item: true,
            },
            orderBy: (items, { asc }) => [asc(items.sortOrder)],
          },
          revisions: true,
        },
      })

      // Broadcast the change
      logAndBroadcast(session.user.tenantId, 'estimate', 'updated', estimateId)

      return NextResponse.json(updatedEstimate)
    })
  } catch (error) {
    logError('api/insurance-estimates/[id]/review', error)
    const message = error instanceof Error ? error.message : ''

    if (message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Estimate not found' }, { status: 404 })
    }
    if (message === 'INVALID_STATUS') {
      return NextResponse.json({ error: 'Can only review submitted or under review estimates' }, { status: 400 })
    }
    if (message === 'INVALID_ITEMS') {
      return NextResponse.json({ error: 'Can only update pending, re-inspection, or price adjusted items' }, { status: 400 })
    }
    if (message === 'INVALID_REVIEW_STATUS') {
      return NextResponse.json({ error: 'Valid status is required (under_review, approved, partially_approved, rejected)' }, { status: 400 })
    }

    return NextResponse.json({ error: 'Failed to record review response' }, { status: 500 })
  }
}
