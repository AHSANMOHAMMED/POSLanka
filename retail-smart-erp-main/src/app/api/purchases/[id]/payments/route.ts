import { NextRequest, NextResponse } from 'next/server'
import { db as rawDb, withAuthTenant, withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { requireAnyPermission, PURCHASING_VIEW_PERMISSIONS } from '@/lib/purchasing/permissions'
import { purchases, purchasePayments, suppliers, users, supplierBalanceAudit, paymentEntryReferences, paymentEntries, journalEntryItems, journalEntries } from '@/lib/db/schema'
import { eq, desc, and, isNotNull } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { postPaymentToGL } from '@/lib/accounting/auto-post'
import { requireAccountingConfig } from '@/lib/accounting/validate-config'
import { requireQuota } from '@/lib/db/storage-quota'
import { authWithCompany } from '@/lib/auth'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { addPurchasePaymentSchema } from '@/lib/validation/schemas/purchases'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { insertCheque } from '@/lib/cheques/cheques'
import { getTenantFeatureFlags } from '@/lib/features/check'
import { assertRecordBranch } from '@/lib/auth/branch-access'

// GET payments for a purchase
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const result = await withAuthTenant(async (session, db) => {
    const permError = requireAnyPermission(session, PURCHASING_VIEW_PERMISSIONS)
    if (permError) return { error: permError }
    // K4: documents of another branch are off limits to branch-restricted staff
    const branchDenied = await assertRecordBranch(session, db, purchases, id)
    if (branchDenied) return { error: branchDenied }

    // Verify purchase exists (RLS filters by tenant)
    const [purchase] = await db
      .select({ id: purchases.id })
      .from(purchases)
      .where(eq(purchases.id, id))

    if (!purchase) {
      return { error: NextResponse.json({ error: 'Purchase not found' }, { status: 404 }) }
    }

    // Get payments
    const payments = await db
      .select({
        id: purchasePayments.id,
        amount: purchasePayments.amount,
        paymentMethod: purchasePayments.paymentMethod,
        paymentReference: purchasePayments.paymentReference,
        notes: purchasePayments.notes,
        paidAt: purchasePayments.paidAt,
        createdBy: purchasePayments.createdBy,
        createdByName: users.fullName,
        createdAt: purchasePayments.createdAt,
      })
      .from(purchasePayments)
      .leftJoin(users, eq(purchasePayments.createdBy, users.id))
      .where(eq(purchasePayments.purchaseId, id))
      .orderBy(desc(purchasePayments.createdAt))

    // Fetch PE-based payment entry references for this purchase
    const peRefs = await db
      .select({
        id: paymentEntryReferences.id,
        paymentEntryId: paymentEntryReferences.paymentEntryId,
        allocatedAmount: paymentEntryReferences.allocatedAmount,
        createdAt: paymentEntryReferences.createdAt,
        entryNumber: paymentEntries.entryNumber,
        paymentType: paymentEntries.paymentType,
        postingDate: paymentEntries.postingDate,
        status: paymentEntries.status,
        paidAmount: paymentEntries.paidAmount,
      })
      .from(paymentEntryReferences)
      .innerJoin(paymentEntries, eq(paymentEntryReferences.paymentEntryId, paymentEntries.id))
      .where(
        and(
          eq(paymentEntryReferences.referenceType, 'purchase'),
          eq(paymentEntryReferences.referenceId, id),
          eq(paymentEntries.status, 'submitted')
        )
      )

    // Fetch JE-based payment references (from journal entry reconciliation)
    const jeRefs = await db
      .select({
        id: paymentEntryReferences.id,
        sourceJeItemId: paymentEntryReferences.sourceJeItemId,
        allocatedAmount: paymentEntryReferences.allocatedAmount,
        createdAt: paymentEntryReferences.createdAt,
        entryNumber: journalEntries.entryNumber,
        postingDate: journalEntries.postingDate,
      })
      .from(paymentEntryReferences)
      .innerJoin(journalEntryItems, eq(paymentEntryReferences.sourceJeItemId, journalEntryItems.id))
      .innerJoin(journalEntries, eq(journalEntryItems.journalEntryId, journalEntries.id))
      .where(
        and(
          eq(paymentEntryReferences.referenceType, 'purchase'),
          eq(paymentEntryReferences.referenceId, id),
          isNotNull(paymentEntryReferences.sourceJeItemId)
        )
      )

    return {
      data: {
        payments,
        paymentEntries: peRefs.map(pe => ({
          id: pe.id,
          paymentEntryId: pe.paymentEntryId,
          entryNumber: pe.entryNumber,
          paymentType: pe.paymentType,
          postingDate: pe.postingDate,
          status: pe.status,
          allocatedAmount: pe.allocatedAmount,
          paidAmount: pe.paidAmount,
          createdAt: pe.createdAt,
        })),
        journalEntryAllocations: jeRefs.map(je => ({
          id: je.id,
          sourceJeItemId: je.sourceJeItemId,
          entryNumber: je.entryNumber,
          postingDate: je.postingDate,
          allocatedAmount: je.allocatedAmount,
          createdAt: je.createdAt,
        })),
      },
    }
  })

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if ('error' in result) {
    return result.error
  }
  return NextResponse.json(result.data)
}

// POST record a payment
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const parsed = await validateBody(request, addPurchasePaymentSchema)
  if (!parsed.success) return parsed.response
  const { amount, paymentMethod, paymentReference, notes, cheque: chequeDetails } = parsed.data

  const preSession = await authWithCompany()
  if (!preSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const quotaError = await requireQuota(preSession.user.tenantId, 'essential')
  if (quotaError) return quotaError

  // Pre-validate accounting config before starting transaction
  const acctError = await requireAccountingConfig(rawDb, preSession.user.tenantId, 'payment')
  if (acctError) return acctError

  if (paymentMethod === 'cheque' && !(await getTenantFeatureFlags(preSession.user.tenantId)).cheques) {
    return NextResponse.json({ error: 'Cheques are turned off for this business.', code: 'FEATURE_DISABLED', feature: 'cheques' }, { status: 403 })
  }

  const result = await withAuthTenantTransaction(async (session, tx) => {
    const permError = requirePermission(session, 'managePurchases')
    if (permError) return { error: permError }
    // K4: documents of another branch are off limits to branch-restricted staff
    const branchDenied = await assertRecordBranch(session, tx, purchases, id)
    if (branchDenied) return { error: branchDenied }

    // Get purchase with lock to prevent concurrent payment race conditions (RLS filters by tenant)
    const [purchase] = await tx
      .select()
      .from(purchases)
      .where(eq(purchases.id, id))
      .for('update')

    if (!purchase) {
      return { error: NextResponse.json({ error: 'Purchase not found' }, { status: 404 }) }
    }

    // Issue #40: Block payments on draft purchases
    if (purchase.status === 'draft') {
      return { error: NextResponse.json({ error: 'Cannot add payments to draft purchases. Submit the purchase first.' }, { status: 400 }) }
    }

    if (purchase.status === 'cancelled') {
      return { error: NextResponse.json({ error: 'Cannot add payment to cancelled purchase' }, { status: 400 }) }
    }

    if (purchase.status === 'paid') {
      return { error: NextResponse.json({ error: 'Purchase is already fully paid' }, { status: 400 }) }
    }

    const totalAmount = Math.round(parseFloat(purchase.total) * 100) / 100
    const currentPaid = Math.round(parseFloat(purchase.paidAmount) * 100) / 100
    const remaining = Math.round((totalAmount - currentPaid) * 100) / 100
    const paymentAmount = Math.round(amount * 100) / 100

    // Account for floating point precision with small tolerance
    if (paymentAmount > remaining + 0.01) {
      return { error: NextResponse.json({
        error: `Payment amount exceeds remaining balance. Maximum payment: ${remaining.toFixed(2)}`
      }, { status: 400 }) }
    }

    // Clamp to remaining if very close (due to floating point)
    const effectiveAmount = Math.min(paymentAmount, remaining)
    const effectiveMethod = (paymentMethod || 'cash') as 'cash' | 'card' | 'bank_transfer' | 'credit' | 'gift_card' | 'cheque'
    const effectiveReference = effectiveMethod === 'cash' ? null : (paymentReference || (effectiveMethod === 'cheque' ? chequeDetails?.chequeNo : null) || null)
    if (effectiveMethod === 'cheque' && chequeDetails?.amount !== undefined && Math.abs(Math.round(chequeDetails.amount * 100) / 100 - effectiveAmount) > 0.004) {
      return { error: NextResponse.json({ error: `Cheque amount ${chequeDetails.amount.toFixed(2)} does not match the payment ${effectiveAmount.toFixed(2)}`, code: 'CHEQUE_AMOUNT_MISMATCH' }, { status: 400 }) }
    }

    const [payment] = await tx.insert(purchasePayments).values({
      tenantId: session.user.tenantId,
      purchaseId: id,
      amount: effectiveAmount.toString(),
      paymentMethod: effectiveMethod,
      paymentReference: effectiveReference,
      notes: notes || null,
      createdBy: session.user.id,
    }).returning()

    // K1: register the issued cheque (a bounce re-opens this purchase)
    if (effectiveMethod === 'cheque' && chequeDetails) {
      await insertCheque(tx, {
        tenantId: session.user.tenantId,
        direction: 'issued',
        details: chequeDetails,
        amount: effectiveAmount,
        userId: session.user.id,
        supplierId: purchase.supplierId,
        purchaseId: id,
        purchasePaymentId: payment.id,
        warehouseId: purchase.warehouseId,
      })
    }

    // Update purchase paidAmount and status
    const newPaidAmount = Math.round((currentPaid + effectiveAmount) * 100) / 100
    let newStatus: 'pending' | 'partial' | 'paid' = purchase.status as 'pending' | 'partial' | 'paid'

    // Use tolerance for "paid" check
    if (Math.abs(newPaidAmount - totalAmount) < 0.01 || newPaidAmount >= totalAmount) {
      newStatus = 'paid'
    } else if (newPaidAmount > 0) {
      newStatus = 'partial'
    }

    await tx.update(purchases)
      .set({
        paidAmount: newPaidAmount.toString(),
        status: newStatus,
        updatedAt: new Date(),
      })
      .where(eq(purchases.id, id))

    // Update supplier balance with audit trail (reduce what we owe them)
    if (purchase.supplierId) {
      // Get current supplier balance BEFORE update
      const [currentSupplier] = await tx
        .select({ balance: suppliers.balance })
        .from(suppliers)
        .where(eq(suppliers.id, purchase.supplierId))
        .for('update')

      const previousBalance = parseFloat(currentSupplier?.balance || '0')
      const newBalance = Math.round((previousBalance - effectiveAmount) * 100) / 100

      await tx.update(suppliers)
        .set({ balance: newBalance.toString() })
        .where(eq(suppliers.id, purchase.supplierId))

      // Create audit record
      await tx.insert(supplierBalanceAudit).values({
        tenantId: session.user.tenantId,
        supplierId: purchase.supplierId,
        type: 'payment',
        amount: (-effectiveAmount).toString(),
        previousBalance: previousBalance.toString(),
        newBalance: newBalance.toString(),
        referenceType: 'purchase_payment',
        referenceId: payment.id,
        notes: `Payment for purchase ${purchase.purchaseNo} via ${effectiveMethod}`,
        createdBy: session.user.id,
      })
    }

    // Auto-post payment to General Ledger
    await postPaymentToGL(tx, session.user.tenantId, {
      paymentId: payment.id,
      paymentDate: new Date().toISOString().split('T')[0],
      amount: effectiveAmount,
      paymentMethod: effectiveMethod,
      partyType: 'supplier',
      partyId: purchase.supplierId || '',
      referenceNumber: purchase.purchaseNo,
      costCenterId: purchase.costCenterId,
    })

    return {
      data: {
        payment,
        purchaseStatus: newStatus,
        newPaidAmount,
        remaining: Math.round((totalAmount - newPaidAmount) * 100) / 100,
      },
      tenantId: session.user.tenantId,
      supplierId: purchase.supplierId,
    }
  })

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if ('error' in result) {
    return result.error
  }

  // Broadcast changes after transaction commits
  logAndBroadcast(result.tenantId, 'purchase', 'updated', id)
  if (result.supplierId) {
    logAndBroadcast(result.tenantId, 'supplier', 'updated', result.supplierId)
  }

  return NextResponse.json(result.data)
}
