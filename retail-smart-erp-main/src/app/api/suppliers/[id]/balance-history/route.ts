import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { supplierBalanceAudit, suppliers, users, purchases, purchasePayments } from '@/lib/db/schema'
import { eq, desc, sql, inArray } from 'drizzle-orm'
import { validateSearchParams, validateParams } from '@/lib/validation/helpers'
import { supplierBalanceHistorySchema } from '@/lib/validation/schemas/suppliers'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET balance audit history for a supplier with pagination
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const parsed = validateSearchParams(request, supplierBalanceHistorySchema)
  if (!parsed.success) return parsed.response
  const { page, pageSize } = parsed.data
  const offset = (page - 1) * pageSize

  const result = await withAuthTenant(async (session, db) => {
    const permError = requirePermission(session, 'managePurchases')
    if (permError) return { error: permError }

    // Verify supplier exists (RLS filters by tenant)
    const [supplier] = await db
      .select({ id: suppliers.id, name: suppliers.name, balance: suppliers.balance })
      .from(suppliers)
      .where(eq(suppliers.id, id))

    if (!supplier) {
      return { error: NextResponse.json({ error: 'Supplier not found' }, { status: 404 }) }
    }

    // Get total count
    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(supplierBalanceAudit)
      .where(eq(supplierBalanceAudit.supplierId, id))

    const total = countResult?.count || 0
    const totalPages = Math.ceil(total / pageSize)

    // Get audit records with user info
    const records = await db
      .select({
        id: supplierBalanceAudit.id,
        type: supplierBalanceAudit.type,
        amount: supplierBalanceAudit.amount,
        previousBalance: supplierBalanceAudit.previousBalance,
        newBalance: supplierBalanceAudit.newBalance,
        referenceType: supplierBalanceAudit.referenceType,
        referenceId: supplierBalanceAudit.referenceId,
        notes: supplierBalanceAudit.notes,
        createdBy: supplierBalanceAudit.createdBy,
        createdByName: users.fullName,
        createdAt: supplierBalanceAudit.createdAt,
      })
      .from(supplierBalanceAudit)
      .leftJoin(users, eq(supplierBalanceAudit.createdBy, users.id))
      .where(eq(supplierBalanceAudit.supplierId, id))
      .orderBy(desc(supplierBalanceAudit.createdAt))
      .limit(pageSize)
      .offset(offset)

    // Batch-load reference details to avoid N+1 queries
    const purchaseRefIds = records.filter(r => r.referenceType === 'purchase' && r.referenceId).map(r => r.referenceId!)
    const paymentRefIds = records.filter(r => r.referenceType === 'purchase_payment' && r.referenceId).map(r => r.referenceId!)

    // Batch fetch purchases
    const purchaseMap = new Map<string, string>()
    if (purchaseRefIds.length > 0) {
      const purchaseRows = await db.select({ id: purchases.id, purchaseNo: purchases.purchaseNo })
        .from(purchases).where(inArray(purchases.id, purchaseRefIds))
      for (const p of purchaseRows) purchaseMap.set(p.id, p.purchaseNo)
    }

    // Batch fetch payment details + their purchase numbers
    const paymentMap = new Map<string, { paymentMethod: string; purchaseNo?: string }>()
    if (paymentRefIds.length > 0) {
      const paymentRows = await db.select({
        id: purchasePayments.id,
        paymentMethod: purchasePayments.paymentMethod,
        purchaseId: purchasePayments.purchaseId,
      }).from(purchasePayments).where(inArray(purchasePayments.id, paymentRefIds))

      const relatedPurchaseIds = paymentRows.map(p => p.purchaseId).filter(Boolean) as string[]
      if (relatedPurchaseIds.length > 0) {
        const relatedPurchases = await db.select({ id: purchases.id, purchaseNo: purchases.purchaseNo })
          .from(purchases).where(inArray(purchases.id, relatedPurchaseIds))
        for (const p of relatedPurchases) purchaseMap.set(p.id, p.purchaseNo)
      }

      for (const p of paymentRows) {
        paymentMap.set(p.id, {
          paymentMethod: p.paymentMethod,
          purchaseNo: p.purchaseId ? purchaseMap.get(p.purchaseId) : undefined,
        })
      }
    }

    const enrichedRecords = records.map((record) => {
      const referenceDetails: { purchaseNo?: string; paymentMethod?: string } = {}
      if (record.referenceType === 'purchase' && record.referenceId) {
        referenceDetails.purchaseNo = purchaseMap.get(record.referenceId)
      } else if (record.referenceType === 'purchase_payment' && record.referenceId) {
        const paymentInfo = paymentMap.get(record.referenceId)
        if (paymentInfo) {
          referenceDetails.paymentMethod = paymentInfo.paymentMethod
          referenceDetails.purchaseNo = paymentInfo.purchaseNo
        }
      }
      return { ...record, referenceDetails }
    })

    return {
      data: {
        supplier: {
          id: supplier.id,
          name: supplier.name,
          currentBalance: supplier.balance,
        },
        records: enrichedRecords,
        pagination: {
          page,
          pageSize,
          total,
          totalPages,
        },
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
