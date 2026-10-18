import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { insuranceEstimates, insuranceEstimateItems, insuranceEstimateRevisions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { requirePermission } from '@/lib/auth/roles'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { recalculateDocumentTax } from '@/lib/utils/tax-recalculate'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { reviseEstimateSchema } from '@/lib/validation/schemas/insurance'
import { idParamSchema } from '@/lib/validation/schemas/common'

// POST create a revision of the estimate (for resubmission after rejection/partial approval)
export async function POST(
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

    const quotaError = await requireQuota(session!.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id: estimateId } = paramsParsed.data
    const parsed = await validateBody(request, reviseEstimateSchema)
    if (!parsed.success) return parsed.response
    const { changeReason } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Get estimate with items (RLS scopes to tenant)
      const estimate = await db.query.insuranceEstimates.findFirst({
        where: eq(insuranceEstimates.id, estimateId),
        with: {
          items: true,
        },
      })

      if (!estimate) {
        return NextResponse.json({ error: 'Estimate not found' }, { status: 404 })
      }

      // Validate current status - can only revise rejected or partially_approved estimates
      if (!['rejected', 'partially_approved'].includes(estimate.status)) {
        return NextResponse.json({ error: 'Can only revise rejected or partially approved estimates' }, { status: 400 })
      }

      // Create revision snapshot before revising
      const estimateSnapshot = {
        estimateNo: estimate.estimateNo,
        customerId: estimate.customerId,
        vehicleId: estimate.vehicleId,
        insuranceCompanyId: estimate.insuranceCompanyId,
        policyNumber: estimate.policyNumber,
        claimNumber: estimate.claimNumber,
        assessorName: estimate.assessorName,
        assessorPhone: estimate.assessorPhone,
        assessorEmail: estimate.assessorEmail,
        incidentDate: estimate.incidentDate,
        incidentDescription: estimate.incidentDescription,
        odometerIn: estimate.odometerIn,
        originalSubtotal: estimate.originalSubtotal,
        originalTaxAmount: estimate.originalTaxAmount,
        originalTotal: estimate.originalTotal,
        approvedSubtotal: estimate.approvedSubtotal,
        approvedTaxAmount: estimate.approvedTaxAmount,
        approvedTotal: estimate.approvedTotal,
        insuranceRemarks: estimate.insuranceRemarks,
        reviewedAt: estimate.reviewedAt,
      }

      const itemsSnapshot = estimate.items.map(item => ({
        id: item.id,
        itemType: item.itemType,
        serviceTypeId: item.serviceTypeId,
        description: item.description,
        hours: item.hours,
        rate: item.rate,
        itemId: item.itemId,
        partName: item.partName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        originalAmount: item.originalAmount,
        approvedAmount: item.approvedAmount,
        status: item.status,
        rejectionReason: item.rejectionReason,
        assessorNotes: item.assessorNotes,
      }))

      const newRevisionNumber = estimate.revisionNumber + 1

      // withTenant already wraps in a transaction — no nested db.transaction() which resets SET LOCAL RLS context.

      // Create revision record for current state
      await db.insert(insuranceEstimateRevisions).values({
        tenantId: session.user.tenantId,
        estimateId,
        revisionNumber: estimate.revisionNumber,
        estimateSnapshot,
        itemsSnapshot,
        changeReason: changeReason || `Revision ${estimate.revisionNumber} before resubmission`,
        changedBy: session.user.id,
      })

      // Reset all item statuses to pending
      await db.update(insuranceEstimateItems)
        .set({
          status: 'pending',
          approvedAmount: null,
          rejectionReason: null,
          assessorNotes: null,
        })
        .where(eq(insuranceEstimateItems.estimateId, estimateId))

      // Issue #58: Recalculate original totals from current item values
      let recalcSubtotal = 0
      for (const item of estimate.items) {
        recalcSubtotal += parseFloat(item.originalAmount)
      }
      recalcSubtotal = Math.round(recalcSubtotal * 100) / 100

      // Use tax template system to recalculate
      const lineItems = estimate.items.map(item => ({
        itemId: item.itemId,
        lineTotal: parseFloat(item.originalAmount),
      }))
      const taxResult = await recalculateDocumentTax(db, session.user.tenantId, lineItems, { type: 'sales' })
      const recalcTaxAmount = taxResult.totalTax
      const recalcTotal = taxResult.total

      // Reset estimate to draft with new revision number and recalculated totals
      await db.update(insuranceEstimates)
        .set({
          status: 'draft',
          revisionNumber: newRevisionNumber,
          originalSubtotal: recalcSubtotal.toString(),
          originalTaxAmount: recalcTaxAmount.toString(),
          originalTotal: recalcTotal.toString(),
          approvedSubtotal: '0',
          approvedTaxAmount: '0',
          approvedTotal: '0',
          insuranceRemarks: null,
          reviewedAt: null,
          submittedAt: null,
          submittedBy: null,
          updatedAt: new Date(),
        })
        .where(eq(insuranceEstimates.id, estimateId))

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
          revisions: {
            orderBy: (revisions, { desc }) => [desc(revisions.revisionNumber)],
          },
        },
      })

      // Broadcast the change
      logAndBroadcast(session.user.tenantId, 'estimate', 'updated', estimateId)

      return NextResponse.json(updatedEstimate)
    })
  } catch (error) {
    logError('api/insurance-estimates/[id]/revise', error)
    return NextResponse.json({ error: 'Failed to revise estimate' }, { status: 500 })
  }
}
