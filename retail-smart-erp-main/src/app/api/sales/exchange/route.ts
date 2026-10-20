import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { db as rawDb, withTenant } from '@/lib/db'
import { sales, warehouses, posOpeningEntries, posProfiles } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { requirePermission } from '@/lib/auth/roles'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireAccountingConfig } from '@/lib/accounting/validate-config'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody } from '@/lib/validation'
import { exchangeSaleSchema } from '@/lib/validation/schemas/sales'
import { notifyStockDecreased } from '@/lib/inventory/apply-stock-change'
import { notifyReturnAlerts } from '@/lib/notifications/sales-alerts'
import { createExchangeInTx } from '@/lib/sales/exchange'
import { saleFlowErrorResponse } from '@/lib/sales/route-helpers'

/**
 * POST /api/sales/exchange
 * Body: { originalSaleId, returnLines:[{originalSaleItemId, quantity, serialNumberIds?}],
 *         newCartItems:[{itemId, name, quantity, unitPrice, discount?, serialNumberIds?}],
 *         paymentMethod?, paymentSplits?, amountPaid?, refundMethod?('cash'|'card'),
 *         warehouseId?, posOpeningEntryId?, customerId?, clientSaleId?, reason?, notes? }
 * One transaction: return (RTN-) + new sale (INV-, exchange_of = return id).
 * 200 { returnSale, sale, net: { refundTotal, newTotal, difference, collected, refunded } }
 * Requires createSales + processReturns.
 */
export async function POST(request: NextRequest) {
  let clientSaleId: string | undefined
  let tenantIdForRecovery: string | undefined
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const perm = requirePermission(session, 'createSales') || requirePermission(session, 'processReturns')
    if (perm) return perm

    const quotaError = await requireQuota(session.user.tenantId, 'essential')
    if (quotaError) return quotaError

    const userId = await resolveUserIdRequired(session)
    const parsed = await validateBody(request, exchangeSaleSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data
    const tenantId = session.user.tenantId
    clientSaleId = body.clientSaleId
    tenantIdForRecovery = tenantId

    const acctError = await requireAccountingConfig(rawDb, tenantId, 'sale')
    if (acctError) return acctError

    return await withTenant(tenantId, async (db) => {
      if (body.clientSaleId) {
        const replay = await replayExchange(db, tenantId, body.clientSaleId)
        if (replay) return replay
      }
      if (body.warehouseId) {
        const wh = await db.query.warehouses.findFirst({ where: and(eq(warehouses.id, body.warehouseId), eq(warehouses.isActive, true)) })
        if (!wh) return NextResponse.json({ error: 'Selected warehouse not found or inactive' }, { status: 400 })
      }
      let costCenterId: string | null = null
      if (body.posOpeningEntryId) {
        const opening = await db.query.posOpeningEntries.findFirst({ where: eq(posOpeningEntries.id, body.posOpeningEntryId) })
        if (opening) {
          const profile = await db.query.posProfiles.findFirst({ where: eq(posProfiles.id, opening.posProfileId) })
          costCenterId = profile?.costCenterId || null
        }
      }

      const result = await db.transaction((tx) => createExchangeInTx(tx, { tenantId, userId }, {
        ...body,
        costCenterId,
      }))
      notifyStockDecreased(result.stockChanges)

      const rtn = result.returnResult.returnSale
      logAndBroadcast(tenantId, 'sale', 'created', rtn.id, {
        userId, entityName: rtn.invoiceNo, description: `Processed exchange return ${rtn.invoiceNo}`,
      })
      logAndBroadcast(tenantId, 'sale', 'created', result.sale.id, {
        userId, entityName: result.sale.invoiceNo,
        description: `Exchange sale ${result.sale.invoiceNo} for ${rtn.invoiceNo}`,
      })
      if (result.returnResult.originalSale) logAndBroadcast(tenantId, 'sale', 'updated', result.returnResult.originalSale.id)
      for (const itemId of result.affectedItemIds) logAndBroadcast(tenantId, 'item', 'updated', itemId)
      logAndBroadcast(tenantId, 'warehouse-stock', 'updated', result.returnResult.warehouseId)
      notifyReturnAlerts(tenantId, {
        returnId: rtn.id, returnNo: rtn.invoiceNo, originalInvoiceNo: result.returnResult.originalSale?.invoiceNo,
        manual: !result.returnResult.originalSale, refundTotal: result.returnResult.refundTotal, actorUserId: userId, actorName: session.user.name,
      })

      return NextResponse.json({
        returnSale: { ...rtn, lines: result.returnResult.lines, returnStatus: result.returnResult.returnStatus },
        sale: { ...result.sale, lines: result.saleLines },
        net: {
          refundTotal: result.refundTotal,
          newTotal: result.newTotal,
          difference: result.difference,
          collected: result.collected,
          refunded: result.refunded,
        },
      })
    })
  } catch (error) {
    const pgCode = (error as { cause?: { code?: string } })?.cause?.code || (error as { code?: string })?.code
    if (pgCode === '23505' && clientSaleId && tenantIdForRecovery) {
      const key = clientSaleId
      const replay = await withTenant(tenantIdForRecovery, (db) => replayExchange(db, tenantIdForRecovery!, key)).catch(() => null)
      if (replay) return replay
    }
    const mapped = saleFlowErrorResponse(error)
    if (mapped) return mapped
    logError('api/sales/exchange', error)
    return NextResponse.json({ error: 'Failed to process exchange' }, { status: 500 })
  }
}

/** Idempotent replay: the exchange sale carries clientSaleId, its return is exchange_of. */
async function replayExchange(db: Parameters<Parameters<typeof withTenant>[1]>[0], tenantId: string, key: string) {
  const sale = await db.query.sales.findFirst({
    where: and(eq(sales.tenantId, tenantId), eq(sales.clientSaleId, key)),
    with: { items: true },
  })
  if (!sale) return null
  const rtn = sale.exchangeOf
    ? await db.query.sales.findFirst({ where: eq(sales.id, sale.exchangeOf), with: { items: true } })
    : null
  const refundTotal = rtn ? Math.abs(Number(rtn.total)) : 0
  const newTotal = Number(sale.total)
  return NextResponse.json({
    returnSale: rtn,
    sale,
    net: { refundTotal, newTotal, difference: Math.round((newTotal - refundTotal) * 100) / 100, replayed: true },
  })
}
