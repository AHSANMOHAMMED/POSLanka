import { NextRequest, NextResponse } from 'next/server'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { items, payments, saleItems, sales, serviceJobItems, serviceJobPayments, serviceJobs } from '@/lib/db/schema'
import { requireModule } from '@/lib/auth/roles'
import { assertRecordBranch, resolveRecordBranch } from '@/lib/auth/branch-access'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { serviceJobInvoiceSchema } from '@/lib/validation/schemas/service-jobs'
import { roundCurrency, parseCurrency } from '@/lib/utils/currency'
import { requireQuota } from '@/lib/db/storage-quota'
import { requireAccountingConfig } from '@/lib/accounting/validate-config'
import { postSaleToGL } from '@/lib/accounting/auto-post'
import { tenantToday } from '@/lib/accounting/gl'
import { nextDocumentNumber } from '@/lib/inventory/item-codes'
import { applyStockChange, notifyStockDecreased, type StockChangeInput, type StockChangeResult } from '@/lib/inventory/apply-stock-change'
import { allocateSaleLineBatches } from '@/lib/inventory/batches'
import { getTenantSalesSettings } from '@/lib/sales/return-settings'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { currentOpenShiftId } from '@/lib/pos/shift-collections'
import {
  SERVICE_JOB_MONEY, addDays, addServiceJobHistory, computeServiceJobTotals, postedServiceAdvanceIds, requireAnyPermission,
  serviceJobErrorResponse, storedServiceLines,
} from '@/lib/service-jobs/server'

type PayMethod = typeof payments.$inferInsert['method']

// POST /api/service-jobs/[id]/invoice — "Convert to invoice" (deliver).
// Same path as a print job / work order invoice: one sale with the job's lines (parts and labour),
// stock out for stock-tracked parts, payments, postSaleToGL inside the transaction. Advances
// become payment rows on the sale; those posted to Customer Advance settle the receivable from
// that account (creditAmount), any never posted are booked as money received now. The balance is
// collected with paymentMethod (or left on the customer's account with 'credit'). A repair
// warranty (days) is stamped on the job and on the invoice lines (warranty_until).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requireAnyPermission(session, SERVICE_JOB_MONEY)
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
    const parsed = await validateBody(request, serviceJobInvoiceSchema)
    if (!parsed.success) return parsed.response
    const { expectedUpdatedAt, paymentMethod, paidAmount, reference, repairWarrantyDays } = parsed.data
    const tenantId = session.user.tenantId
    const today = await tenantToday(tenantId)

    return await withTenant(tenantId, async (db) => {
      const branchDenied = await assertRecordBranch(session, db, serviceJobs, id, { includeUnassigned: true })
      if (branchDenied) return branchDenied

      const stockChanges: Array<{ result: StockChangeResult; input: StockChangeInput }> = []
      const result = await db.transaction(async (tx) => {
        const [job] = await tx.select().from(serviceJobs).where(eq(serviceJobs.id, id)).for('update')
        if (!job) return { error: NextResponse.json({ error: 'Job not found' }, { status: 404 }) }
        if (job.saleId) throw new Error('ALREADY_INVOICED')
        if (job.status === 'delivered' || job.status === 'cancelled') throw new Error('INVALID_STATUS')
        if (expectedUpdatedAt && job.updatedAt && new Date(job.updatedAt).getTime() > new Date(expectedUpdatedAt).getTime()) {
          return { error: NextResponse.json({ error: 'This job was changed by someone else. Refresh and try again.', code: 'CONFLICT' }, { status: 409 }) }
        }

        const lines = storedServiceLines(await tx.select().from(serviceJobItems).where(eq(serviceJobItems.serviceJobId, id)))
        if (lines.length === 0) return { error: NextResponse.json({ error: 'Add the parts / labour charges before invoicing' }, { status: 400 }) }
        const totals = await computeServiceJobTotals(tx, tenantId, lines, parseCurrency(job.discountAmount))

        let warehouseId = job.warehouseId
        if (!warehouseId) {
          const branch = await resolveRecordBranch(session, tx, null)
          if (branch.error) return { error: branch.error }
          warehouseId = branch.warehouseId
        }

        const advances = await tx.select().from(serviceJobPayments)
          .where(and(eq(serviceJobPayments.serviceJobId, id), isNull(serviceJobPayments.refundedAt)))
        const posted = await postedServiceAdvanceIds(tx, tenantId, advances.map((a) => a.id))
        const advanceTotal = roundCurrency(advances.reduce((s, a) => s + parseCurrency(a.amount), 0))
        const postedAdvance = roundCurrency(advances.filter((a) => posted.has(a.id)).reduce((s, a) => s + parseCurrency(a.amount), 0))
        if (advanceTotal > totals.total + 0.01) {
          return { error: NextResponse.json({ error: `Advances (${advanceTotal.toFixed(2)}) are more than the invoice total (${totals.total.toFixed(2)}). Adjust the job first.` }, { status: 400 }) }
        }

        const balance = roundCurrency(Math.max(0, totals.total - advanceTotal))
        const onAccount = paymentMethod === 'credit'
        if (onAccount && balance > 0 && !job.customerId) throw new Error('CUSTOMER_REQUIRED')
        const collected = onAccount ? 0 : roundCurrency(Math.min(paidAmount || 0, balance))
        const totalPaid = roundCurrency(advanceTotal + collected)
        const saleStatus = totalPaid >= totals.total - 0.005 ? 'completed' : totalPaid > 0 ? 'partial' : 'pending'
        const saleMethod = (collected > 0 ? paymentMethod : advances[0]?.paymentMethod || (onAccount ? 'credit' : paymentMethod)) as PayMethod

        // Repair warranty given on delivery (days)
        const warrantyDays = repairWarrantyDays ?? job.repairWarrantyDays ?? null
        const warrantyUntil = warrantyDays && warrantyDays > 0 ? addDays(today, warrantyDays) : null

        const invoiceNo = await nextDocumentNumber(tx, tenantId, 'invoice')
        const device = [job.brand, job.model].filter(Boolean).join(' ')
        const ident = job.imei || job.serialNumber
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
          notes: `Job ${job.jobNo}: ${job.title}${device ? ` · ${device}` : ''}${ident ? ` · ${ident}` : ''}${warrantyUntil ? ` · repair warranty until ${warrantyUntil}` : ''}`.slice(0, 1000),
          createdBy: userId,
        }).returning()

        const itemIds = [...new Set(lines.map((l) => l.itemId).filter((x): x is string => !!x))]
        const itemRows = itemIds.length
          ? await tx.select({ id: items.id, name: items.name, trackStock: items.trackStock, trackBatches: items.trackBatches, trackSerialNumbers: items.trackSerialNumbers, costPrice: items.costPrice })
            .from(items).where(inArray(items.id, itemIds))
          : []
        const itemById = new Map(itemRows.map((r) => [r.id, r]))

        let totalCOGS = 0
        let batchSettings: Awaited<ReturnType<typeof getTenantSalesSettings>>['batches'] | null = null
        for (const [idx, l] of totals.lines.entries()) {
          const item = l.itemId ? itemById.get(l.itemId) : undefined
          if (item?.trackSerialNumbers) throw new Error('SERIAL_NOT_SUPPORTED')
          const [saleLine] = await tx.insert(saleItems).values({
            tenantId,
            saleId: newSale.id,
            itemId: l.itemId,
            itemName: l.description.slice(0, 255),
            quantity: String(l.quantity),
            unitPrice: String(l.unitPrice),
            discount: String(l.discount),
            discountType: l.discount > 0 ? 'fixed' : null,
            tax: '0',
            taxRate: String(l.taxRate),
            taxAmount: String(l.taxAmount),
            taxBreakdown: l.taxBreakdown,
            total: String(l.total),
            warrantyUntil,
          }).returning({ id: saleItems.id })

          if (!item) continue
          const qty = l.quantity
          if (item.costPrice) totalCOGS += roundCurrency(qty * parseCurrency(item.costPrice))
          if (item.trackStock && qty > 0) {
            if (!warehouseId) throw new Error('INSUFFICIENT_STOCK:' + item.name + ' (no branch)')
            // Single stock writer: locks the row, refuses negative stock, writes the ledger row
            const input: StockChangeInput = {
              tenantId,
              warehouseId,
              itemId: item.id,
              mode: 'delta',
              qty: -qty,
              type: 'out',
              referenceType: 'sale',
              referenceId: newSale.id,
              notes: `Job ${job.jobNo}`,
              userId,
              source: 'service_job',
              idempotencyKey: `service-job:${id}:${idx}`,
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
            // balance collected now goes into this user's drawer (advances were counted when taken)
            posOpeningEntryId: await currentOpenShiftId(tx, userId),
          })
          splits.set(paymentMethod, roundCurrency((splits.get(paymentMethod) || 0) + collected))
        }
        const paymentSplits = [...splits].map(([method, amount]) => ({ method, amount }))

        await postSaleToGL(tx, tenantId, {
          saleId: newSale.id,
          invoiceNumber: invoiceNo,
          saleDate: today,
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
        const [updated] = await tx.update(serviceJobs).set({
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
          repairWarrantyDays: warrantyDays,
          repairWarrantyUntil: warrantyUntil,
          updatedAt: now,
        }).where(eq(serviceJobs.id, id)).returning()
        await addServiceJobHistory(tx, {
          tenantId, serviceJobId: id, fromStatus: job.status, toStatus: 'delivered', changedBy: userId,
          note: `Invoiced as ${invoiceNo}${warrantyUntil ? ` · warranty until ${warrantyUntil}` : ''}`,
        })

        return {
          data: {
            job: { ...updated, passcode: undefined },
            sale: { id: newSale.id, invoiceNo, total: newSale.total, paidAmount: newSale.paidAmount, status: newSale.status },
          },
          warehouseId,
        }
      })
      if ('error' in result) return result.error

      notifyStockDecreased(stockChanges)
      if (stockChanges.length) logAndBroadcast(tenantId, 'warehouse-stock', 'updated', result.warehouseId || 'bulk', { userId })
      logAndBroadcast(tenantId, 'service-job', 'updated', id, {
        userId,
        entityName: result.data.job.jobNo,
        activityAction: 'convert',
        description: `Job "${result.data.job.jobNo}" delivered and invoiced as ${result.data.sale.invoiceNo}`,
      })
      logAndBroadcast(tenantId, 'sale', 'created', result.data.sale.id, { userId, entityName: result.data.sale.invoiceNo })
      return NextResponse.json(result.data)
    })
  } catch (error) {
    const handled = serviceJobErrorResponse(error)
    if (handled) return handled
    logError('api/service-jobs/[id]/invoice', error)
    return NextResponse.json({ error: 'Failed to invoice the job' }, { status: 500 })
  }
}
