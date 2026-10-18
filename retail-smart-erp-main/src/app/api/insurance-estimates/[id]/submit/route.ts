import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { insuranceEstimates, insuranceEstimateRevisions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { requirePermission } from '@/lib/auth/roles'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

// POST submit estimate to insurance
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

    const quotaError = await requireQuota(session.user.tenantId, 'essential')
    if (quotaError) return quotaError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id: estimateId } = paramsParsed.data

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

      // Validate current status - can only submit from draft
      if (estimate.status !== 'draft') {
        return NextResponse.json({ error: 'Can only submit draft estimates' }, { status: 400 })
      }

      // Validate estimate has items
      if (!estimate.items || estimate.items.length === 0) {
        return NextResponse.json({ error: 'Estimate must have at least one item to submit' }, { status: 400 })
      }

      // E1: Insurance company required only for insurance estimates, not direct estimates
      const isDirectEstimate = estimate.estimateType === 'direct'
      if (!isDirectEstimate && !estimate.insuranceCompanyId) {
        return NextResponse.json({ error: 'Insurance company is required to submit insurance estimates' }, { status: 400 })
      }

      // Create revision snapshot before submitting
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
      }))

      // withTenant already wraps in a transaction — no nested db.transaction() which resets SET LOCAL RLS context.

      // Create revision record
      await db.insert(insuranceEstimateRevisions).values({
        tenantId: session.user.tenantId,
        estimateId,
        revisionNumber: estimate.revisionNumber,
        estimateSnapshot,
        itemsSnapshot,
        changeReason: 'Initial submission',
        changedBy: session.user.id,
      })

      // Update estimate status
      await db.update(insuranceEstimates)
        .set({
          status: 'submitted',
          submittedBy: session.user.id,
          submittedAt: new Date(),
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
          items: true,
          revisions: true,
        },
      })

      // Broadcast the change
      logAndBroadcast(session.user.tenantId, 'estimate', 'updated', estimateId)

      return NextResponse.json(updatedEstimate)
    })
  } catch (error) {
    logError('api/insurance-estimates/[id]/submit', error)
    return NextResponse.json({ error: 'Failed to submit estimate' }, { status: 500 })
  }
}
