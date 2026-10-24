import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { db as rawDb, withTenant } from '@/lib/db'
import { items, sales, saleItems, warehouses } from '@/lib/db/schema'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { hasPermission, requirePermission } from '@/lib/auth/roles'
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
import { assignedPosProfiles, checkSaleShift, evaluateSaleControls, SHIFT_ISSUE_MESSAGES } from '@/lib/pos/sale-controls'
import { ApprovalError, consumeApprovals, coverScopes, verifyApprovalTokens, type ApprovalScope } from '@/lib/auth/approval-token'
import { roundCurrency } from '@/lib/utils/currency'
import { priceSaleCart } from '@/lib/pricing/sale-pricing'
import { PricingLineError } from '@/lib/pricing/load-context'
import { assertBranchAccess, assertRecordBranch } from '@/lib/auth/branch-access'

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
    // An exchange takes goods back AND sells: both permissions are required (each check rejects alone)
    const salePerm = requirePermission(session, 'createSales')
    if (salePerm) return salePerm
    const returnPerm = requirePermission(session, 'processReturns')
    if (returnPerm) return returnPerm

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
      // K4: a branch-restricted cashier exchanges only sales of their own branches, into them
      const branchDenied = await assertBranchAccess(session, body.warehouseId, db)
        || await assertRecordBranch(session, db, sales, body.originalSaleId, { includeUnassigned: true })
      if (branchDenied) return branchDenied
      // H1: the exchange is rung up on an open shift of the cashier (or any shift for manageSales)
      const shiftCheck = await checkSaleShift(db, {
        posOpeningEntryId: body.posOpeningEntryId,
        userIds: [...new Set([userId, session.user.id])],
        canUseAnyShift: hasPermission(session.user.role, 'manageSales', tenantId, session.user.customRoleId),
      })
      if (shiftCheck.issue) {
        return NextResponse.json({ error: SHIFT_ISSUE_MESSAGES[shiftCheck.issue], code: shiftCheck.issue }, { status: shiftCheck.issue === 'SHIFT_NOT_YOURS' ? 403 : 400 })
      }
      const costCenterId: string | null = shiftCheck.profile?.costCenterId || null

      // H1: the new (outgoing) items follow the same counter rules as a sale: line discounts above
      // the counter limit and prices below the catalog need a supervisor. (No credit-limit check:
      // an exchange difference is always settled by cash / card / bank, never on account.)
      const isSupervisor = hasPermission(session.user.role, 'manageSales', tenantId, session.user.customRoleId)
      const governingProfile = shiftCheck.profile
        || (isSupervisor ? null : (await assignedPosProfiles(db, [...new Set([userId, session.user.id])]))[0] || null)
      const itemIds = [...new Set(body.newCartItems.map((c) => c.itemId).filter((x): x is string => !!x))]
      const catalog = itemIds.length
        ? await db.select({ id: items.id, sellingPrice: items.sellingPrice, isWeighable: items.isWeighable }).from(items).where(inArray(items.id, itemIds))
        : []
      const byId = new Map(catalog.map((i) => [i.id, i]))
      if (body.newCartItems.some((c) => !c.itemId || !byId.has(c.itemId))) {
        return NextResponse.json({ error: 'Invalid items in cart', code: 'ITEM_NOT_FOUND' }, { status: 400 })
      }
      // H5: the rate-change rule compares with the price the price lists give this customer
      // (promotions are not applied to exchange items; units move quantity × factor base units)
      let resolved: number[]
      try {
        const pricing = await priceSaleCart(db, tenantId, {
          cartItems: body.newCartItems.map((c) => ({ itemId: c.itemId, quantity: Number(c.quantity), unitPrice: Number(c.unitPrice), uom: c.uom, priceLocked: c.priceLocked, barcode: c.barcode })),
          customerId: body.customerId || null,
          posProfileId: shiftCheck.shift?.posProfileId || governingProfile?.id || null,
          applyRules: true,
        })
        resolved = pricing.lines.map((l) => l.resolvedPrice)
      } catch (e) {
        if (e instanceof PricingLineError) return NextResponse.json({ error: `Item has no "${e.uom}" unit`, code: e.code }, { status: 400 })
        throw e
      }
      const controls = evaluateSaleControls(governingProfile, {
        lines: body.newCartItems.map((c, i) => ({
          name: c.name, quantity: Number(c.quantity), unitPrice: roundCurrency(Number(c.unitPrice)), discount: roundCurrency(Number(c.discount || 0)),
          catalogPrice: roundCurrency(resolved[i]), isWeighable: !!byId.get(c.itemId || '')?.isWeighable,
        })),
        cartDiscount: 0,
      })
      const neededScopes: ApprovalScope[] = []
      if (controls.needsDiscountApproval) neededScopes.push('discount')
      if (controls.needsPriceApproval) neededScopes.push('price_change')
      let approvals: ReturnType<typeof coverScopes>['used'] = []
      let approvedBy: string | null = null
      if (neededScopes.length > 0) {
        if (isSupervisor) {
          approvedBy = userId
        } else {
          const cover = coverScopes(neededScopes, verifyApprovalTokens(body.approvalTokens, { tenantId, requesterId: session.user.id }))
          if (cover.missing.length > 0) {
            return NextResponse.json({
              error: cover.missing.includes('discount')
                ? `Discount of ${controls.discountPercent}% on the new items needs supervisor approval`
                : 'A price below the catalog price needs supervisor approval',
              code: 'APPROVAL_REQUIRED',
              scopes: cover.missing,
              discountPercent: controls.discountPercent,
              priceOverrides: controls.priceOverrides,
            }, { status: 403 })
          }
          approvals = cover.used
          approvedBy = cover.used[0]?.approverId || null
        }
      }
      const auditMeta = {
        posOpeningEntryId: shiftCheck.shift?.id || null,
        posProfileId: shiftCheck.shift?.posProfileId || governingProfile?.id || null,
        approvedBy,
        approvals: neededScopes,
        priceOverrides: controls.priceOverrides,
      }

      const result = await db.transaction(async (tx) => {
        const r = await createExchangeInTx(tx, { tenantId, userId }, { ...body, costCenterId })
        if (approvals.length > 0) {
          await consumeApprovals(tx, {
            tenantId, usedBy: userId, entityType: 'sale', entityId: r.sale.id,
            approvals, scopesFor: (a) => neededScopes.filter((sc) => a.scopes.includes(sc)),
          })
        }
        if (approvedBy) await tx.update(sales).set({ approvedBy }).where(eq(sales.id, r.sale.id))
        // Catalog price of each new line (audit of price overrides; unit lines already carry theirs)
        await tx.update(saleItems)
          .set({ listPrice: sql`(SELECT ${items.sellingPrice} FROM ${items} WHERE ${items.id} = ${saleItems.itemId})` })
          .where(and(eq(saleItems.saleId, r.sale.id), sql`${saleItems.listPrice} IS NULL`))
        return r
      })
      notifyStockDecreased(result.stockChanges)

      const rtn = result.returnResult.returnSale
      logAndBroadcast(tenantId, 'sale', 'created', rtn.id, {
        userId, entityName: rtn.invoiceNo, description: `Processed exchange return ${rtn.invoiceNo}`,
        metadata: { ...auditMeta, originalSaleId: body.originalSaleId, refundTotal: result.refundTotal, reason: body.reason || null },
      })
      logAndBroadcast(tenantId, 'sale', 'created', result.sale.id, {
        userId, entityName: result.sale.invoiceNo,
        description: `Exchange sale ${result.sale.invoiceNo} for ${rtn.invoiceNo}`,
        metadata: { ...auditMeta, exchangeOf: rtn.id, newTotal: result.newTotal, difference: result.difference, collected: result.collected, refunded: result.refunded },
      })
      if (result.returnResult.originalSale) logAndBroadcast(tenantId, 'sale', 'updated', result.returnResult.originalSale.id)
      for (const itemId of result.affectedItemIds) logAndBroadcast(tenantId, 'item', 'updated', itemId)
      logAndBroadcast(tenantId, 'warehouse-stock', 'updated', result.returnResult.stockWarehouseId)
      if (result.returnResult.stockWarehouseId !== result.returnResult.warehouseId) logAndBroadcast(tenantId, 'warehouse-stock', 'updated', result.returnResult.warehouseId)
      notifyReturnAlerts(tenantId, {
        returnId: rtn.id, returnNo: rtn.invoiceNo, originalInvoiceNo: result.returnResult.originalSale?.invoiceNo,
        manual: !result.returnResult.originalSale, refundTotal: result.returnResult.refundTotal, actorUserId: userId, actorName: session.user.name,
      })

      return NextResponse.json({
        returnSale: { ...rtn, lines: result.returnResult.lines, returnStatus: result.returnResult.returnStatus, originalInvoiceNo: result.returnResult.originalSale?.invoiceNo || null },
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
    if (error instanceof ApprovalError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 403 })
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
