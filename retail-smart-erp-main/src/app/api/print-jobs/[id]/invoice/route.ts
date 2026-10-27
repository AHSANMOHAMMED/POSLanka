import { NextRequest, NextResponse } from 'next/server'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { items, payments, printJobItems, printJobPayments, printJobs, saleItems, sales } from '@/lib/db/schema'
import { requireModule, requirePermission } from '@/lib/auth/roles'
import { assertRecordBranch, resolveRecordBranch } from '@/lib/auth/branch-access'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { printJobInvoiceSchema } from '@/lib/validation/schemas/print-jobs'
import { roundCurrency, parseCurrency } from '@/lib/utils/currency'
import { requireQuota } from '@/lib/db/storage-quota'
import { requireAccountingConfig } from '@/lib/accounting/validate-config'
import { postSaleToGL } from '@/lib/accounting/auto-post'
import { nextDocumentNumber } from '@/lib/inventory/item-codes'
import { applyStockChange, notifyStockDecreased, type StockChangeInput, type StockChangeResult } from '@/lib/inventory/apply-stock-change'
import { allocateSaleLineBatches } from '@/lib/inventory/batches'
import { getTenantSalesSettings } from '@/lib/sales/return-settings'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { computePrintJobTotals, postedAdvanceIds, storedLinesToComputed } from '@/lib/print-jobs/server'
import { printJobErrorResponse } from '@/lib/print-jobs/errors'
import { currentOpenShiftId } from '@/lib/pos/shift-collections'

type PayMethod = typeof payments.$inferInsert['method']

// POST /api/print-jobs/[id]/invoice — "Mark delivered & invoice".
// Same path as a work order invoice (src/app/api/work-orders/[id]/invoice): one sale with the job's
// lines, stock out for stock-tracked media, payments, postSaleToGL inside the transaction. Advances:
// each becomes a payment row on the sale; those posted to Customer Advance settle the receivable
// from that account (creditAmount, like a completed layaway), any that were never posted (no
// advance account) are booked as received money now. The balance is collected with paymentMethod
// (or left on the customer's account with 'credit').
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'createSales')
    if (permError) return permError
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError
    const quotaError = await requireQuota(session.user.tenantId, 'essential')
    if (quotaError) return quotaError
    const acctError = await requireAccountingConfig(null, session.user.tenantId, 'sale')
    if (acctError) return acctError

    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const { id } = p.data
    const userId = await resolveUserIdRequired(session)
    const parsed = await validateBody(request, printJobInvoiceSchema)
    if (!parsed.success) return parsed.response
    const { expectedUpdatedAt, paymentMethod, paidAmount, reference } = parsed.data
    const tenantId = session.user.tenantId

    return await withTenant(tenantId, async (db) => {
      const branchDenied = await assertRecordBranch(session, db, printJobs, id, { includeUnassigned: true })
      if (branchDenied) return branchDenied

      const stockChanges: Array<{ result: StockChangeResult; input: StockChangeInput }> = []
      const result = await db.transaction(async (tx) => {
        // Lock the job: no double invoicing
        const [job] = await tx.select().from(printJobs).where(eq(printJobs.id, id)).for('update')
        if (!job) return { error: NextResponse.json({ error: 'Print job not found' }, { status: 404 }) }
        if (job.saleId) throw new Error('ALREADY_INVOICED')
        if (job.status === 'delivered' || job.status === 'cancelled') throw new Error('INVALID_STATUS')
        if (expectedUpdatedAt && job.updatedAt && new Date(job.updatedAt).getTime() > new Date(expectedUpdatedAt).getTime()) {
          return { error: NextResponse.json({ error: 'This job was changed by someone else. Refresh and try again.', code: 'CONFLICT' }, { status: 409 }) }
        }

        const stored = await tx.select().from(printJobItems).where(eq(printJobItems.printJobId, id))
        if (stored.length === 0) return { error: NextResponse.json({ error: 'The job has no lines to invoice' }, { status: 400 }) }
        const lines = storedLinesToComputed(stored)
        // Re-priced with today's tax setup, from exactly the stored lines
        const totals = await computePrintJobTotals(tx, tenantId, lines, parseCurrency(job.discountAmount))

        // Branch the goods leave from (job's branch, else the user's / default branch)
        let warehouseId = job.warehouseId
        if (!warehouseId) {
          const branch = await resolveRecordBranch(session, tx, null)
          if (branch.error) return { error: branch.error }
          warehouseId = branch.warehouseId
        }

        // Advances still held on the job
        const advances = await tx.select().from(printJobPayments)
          .where(and(eq(printJobPayments.printJobId, id), isNull(printJobPayments.refundedAt)))
        const posted = await postedAdvanceIds(tx, tenantId, advances.map((a) => a.id))
        const advanceTotal = roundCurrency(advances.reduce((s, a) => s + parseCurrency(a.amount), 0))
        const postedAdvance = roundCurrency(advances.filter((a) => posted.has(a.id)).reduce((s, a) => s + parseCurrency(a.amount), 0))
        if (advanceTotal > totals.total + 0.01) {
          return { error: NextResponse.json({ error: `Advances (${advanceTotal.toFixed(2)}) are more than the invoice total (${totals.total.toFixed(2)}). Adjust the job first.` }, { status: 400 }) }
        }

        const balance = roundCurrency(Math.max(0, totals.total - advanceTotal))
        const onAccount = paymentMethod === 'credit'
        if (onAccount && balance > 0 && !job.customerId) throw new Error('CUSTOMER_REQUIRED')
        // Change handed back is not revenue: only what stays in the drawer is recorded
        const collected = onAccount ? 0 : roundCurrency(Math.min(paidAmount || 0, balance))
        const totalPaid = roundCurrency(advanceTotal + collected)
        const saleStatus = totalPaid >= totals.total - 0.005 ? 'completed' : totalPaid > 0 ? 'partial' : 'pending'
        const saleMethod = (collected > 0 ? paymentMethod : advances[0]?.paymentMethod || (onAccount ? 'credit' : paymentMethod)) as PayMethod

        const invoiceNo = await nextDocumentNumber(tx, tenantId, 'invoice')
        const [newSale] = await tx.insert(sales).values({
          tenantId,
          invoiceNo,
          customerId: job.customerId,
          customerName: job.customerName,
          warehouseId,
          subtotal: String(totals.subtotal),
          discountAmount: String(totals.discountAmount),
          discountType: totals.discountAmount > 0 ? 'fixed' : null,
          taxAmount: String(totals.taxAmount),
          taxBreakdown: totals.taxBreakdown,
          total: String(totals.total),
          paidAmount: String(Math.min(totalPaid, totals.total)),
          paymentMethod: saleMethod,
          status: saleStatus,
          notes: `Print job ${job.jobNo}: ${job.title}`.slice(0, 1000),
          createdBy: userId,
        }).returning()

        // Items used by the lines (stock / cost)
        const itemIds = [...new Set(lines.map((l) => l.itemId).filter((x): x is string => !!x))]
        const itemRows = itemIds.length
          ? await tx.select({ id: items.id, name: items.name, trackStock: items.trackStock, trackBatches: items.trackBatches, trackSerialNumbers: items.trackSerialNumbers, costPrice: items.costPrice })
            .from(items).where(inArray(items.id, itemIds))
          : []
        const itemById = new Map(itemRows.map((r) => [r.id, r]))

        let totalCOGS = 0
        let batchSettings: Awaited<ReturnType<typeof getTenantSalesSettings>>['batches'] | null = null
        for (const [idx, l] of totals.invoiceLines.entries()) {
          const item = l.kind === 'print' && l.itemId ? itemById.get(l.itemId) : undefined
          if (item?.trackSerialNumbers) throw new Error('SERIAL_NOT_SUPPORTED')
          const [saleLine] = await tx.insert(saleItems).values({
            tenantId,
            saleId: newSale.id,
            // finishing add-ons are service lines (no item, no stock)
            itemId: l.kind === 'print' ? l.itemId : null,
            itemName: l.itemName,
            quantity: l.quantity.toFixed(3),
            unitPrice: String(roundCurrency(l.unitPrice)),
            discount: String(l.discount),
            discountType: l.discount > 0 ? 'fixed' : null,
            tax: '0',
            taxRate: String(l.taxRate),
            taxAmount: String(l.taxAmount),
            taxBreakdown: l.taxBreakdown,
            total: String(l.total),
          }).returning({ id: saleItems.id })

          if (!item) continue
          const qty = l.quantity
          if (item.costPrice) totalCOGS += roundCurrency(qty * parseCurrency(item.costPrice))
          if (item.trackStock && qty > 0) {
            if (!warehouseId) throw new Error('INSUFFICIENT_STOCK:' + item.name + ' (no branch)')
            // Single stock writer: locks the row, refuses negative stock, writes the ledger row.
            // Size-priced media move their billable area / length (stock kept in sq ft / ft).
            const input: StockChangeInput = {
              tenantId,
              warehouseId,
              itemId: item.id,
              mode: 'delta',
              qty: -qty,
              type: 'out',
              referenceType: 'sale',
              referenceId: newSale.id,
              notes: `Print job ${job.jobNo}`,
              userId,
              source: 'print_job',
              idempotencyKey: `print-job:${id}:${idx}`,
            }
            const change = await applyStockChange(tx, input)
            stockChanges.push({ result: change, input })
            if (item.trackBatches) {
              batchSettings ??= (await getTenantSalesSettings(tx, tenantId)).batches
              await allocateSaleLineBatches(tx, {
                tenantId, warehouseId, itemId: item.id, qty, saleItemId: saleLine.id,
                allowExpired: batchSettings.allowExpiredSale, itemName: item.name,
              })
            }
          }
        }

        // Payments on the sale: every advance, then the balance collected now
        const splits = new Map<string, number>()
        for (const a of advances) {
          await tx.insert(payments).values({
            tenantId,
            saleId: newSale.id,
            amount: a.amount,
            method: a.paymentMethod,
            reference: `Advance ${job.jobNo}${a.reference ? ` · ${a.reference}` : ''}`.slice(0, 255),
            receivedBy: a.receivedBy,
          })
          // never posted to Customer Advance → it is money received with this invoice
          if (!posted.has(a.id)) splits.set(a.paymentMethod, roundCurrency((splits.get(a.paymentMethod) || 0) + parseCurrency(a.amount)))
        }
        if (collected > 0) {
          await tx.insert(payments).values({
            tenantId,
            saleId: newSale.id,
            amount: String(collected),
            method: paymentMethod as PayMethod,
            reference: reference || null,
            receivedBy: userId,
            // 0187: balance collected now goes into this user's drawer (advances were counted when taken)
            posOpeningEntryId: await currentOpenShiftId(tx, userId),
          })
          splits.set(paymentMethod, roundCurrency((splits.get(paymentMethod) || 0) + collected))
        }
        const paymentSplits = [...splits].map(([method, amount]) => ({ method, amount }))

        // GL inside the transaction (sale, stock and payments are atomic with it)
        await postSaleToGL(tx, tenantId, {
          saleId: newSale.id,
          invoiceNumber: invoiceNo,
          saleDate: new Date().toISOString().split('T')[0],
          subtotal: totals.subtotal,
          tax: totals.taxAmount,
          discount: totals.discountAmount,
          total: totals.total,
          amountPaid: roundCurrency(paymentSplits.reduce((s, x) => s + x.amount, 0)),
          // advances already booked Dr Cash / Cr Customer Advance: settle AR from that account
          creditAmount: Math.min(postedAdvance, totals.total),
          costOfGoodsSold: roundCurrency(totalCOGS),
          paymentMethod: paymentSplits[0]?.method || saleMethod || 'cash',
          paymentSplits,
          customerId: job.customerId || null,
          taxBreakdown: totals.taxBreakdown || undefined,
        })

        const now = new Date()
        const [updated] = await tx.update(printJobs).set({
          status: 'delivered',
          deliveredAt: now,
          saleId: newSale.id,
          subtotal: String(totals.subtotal),
          discountAmount: String(totals.discountAmount),
          taxAmount: String(totals.taxAmount),
          taxBreakdown: totals.taxBreakdown,
          total: String(totals.total),
          paidAmount: String(totalPaid),
          balanceDue: String(roundCurrency(Math.max(0, totals.total - totalPaid))),
          updatedAt: now,
        }).where(eq(printJobs.id, id)).returning()

        return { data: { job: updated, sale: { id: newSale.id, invoiceNo, total: newSale.total, paidAmount: newSale.paidAmount, status: newSale.status } }, warehouseId }
      })
      if ('error' in result) return result.error

      notifyStockDecreased(stockChanges)
      if (stockChanges.length) logAndBroadcast(tenantId, 'warehouse-stock', 'updated', result.warehouseId || 'bulk', { userId })
      logAndBroadcast(tenantId, 'print-job', 'updated', id, {
        userId,
        entityName: result.data.job.jobNo,
        activityAction: 'convert',
        description: `Print job "${result.data.job.jobNo}" delivered and invoiced as ${result.data.sale.invoiceNo}`,
      })
      logAndBroadcast(tenantId, 'sale', 'created', result.data.sale.id, { userId, entityName: result.data.sale.invoiceNo })
      return NextResponse.json(result.data)
    })
  } catch (error) {
    const handled = printJobErrorResponse(error)
    if (handled) return handled
    logError('api/print-jobs/[id]/invoice', error)
    return NextResponse.json({ error: 'Failed to invoice the print job' }, { status: 500 })
  }
}
