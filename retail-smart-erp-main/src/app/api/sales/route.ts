import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { db as rawDb, withTenant } from '@/lib/db'
import { sales, saleItems, items, payments, customers, customerCreditTransactions, workOrders, workOrderParts, insuranceEstimates, insuranceEstimateItems, vehicles, warehouseStock, warehouses, loyaltyPrograms, loyaltyTiers, loyaltyTransactions, heldSales, salesOrders, giftCards, giftCardTransactions, tenants } from '@/lib/db/schema'
import { eq, and, desc, sql, or, ilike, inArray } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { generateActivityDescription } from '@/lib/utils/activity-log'
import { hasPermission, requirePermission, requireModule } from '@/lib/auth/roles'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { notifyReturnAlerts } from '@/lib/notifications/sales-alerts'
import { roundCurrency, compareCurrency, parseCurrency } from '@/lib/utils/currency'
import { postSaleToGL, postGiftCardSaleToGL } from '@/lib/accounting/auto-post'
import { requireAccountingConfig } from '@/lib/accounting/validate-config'
import { checkSaleAnomalies, checkRefundAnomalies, checkDuplicateTransaction } from '@/lib/ai/anomaly-detector'
import { auditSaleCalculation } from '@/lib/ai/calculation-auditor'
import { auditSaleIntegrity } from '@/lib/audit/realtime-hooks'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateSerialAvailability, allocateSerials } from '@/lib/inventory/serial-numbers'
import { localDateString, saleLineWarranty, applySerialWarranty } from '@/lib/sales/warranty'
import { linkQuotationToSale } from '@/lib/sales/quotation-link'
import { recalculateDocumentTax } from '@/lib/utils/tax-recalculate'
import { type TaxBreakdownItem } from '@/lib/utils/tax-template'
import { validateBody, validateSearchParams } from '@/lib/validation'
import { salesListSchema, createSaleSchema } from '@/lib/validation/schemas/sales'
import { nextDocumentNumber } from '@/lib/inventory/item-codes'
import { toApiError } from '@/lib/db/errors'
import { applyStockChanges, notifyStockDecreased, type StockChangeInput, type StockChangeResult } from '@/lib/inventory/apply-stock-change'
import { createReturnInTx, returnStatusOf } from '@/lib/sales/returns'
import { saleFlowErrorResponse } from '@/lib/sales/route-helpers'
import { notify } from '@/lib/notifications/notify'
import { getTenantFeatureFlags } from '@/lib/features/check'
import { prescriptionProblem, prescriptionRequirement, recordPrescription } from '@/lib/pharmacy/prescriptions'
import { FEATURE_FLAG_LABELS, type FeatureFlag } from '@/lib/features/flags'
import type { SaleFlags } from '@/lib/db/schema'
import type { CompanySession } from '@/lib/auth'
import type { z } from 'zod'
import { SAFE_USER } from '@/lib/db/safe-columns'
import { allocateSaleLineBatches, batchErrorInfo } from '@/lib/inventory/batches'
import { isQuarantineCode } from '@/lib/inventory/quarantine'
import { getTenantSalesSettings } from '@/lib/sales/return-settings'
import { ApprovalError, consumeApprovals, coverScopes, verifyApprovalTokens, type ApprovalScope } from '@/lib/auth/approval-token'
import { assignedPosProfiles, checkSaleShift, customerOutstanding, evaluateSaleControls, SHIFT_ISSUE_MESSAGES } from '@/lib/pos/sale-controls'
import { priceSaleCart, recordPromotionRedemptions, PromotionExhaustedError, type SalePricing } from '@/lib/pricing/sale-pricing'
import { PricingLineError } from '@/lib/pricing/load-context'
import { ChequeError, chequeAmountFor, insertCheque } from '@/lib/cheques/cheques'
import { getBranchScope, branchFilter, canAccessBranch, branchDeniedMessage } from '@/lib/auth/branch-access'
import { baseQtyFor, roundUnitPrice } from '@/lib/units/conversions'

const LIST_ITEM_EXCLUDED_COLUMNS = { description: false, allergens: false, alternatePartNumbers: false } as const

// GET all sales for the tenant (with pagination)
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    // Module Access: refused when the owner switched this module off for the caller's role
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError

    const parsed = validateSearchParams(request, salesListSchema)
    if (!parsed.success) return parsed.response

    const { search, status, customerId, posOpeningEntryId: shiftFilter, page, pageSize, all } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Build where conditions (tenantId filter handled by RLS)
      const conditions = []

      // K4: branch-restricted staff only see their own branches' sales
      const branchCond = branchFilter(await getBranchScope(session, db), sales.warehouseId)
      if (branchCond) conditions.push(branchCond)

      // Filter by customer
      if (customerId) {
        conditions.push(eq(sales.customerId, customerId))
      }

      // Filter by POS shift
      if (shiftFilter) {
        conditions.push(eq(sales.posOpeningEntryId, shiftFilter))
      }

      // Filter by status
      if (status && status !== 'all') {
        conditions.push(eq(sales.status, status as 'pending' | 'partial' | 'completed' | 'void'))
      }

      // Server-side search filter (invoice number or customer name)
      if (search) {
        const escaped = escapeLikePattern(search)
        conditions.push(
          or(
            ilike(sales.invoiceNo, `%${escaped}%`),
            ilike(sales.customerName, `%${escaped}%`)
          )!
        )
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Get total count for pagination
      const [{ count: totalCount }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(sales)
        .where(whereClause)

      // Calculate pagination
      // all=true lifts the 100-per-page cap (up to 1000) but an explicit pageSize still applies:
      // the POS return search asks for `pageSize=20&all=true` and must not load 1000 sales.
      const explicitPageSize = request.nextUrl.searchParams.has('pageSize')
      const limit = all ? Math.min(explicitPageSize ? pageSize : 1000, 1000) : Math.min(pageSize, 100) // Max 100 per page
      const offset = all ? undefined : (page - 1) * pageSize

      const result = await db.query.sales.findMany({
        where: whereClause,
        with: {
          customer: true,
          user: SAFE_USER,
          items: {
            with: {
              // list view: skip the large free-text / JSON item columns
              item: { columns: LIST_ITEM_EXCLUDED_COLUMNS },
            },
          },
          // tenders per sale (split / store credit / refunds out), e.g. for an exact shift summary
          payments: {
            columns: { id: true, amount: true, method: true, reference: true, createdAt: true, voidedAt: true },
          },
        },
        orderBy: [desc(sales.createdAt)],
        limit,
        offset,
      })

      // Get returns only for original sales on the current page (not all returns in DB)
      const originalSaleIds = result
        .filter((s: { isReturn: boolean | null }) => !s.isReturn)
        .map((s: { id: string }) => s.id)

      const returnsBySaleId = new Map<string, Array<typeof result[0]>>()
      if (originalSaleIds.length > 0) {
        const pageReturns = await db.query.sales.findMany({
          where: and(
            eq(sales.isReturn, true),
            inArray(sales.returnAgainst, originalSaleIds)
          ),
          with: {
            customer: true,
            user: SAFE_USER,
            items: {
              with: {
                item: { columns: LIST_ITEM_EXCLUDED_COLUMNS },
              },
            },
            payments: {
              columns: { id: true, amount: true, method: true, reference: true, createdAt: true, voidedAt: true },
            },
          },
        })
        for (const ret of pageReturns) {
          if (ret.returnAgainst) {
            const existing = returnsBySaleId.get(ret.returnAgainst) || []
            existing.push(ret)
            returnsBySaleId.set(ret.returnAgainst, existing)
          }
        }
      }

      // Add return information to each sale
      const salesWithReturnInfo = result.map((sale: typeof result[0]) => {
        // For returns, get the original sale info
        let originalSale = null
        if (sale.isReturn && sale.returnAgainst) {
          const original = result.find(s => s.id === sale.returnAgainst)
          if (original) {
            originalSale = {
              id: original.id,
              invoiceNo: original.invoiceNo,
            }
          }
        }

        // For original sales, calculate return status
        let returnStatus: 'none' | 'partial' | 'full' = 'none'
        let linkedReturns: { id: string; invoiceNo: string; total: string }[] = []

        if (!sale.isReturn) {
          const returns = returnsBySaleId.get(sale.id) || []
          if (returns.length > 0) {
            linkedReturns = returns.map(r => ({
              id: r.id,
              invoiceNo: r.invoiceNo,
              total: r.total,
            }))

            // Calculate total returned amount
            const totalReturned = returns.reduce((sum, r) => sum + Math.abs(parseCurrency(r.total)), 0)
            const originalTotal = parseCurrency(sale.total)

            // W8: per-line returned_quantity is authoritative; amounts are the fallback for
            // legacy returns that could not be bound to a line (deleted items).
            returnStatus = returnStatusOf(sale.items)
            if (returnStatus === 'none') {
              if (compareCurrency(totalReturned, originalTotal) >= 0) {
                returnStatus = 'full'
              } else if (totalReturned > 0) {
                returnStatus = 'partial'
              }
            }
          }
        }

        return {
          ...sale,
          originalSale,
          returnStatus,
          linkedReturns,
        }
      })

      // Fetch linked sales order numbers for sales created from SOs
      const soIds = [...new Set(
        salesWithReturnInfo
          .map((s: { salesOrderId?: string | null }) => s.salesOrderId)
          .filter(Boolean) as string[]
      )]

      let soMap: Record<string, string> = {}
      if (soIds.length > 0) {
        const soRecords = await db
          .select({ id: salesOrders.id, orderNo: salesOrders.orderNo })
          .from(salesOrders)
          .where(sql`${salesOrders.id} IN ${soIds}`)
        soMap = Object.fromEntries(soRecords.map(so => [so.id, so.orderNo]))
      }

      const salesWithSource = salesWithReturnInfo.map((sale: { salesOrderId?: string | null }) => ({
        ...sale,
        salesOrderNo: sale.salesOrderId ? soMap[sale.salesOrderId] || null : null,
      }))

      // Return paginated response (or just array for backward compatibility with all=true)
      if (all) {
        return NextResponse.json(salesWithSource)
      }

      return NextResponse.json({
        data: salesWithSource,
        pagination: {
          page,
          pageSize,
          total: totalCount,
          totalPages: Math.ceil(totalCount / pageSize),
        }
      })
    })
  } catch (error) {
    logError('api/sales', error)
    return NextResponse.json({ error: 'Failed to fetch sales' }, { status: 500 })
  }
}

// POST create new sale
export async function POST(request: NextRequest) {
  // Kept outside the try so the catch can resolve an idempotent duplicate (racing retries)
  let idemClientSaleId: string | undefined
  let idemTenantId: string | undefined
  let idemOfflineRef: string | undefined
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const quotaError = await requireQuota(session.user.tenantId, 'essential')
    if (quotaError) return quotaError

    // Resolve valid user ID (session.user.id may be accountId for stale JWTs)
    const userId = await resolveUserIdRequired(session)

    const parsed = await validateBody(request, createSaleSchema)
    if (!parsed.success) return parsed.response

    const { clientSaleId, customerId, vehicleId, customerName, vehiclePlate, vehicleDescription, cartItems, paymentMethod, paymentSplits, subtotal, discount, discountType, discountReason, tax, taxRate: _bodyTaxRate, taxInclusive: bodyTaxInclusive, taxBreakdown: bodyTaxBreakdown, total, amountPaid, creditAmount, addOverpaymentToCredit, isReturn, warehouseId: providedWarehouseId, posOpeningEntryId, loyaltyPointsRedeemed, costCenterId: providedCostCenterId, workOrderId, restaurantOrderId, tipAmount, giftCardId, offlineRef, approvalTokens, couponCodes, promotionDiscount: clientPromotionDiscount, soldAt } = parsed.data

    // Check permission: createSales for regular sales, processReturns for returns
    if (isReturn) {
      const permError = requirePermission(session, 'processReturns')
      if (permError) return permError
    } else {
      const permError = requirePermission(session, 'createSales')
      if (permError) return permError
    }
    // Note: gift_card is NOT in refundMethod enum (Zod blocks it at validation)

    // Feature switches (super admin → Features): credit sales, gift cards, loyalty, coupons.
    // Offline sales already happened at the counter: they sync whatever the switches say now.
    if (!isReturn && !offlineRef) {
      const flags = await getTenantFeatureFlags(session.user.tenantId)
      const methods = new Set([paymentMethod, ...(paymentSplits ?? []).map((p) => p.method)])
      const off = (flag: FeatureFlag) => NextResponse.json({ error: `${FEATURE_FLAG_LABELS[flag]} is turned off for this business.`, code: 'FEATURE_DISABLED', feature: flag }, { status: 403 })
      if (!flags.credit_customer && (methods.has('credit') || (creditAmount ?? 0) > 0)) return off('credit_customer')
      if (!flags.gift_cards && (methods.has('gift_card') || giftCardId)) return off('gift_cards')
      if (!flags.loyalty && (loyaltyPointsRedeemed ?? 0) > 0) return off('loyalty')
      if (!flags.promotions && (couponCodes?.length ?? 0) > 0) return off('promotions')
      if (!flags.cheques && methods.has('cheque')) return off('cheques')
    }

    // K1: a cheque tender carries the cheque's details (one cheque per sale). An offline sale
    // queued by an older client may lack them: it is recorded without a register entry.
    if (!isReturn) {
      const chequeSplits = (paymentSplits ?? []).filter((p) => p.method === 'cheque').length
      const paysByCheque = paymentSplits?.length ? chequeSplits > 0 : paymentMethod === 'cheque'
      if (chequeSplits > 1) {
        return NextResponse.json({ error: 'Only one cheque can be taken per sale', code: 'ONE_CHEQUE_PER_SALE' }, { status: 400 })
      }
      if (paysByCheque && !parsed.data.cheque && !offlineRef) {
        return NextResponse.json({ error: 'Enter the cheque number, bank and date', code: 'CHEQUE_DETAILS_REQUIRED' }, { status: 400 })
      }
    }

    // Early client-side discount sanity check (skip for returns)
    // Server-side validation with calculated subtotal happens after cart expansion (line ~492)
    if (discount && discount < 0) {
      return NextResponse.json({ error: 'Discount cannot be negative' }, { status: 400 })
    }

    // Pre-validate accounting config before starting transaction
    const acctError = await requireAccountingConfig(rawDb, session.user.tenantId, 'sale')
    if (acctError) return acctError

    idemClientSaleId = clientSaleId
    idemTenantId = session.user.tenantId
    idemOfflineRef = offlineRef

    // Returns: one shared implementation (locks the original sale, forces original prices,
    // reverses tax, bounds the refund, restores stock/serials through the ledger).
    if (isReturn) {
      return await handleReturnPost(session, userId, parsed.data)
    }

    // Pharmacy: prescription / controlled medicines need a prescription. Checked before the
    // transaction; an offline sale already happened, so it is recorded with whatever it carried.
    const rx = await withTenant(session.user.tenantId, (tdb) =>
      prescriptionRequirement(tdb, session.user.tenantId, cartItems.map((c) => c.itemId).filter((x): x is string => !!x)))
    if (!offlineRef) {
      const rxProblem = prescriptionProblem(rx.level, parsed.data.prescription)
      if (rxProblem) {
        return NextResponse.json({ error: rxProblem, code: 'PRESCRIPTION_REQUIRED', level: rx.level, items: rx.items.map((i) => ({ id: i.id, name: i.name, drugSchedule: i.drugSchedule })) }, { status: 400 })
      }
    }

    // W6: a sale made offline (offlineRef) is a done deal — the customer paid and left. Catalog
    // price changes, tax rounding against cached templates and stock shortfalls are ACCEPTED and
    // recorded in sales.flags; managers are notified after commit.
    const isOfflineSale = !!offlineRef
    const saleFlags: SaleFlags = isOfflineSale ? { offline: true } : {}
    // D2: printed receipt number when the queue had to re-number the sale (lookup by alias).
    if (isOfflineSale && parsed.data.offlineRefAlias && parsed.data.offlineRefAlias !== offlineRef) saleFlags.offlineRefAlias = parsed.data.offlineRefAlias
    let offlineNotice: { saleId: string; invoiceNo: string } | null = null

    // Execute with RLS tenant context
    const response = await withTenant(session.user.tenantId, async (db) => {
      // Idempotency check for offline POS queue retries
      if (clientSaleId) {
        const existingSale = await db.query.sales.findFirst({
          where: and(
            eq(sales.tenantId, session.user.tenantId),
            eq(sales.clientSaleId, clientSaleId)
          ),
          with: {
            customer: true,
            user: SAFE_USER,
            items: {
              with: {
                item: true,
              },
            },
          },
        })
        if (existingSale) {
          // First attempt reached the server but its reply was lost, and the phone then queued the
          // sale with an offline receipt number: record that number so the printed OFF- code
          // can be scanned for returns. Never overwrite an existing reference.
          if (offlineRef && !existingSale.offlineRef) {
            try {
              await db.update(sales).set({ offlineRef })
                .where(and(eq(sales.id, existingSale.id), sql`${sales.offlineRef} IS NULL`))
              existingSale.offlineRef = offlineRef
            } catch (refError) {
              // unique (tenant, offline_ref) clash: keep the sale as is
              logError('api/sales offlineRef backfill', refError)
            }
          }
          return NextResponse.json(existingSale, { status: 200 })
        }
      }
      // Same offline receipt replayed (e.g. from another queue entry): return the existing sale
      if (offlineRef) {
        const existingOffline = await db.query.sales.findFirst({
          where: and(eq(sales.tenantId, session.user.tenantId), eq(sales.offlineRef, offlineRef)),
          with: { customer: true, user: SAFE_USER, items: { with: { item: true } } },
        })
        if (existingOffline) {
          // Two devices printed the same ref (device-code collision): never merge different sales
          if (clientSaleId && existingOffline.clientSaleId && existingOffline.clientSaleId !== clientSaleId) {
            return NextResponse.json({ error: `Offline receipt number ${offlineRef} is already used by another sale`, code: 'OFFLINE_REF_CONFLICT' }, { status: 409 })
          }
          return NextResponse.json(existingOffline, { status: 200 })
        }
      }

      // H1: a POS sale belongs to an open shift of the selling cashier. Supervisors (manageSales)
      // may ring up on any open shift. Cashiers assigned to a POS counter must sell on a shift
      // (work-order invoices are billed from the workshop, not the till). An offline sale is a
      // done deal: accepted and flagged for review instead.
      const isSupervisor = hasPermission(session.user.role, 'manageSales', session.user.tenantId, session.user.customRoleId)
      const sellerIds = [...new Set([userId, session.user.id])]
      const shiftCheck = await checkSaleShift(db, { posOpeningEntryId, userIds: sellerIds, canUseAnyShift: isSupervisor })
      let saleShiftId: string | null = shiftCheck.shift?.id || null
      if (shiftCheck.issue) {
        if (!isOfflineSale) {
          return NextResponse.json({ error: SHIFT_ISSUE_MESSAGES[shiftCheck.issue], code: shiftCheck.issue }, { status: shiftCheck.issue === 'SHIFT_NOT_YOURS' ? 403 : 400 })
        }
        saleFlags.shiftIssue = { code: shiftCheck.issue, posOpeningEntryId: posOpeningEntryId || null }
        if (shiftCheck.issue === 'SHIFT_NOT_FOUND') saleShiftId = null
      }
      const assignedProfiles = shiftCheck.shift ? [] : await assignedPosProfiles(db, sellerIds)
      if (!posOpeningEntryId && !isSupervisor && !workOrderId && assignedProfiles.length > 0) {
        if (!isOfflineSale) {
          return NextResponse.json({ error: SHIFT_ISSUE_MESSAGES.SHIFT_REQUIRED, code: 'SHIFT_REQUIRED' }, { status: 400 })
        }
        saleFlags.shiftIssue = { code: 'SHIFT_REQUIRED', posOpeningEntryId: null }
      }
      // The counter whose rules (discount limit, rate changes, negative stock) govern this sale
      const governingProfile = shiftCheck.profile || assignedProfiles[0] || null

      // Get warehouse ID - use provided or default warehouse (RLS scopes the query)
      let warehouseId = providedWarehouseId

      // K4: a branch-restricted cashier sells only from their own branches (and on their counters).
      // Without a warehouse in the request they sell from the shift's branch or their first branch.
      // An offline sale already happened: it is accepted and flagged for review instead.
      const branchScope = await getBranchScope(session, db)
      if (branchScope) {
        const shiftBranch = shiftCheck.profile?.warehouseId || null
        if (!warehouseId) warehouseId = shiftBranch && branchScope.includes(shiftBranch) ? shiftBranch : branchScope[0]
        const foreign = [warehouseId, shiftBranch].filter((w): w is string => !!w && !canAccessBranch(branchScope, w))
        if (foreign.length > 0) {
          if (!isOfflineSale) {
            return NextResponse.json({ error: await branchDeniedMessage(branchScope, db), code: 'BRANCH_ACCESS_DENIED' }, { status: 403 })
          }
          saleFlags.branchIssue = { code: 'BRANCH_ACCESS_DENIED', warehouseIds: foreign }
        }
      }

      // Validate provided warehouse exists and is active
      if (warehouseId) {
        const warehouse = await db.query.warehouses.findFirst({
          where: and(
            eq(warehouses.id, warehouseId),
            eq(warehouses.isActive, true),
          ),
        })
        if (!warehouse) {
          return NextResponse.json({ error: 'Selected warehouse not found or inactive' }, { status: 400 })
        }
        // D1: the quarantine location holds returned goods; it is never a selling location
        if (isQuarantineCode(warehouse.code)) {
          return NextResponse.json({ error: 'The quarantine warehouse cannot be used for sales', code: 'QUARANTINE_WAREHOUSE' }, { status: 400 })
        }
      }

      if (!warehouseId) {
        const defaultWarehouse = await db.query.warehouses.findFirst({
          where: and(
            eq(warehouses.isDefault, true),
            eq(warehouses.isActive, true)
          ),
        })
        if (defaultWarehouse && !isQuarantineCode(defaultWarehouse.code)) {
          warehouseId = defaultWarehouse.id
        } else {
          // Fallback: get any active warehouse (never the quarantine location)
          const anyWarehouse = await db.query.warehouses.findFirst({
            where: and(eq(warehouses.isActive, true), sql`upper(${warehouses.code}) <> 'QUARANTINE'`),
          })
          if (anyWarehouse) {
            warehouseId = anyWarehouse.id
          }
        }
      }

      if (!warehouseId) {
        return NextResponse.json({ error: 'No warehouse configured. Please set up a warehouse first.' }, { status: 400 })
      }

      // Resolve denormalized names
      let resolvedCustomerName = customerName
      let resolvedVehiclePlate = vehiclePlate
      let resolvedVehicleDescription = vehicleDescription

      // Get customer name if not provided (RLS scopes the query)
      if (customerId && !resolvedCustomerName) {
        const customer = await db.query.customers.findFirst({
          where: eq(customers.id, customerId),
        })
        if (customer) {
          resolvedCustomerName = customer.name
        }
      }

      // Get vehicle info if not provided (RLS scopes the query)
      if (vehicleId && (!resolvedVehiclePlate || !resolvedVehicleDescription)) {
        const vehicle = await db.query.vehicles.findFirst({
          where: eq(vehicles.id, vehicleId),
        })
        if (vehicle) {
          if (!resolvedVehiclePlate) {
            resolvedVehiclePlate = vehicle.licensePlate ?? undefined
          }
          if (!resolvedVehicleDescription) {
            resolvedVehicleDescription = `${vehicle.year ? `${vehicle.year} ` : ''}${vehicle.make} ${vehicle.model}`
          }
        }
      }

      // Issue #10: Validate vehicle belongs to customer (if both provided)
      if (customerId && vehicleId) {
        const vehicle = await db.query.vehicles.findFirst({
          where: eq(vehicles.id, vehicleId),
        })
        if (vehicle && vehicle.customerId && vehicle.customerId !== customerId) {
          return NextResponse.json({
            error: 'Selected vehicle does not belong to the selected customer',
            code: 'VEHICLE_CUSTOMER_MISMATCH'
          }, { status: 400 })
        }
      }

      // Verify all items belong to this tenant before processing (RLS scopes)
      // Issue #3: For returns, skip validation for items with null/empty itemId (deleted items)
      const itemIds = cartItems
        .map((item) => item.itemId)
        .filter((id): id is string => !!id && id.trim() !== '')
      const tenantItems = itemIds.length > 0
        ? await db.query.items.findMany({
            where: sql`${items.id} IN (${sql.join(itemIds.map((id: string) => sql`${id}`), sql`, `)})`,
          })
        : []

    // The same item may legitimately sit on several lines (separate batch lines, a line at an
    // edited price), so compare against the distinct ids the query can return.
    if (tenantItems.length !== new Set(itemIds).size || cartItems.some((c) => !c.itemId)) {
      return NextResponse.json({ error: 'Invalid items in cart' }, { status: 400 })
    }

    // H5: server-side pricing — catalog / unit base prices, price lists for this customer and
    // counter, promotions (src/lib/pricing/sale-pricing.ts). Work orders and restaurant orders keep
    // their own prices (units still apply).
    let pricing: SalePricing
    try {
      pricing = await priceSaleCart(db, session.user.tenantId, {
        cartItems,
        customerId: customerId || null,
        posProfileId: shiftCheck.shift?.posProfileId || governingProfile?.id || null,
        couponCodes,
        at: isOfflineSale && soldAt ? new Date(soldAt) : undefined,
        applyRules: !workOrderId && !restaurantOrderId,
      })
    } catch (e) {
      if (e instanceof PricingLineError) {
        return NextResponse.json({
          error: e.code === 'UOM_NOT_FOUND' ? `Item has no "${e.uom}" unit` : 'Invalid items in cart', code: e.code,
        }, { status: 400 })
      }
      throw e
    }
    const priceChanged = () => NextResponse.json({
      error: 'Prices or promotions changed. Review the cart and try again.',
      code: 'PRICE_CHANGED',
      quote: pricing.quote,
    }, { status: 409 })
    // The client sent the plain catalog price where a price list applies (it did not know the list)
    if (pricing.staleLines.length > 0) {
      if (!isOfflineSale) return priceChanged()
      saleFlags.priceDifferences ||= []
    }

    // Build cart items for processing
    interface ExpandedCartItem {
      itemId: string
      name: string
      quantity: number
      unitPrice: number
      discount: number
      total: number
      costPrice: number
      serialNumberIds?: string[]
      batchId?: string | null
      batchNumber?: string | null
      /** index of the source line in cartItems (per-line tax data) */
      sourceIndex: number
      /** H1: catalog price at the time of sale (audit of price overrides) */
      listPrice: number
      isWeighable: boolean
      /** H5: price list / catalog price for this customer, unit and quantity (rate-change control) */
      resolvedPrice: number
      /** H5: manual line discount (discount = manual + promotionDiscount) */
      manualDiscount: number
      promotionDiscount: number
      promotions: Array<{ promotionId: string; label: string; amount: number }>
      cartPromotionShare: number
      priceListId: string | null
      uom: string | null
      uomFactor: number
      /** quantity × uomFactor: what stock, batches and COGS move */
      baseQuantity: number
    }

    const expandedCartItems: ExpandedCartItem[] = []

    for (const [sourceIndex, cartItem] of cartItems.entries()) {
      const item = tenantItems.find(i => i.id === cartItem.itemId)
      if (!item) continue

      const pl = pricing.lines[sourceIndex]
      // 4 dp: a unit derived by a factor (0.345 / g); prices in cents are unchanged
      const unitPrice = roundUnitPrice(pl.unitPrice)
      const quantity = cartItem.quantity
      const manualDiscount = roundCurrency(cartItem.discount || 0)
      const itemDiscount = roundCurrency(manualDiscount + pl.promotionDiscount)

      // A sale line takes goods out; taking goods back is a return (processReturns, priced from
      // the original invoice) or an exchange — never a negative line on a normal sale.
      if (!(quantity > 0)) {
        return NextResponse.json({ error: `Quantity must be greater than zero for "${cartItem.name}"` }, { status: 400 })
      }

      // Issue #20: Validate negative prices (only for non-returns)
      if (unitPrice < 0) {
        return NextResponse.json({ error: `Price cannot be negative for "${cartItem.name}"` }, { status: 400 })
      }

      // Issue #15: Validate item-level discount doesn't exceed item subtotal
      const itemSubtotal = roundCurrency(unitPrice * Math.abs(quantity))
      if (itemDiscount > itemSubtotal) {
        return NextResponse.json({ error: `Discount exceeds item total for "${cartItem.name}"` }, { status: 400 })
      }

      // Serial numbers are counted per base unit
      if (pl.uomFactor !== 1 && item.trackSerialNumbers) {
        return NextResponse.json({ error: `"${cartItem.name}" is serial-tracked: sell it in its base unit` }, { status: 400 })
      }

      const itemTotal = roundCurrency(unitPrice * quantity - itemDiscount)
      expandedCartItems.push({
        itemId: cartItem.itemId || '',
        name: cartItem.name || '',
        quantity: quantity,
        unitPrice: unitPrice,
        discount: itemDiscount,
        total: itemTotal,
        // cost of ONE unit sold (a box of 12 costs 12 × the per-piece cost)
        costPrice: item ? roundCurrency(parseFloat(item.costPrice) * pl.uomFactor) : 0,
        serialNumberIds: cartItem.serialNumberIds || undefined,
        batchId: cartItem.batchId || null,
        batchNumber: cartItem.batchNumber || null,
        sourceIndex,
        listPrice: roundCurrency(pl.basePrice),
        isWeighable: !!item.isWeighable,
        resolvedPrice: roundUnitPrice(pl.resolvedPrice),
        manualDiscount,
        promotionDiscount: pl.promotionDiscount,
        promotions: pl.promotions.map(({ promotionId, label, amount }) => ({ promotionId, label, amount })),
        cartPromotionShare: pl.cartDiscountShare,
        priceListId: pl.priceListId,
        uom: pl.uom,
        uomFactor: pl.uomFactor,
        baseQuantity: baseQtyFor(quantity, pl.uomFactor),
      })

      // W6: offline sale sold at a (cached) price that differs from today's catalog price
      if (isOfflineSale) {
        const catalog = roundUnitPrice(pl.resolvedPrice)
        if (Math.abs(unitPrice - catalog) > 0.00005) {
          (saleFlags.priceDifferences ||= []).push({ itemId: item.id, name: item.name, sold: unitPrice, catalog })
        }
      }
    }
    if (saleFlags.priceDifferences && saleFlags.priceDifferences.length === 0) delete saleFlags.priceDifferences

    // H5: promotions are recomputed. A client that priced with other promotions (or none) gets
    // 409 PRICE_CHANGED with the server quote; an offline sale is a done deal: the device's line
    // totals and promotion amount stand, the difference is flagged.
    let promotionCartDiscount = pricing.cartPromotionDiscount
    let appliedPromotions = pricing.appliedPromotions
    if (pricing.active) {
      const serverSubtotal = roundCurrency(expandedCartItems.reduce((sum, ci) => sum + ci.total, 0))
      const clientPromo = roundCurrency(clientPromotionDiscount || 0)
      const linesDiffer = Math.abs(serverSubtotal - subtotal) > 0.05
      const cartDiffers = Math.abs(clientPromo - promotionCartDiscount) > 0.01
      if (linesDiffer || cartDiffers) {
        if (!isOfflineSale) return priceChanged()
        saleFlags.promotionDifference = {
          serverSubtotal, clientSubtotal: subtotal, serverPromotionDiscount: promotionCartDiscount, clientPromotionDiscount: clientPromo,
        }
        if (linesDiffer) {
          // device prices without (these) promotions: drop the server's line promotions
          for (const ci of expandedCartItems) {
            ci.discount = ci.manualDiscount
            ci.promotionDiscount = 0
            ci.promotions = []
            ci.total = roundCurrency(ci.unitPrice * ci.quantity - ci.discount)
          }
          appliedPromotions = []
        }
        promotionCartDiscount = clientPromo
        if (cartDiffers) appliedPromotions = appliedPromotions.filter((a) => expandedCartItems.some((ci) => ci.promotions.some((p) => p.promotionId === a.promotionId)))
      }
    } else if ((clientPromotionDiscount || 0) > 0.004) {
      // a "promotion" the server does not know of is not a promotion
      if (!isOfflineSale) return priceChanged()
      promotionCartDiscount = roundCurrency(clientPromotionDiscount || 0)
      saleFlags.promotionDifference = { serverPromotionDiscount: 0, clientPromotionDiscount: promotionCartDiscount }
    }
    const usedCoupon = (couponCodes || []).map((c) => c.trim().toUpperCase()).find(Boolean) || null
    // the server's cart promotions stand (offline devices may have applied a different amount)
    const cartPromotionsUsed = pricing.cartPromotions.length > 0 && compareCurrency(promotionCartDiscount, pricing.cartPromotionDiscount) === 0
    const manualCartDiscount = roundCurrency(discount || 0)

    const finalSubtotal = subtotal
    // sales.discount_amount = manual cart discount + cart promotions (H5)
    const finalDiscount = roundCurrency(manualCartDiscount + promotionCartDiscount)
    const finalTax = tax || 0
    const finalTotal = total

    // Value of the loyalty points redeemed on this sale (server-computed, see below)
    let loyaltyRedeemValue = 0

    // Server-side tax recalculation result (populated when client doesn't send taxBreakdown)
    let serverTaxResult: Awaited<ReturnType<typeof recalculateDocumentTax>> | null = null

    // Issue #4: Server-side total validation
    {
      const calculatedSubtotal = expandedCartItems.reduce((sum, item) => sum + item.total, 0)
      if (Math.abs(calculatedSubtotal - finalSubtotal) > 0.05) {
        return NextResponse.json({
          error: 'Cart total mismatch. Please refresh and try again.',
        }, { status: 400 })
      }

      // Server-side discount validation against calculated subtotal
      if (finalDiscount > calculatedSubtotal) {
        return NextResponse.json({ error: 'Discount cannot exceed subtotal' }, { status: 400 })
      }
      // Tax is charged on what the customer pays: each line net of its share of the cart discount
      // (same rule as the POS cart and returns.ts computeSalePricing).
      const discountRatio = calculatedSubtotal > 0 ? Math.max(0, 1 - finalDiscount / calculatedSubtotal) : 1
      const taxableLines = expandedCartItems.map(ci => ({
        itemId: ci.itemId || null,
        lineTotal: roundCurrency(ci.total * discountRatio),
      }))

      // Part of the tax that is added on top of the prices (inclusive tax is already in them).
      // Without a breakdown (flat-rate clients) the body flag, else the tenant setting, decides.
      let exclusiveTax = finalTax
      if (finalTax > 0 && !(bodyTaxBreakdown && bodyTaxBreakdown.length > 0)) {
        let inclusive = bodyTaxInclusive
        if (inclusive === undefined) {
          const t = await db.query.tenants.findFirst({ where: eq(tenants.id, session.user.tenantId), columns: { taxInclusive: true } })
          inclusive = !!t?.taxInclusive
        }
        if (inclusive) exclusiveTax = 0
      }
      // Tax-exempt customers pay no tax: the server recalculation must not add any
      const taxExemptCustomer = customerId
        ? !!(await db.query.customers.findFirst({ where: eq(customers.id, customerId), columns: { taxExempt: true } }))?.taxExempt
        : false

      // Server-side tax validation and recalculation
      // If client sends taxBreakdown (modern POS), validate it.
      // If not, recalculate server-side using templates to ensure correct tax.
      if (bodyTaxBreakdown && bodyTaxBreakdown.length > 0) {
        // Template-based tax from client: validate total matches finalTax
        const breakdownTotal = roundCurrency(bodyTaxBreakdown.reduce((s, b) => s + b.amount, 0))
        // Offline sales tolerate up to 1.00 of rounding (an inconsistent payload beyond that is a bug)
        if (Math.abs(breakdownTotal - finalTax) > (isOfflineSale ? 1.0 : 0.50)) {
          return NextResponse.json({
            error: 'Tax breakdown total does not match tax amount. Please refresh and try again.',
          }, { status: 400 })
        }
        exclusiveTax = roundCurrency(bodyTaxBreakdown.filter(b => !b.includedInPrice).reduce((s, b) => s + b.amount, 0))
        if (isOfflineSale) {
          // Computed on the device from cached templates: accept it, record any difference
          // against today's templates (≤ 1.00 = rounding; more = templates changed meanwhile).
          const check = await recalculateDocumentTax(db, session.user.tenantId, taxableLines, { type: 'sales', taxExempt: taxExemptCustomer })
          const difference = roundCurrency(finalTax - check.totalTax)
          if (Math.abs(difference) >= 0.01) {
            saleFlags.taxDifference = { client: finalTax, server: check.totalTax, difference, withinTolerance: Math.abs(difference) <= 1.0 }
          }
        }
      } else {
        // No client breakdown: compute server-side using tax templates
        serverTaxResult = await recalculateDocumentTax(db, session.user.tenantId, taxableLines, { type: 'sales', taxExempt: taxExemptCustomer })
        if (serverTaxResult.taxBreakdown && serverTaxResult.taxBreakdown.length > 0) {
          exclusiveTax = serverTaxResult.totalTax > 0
            ? roundCurrency(finalTax * (serverTaxResult.exclusiveTax / serverTaxResult.totalTax))
            : 0
          // Validate server-computed tax vs client tax (allow small rounding diff)
          if (isOfflineSale && Math.abs(serverTaxResult.totalTax - finalTax) >= 0.01) {
            // Offline sale without a breakdown (older app): the tax the customer paid stands;
            // drop the server breakdown so the GL posts the client's tax total.
            const difference = roundCurrency(finalTax - serverTaxResult.totalTax)
            saleFlags.taxDifference = { client: finalTax, server: serverTaxResult.totalTax, difference, withinTolerance: Math.abs(difference) <= 1.0 }
            serverTaxResult = null
          } else if (Math.abs(serverTaxResult.totalTax - finalTax) > 0.50) {
            return NextResponse.json({
              error: 'Tax calculation mismatch. Please refresh and try again.',
            }, { status: 400 })
          }
        }
      }

      // Loyalty points redeemed are a payment-like reduction of the amount due; their value comes
      // from the active programme and the customer's tier (same formula as the POS).
      if (loyaltyPointsRedeemed && loyaltyPointsRedeemed > 0) {
        if (!customerId) {
          return NextResponse.json({ error: 'Select a customer to redeem loyalty points' }, { status: 400 })
        }
        const program = await db.query.loyaltyPrograms.findFirst({ where: eq(loyaltyPrograms.status, 'active') })
        if (!program) {
          return NextResponse.json({ error: 'No active loyalty programme to redeem points from', code: 'LOYALTY_INACTIVE' }, { status: 400 })
        }
        const redeemer = await db.query.customers.findFirst({ where: eq(customers.id, customerId) })
        const tier = redeemer
          ? await db.query.loyaltyTiers.findFirst({
              where: and(eq(loyaltyTiers.tier, redeemer.loyaltyTier || 'bronze'), eq(loyaltyTiers.isActive, true)),
            })
          : undefined
        const redeemRate = tier ? (parseFloat(tier.redeemRate) || 0) : 1
        loyaltyRedeemValue = roundCurrency(loyaltyPointsRedeemed * (parseFloat(program.conversionFactor) || 0) * redeemRate)
      }

      // The total is what the GL posts and what the payments settle: it must follow from the
      // validated lines — subtotal − cart discount + tax added on top − loyalty redeemed + tip.
      const expectedTotal = roundCurrency(Math.max(0, finalSubtotal - finalDiscount + exclusiveTax - loyaltyRedeemValue + (tipAmount || 0)))
      const totalDifference = roundCurrency(finalTotal - expectedTotal)
      if (Math.abs(totalDifference) > 0.05) {
        if (!isOfflineSale) {
          return NextResponse.json({
            error: 'Sale total does not match the items, discount and tax. Please refresh and try again.',
            code: 'TOTAL_MISMATCH',
            expectedTotal,
          }, { status: 400 })
        }
        // Offline: the customer already paid this total — record it for review
        saleFlags.totalDifference = { client: finalTotal, server: expectedTotal, difference: totalDifference }
      }
    }

      // H1: counter rules — discount limit / discounts disabled, price below catalog without rate
      // changes. Needs a supervisor approval token (verify-pin) unless the seller is a supervisor.
      const controls = evaluateSaleControls(governingProfile, {
        lines: expandedCartItems.map((ci) => ({
          // H5: promotions are not cashier discounts, and the rate check compares with the price
          // the price list gives this customer / unit / quantity (not the bare catalog price)
          name: ci.name, quantity: ci.quantity, unitPrice: ci.unitPrice, discount: ci.manualDiscount,
          catalogPrice: ci.resolvedPrice, isWeighable: ci.isWeighable,
        })),
        cartDiscount: manualCartDiscount,
      })
      const neededScopes: ApprovalScope[] = []
      if (controls.needsDiscountApproval) neededScopes.push('discount')
      if (controls.needsPriceApproval) neededScopes.push('price_change')
      // H8: posProfiles.allowNegativeStock lets this counter sell beyond recorded stock (flagged);
      // validateStockOnSave = false skips the early snapshot check (the locked check still runs).
      const allowNegativeStock = isOfflineSale || !!governingProfile?.allowNegativeStock
      const skipStockPreCheck = governingProfile?.validateStockOnSave === false

      // PRE-TRANSACTION STOCK CHECK (for early validation and user feedback)
      // Note: This check uses a snapshot of reserved quantities and may be slightly stale.
      // The authoritative check happens INSIDE the transaction with FOR UPDATE locks.
      // This pre-check provides early validation and better error messages.
      // Get reserved quantities from multiple sources (RLS scopes all queries)

      // 1. Reserved from draft work orders (warehouse-scoped)
      const reservedFromWorkOrders = await db
        .select({
          itemId: workOrderParts.itemId,
          reservedQty: sql<string>`COALESCE(SUM(CAST(${workOrderParts.quantity} AS DECIMAL)), 0)`,
        })
        .from(workOrderParts)
        .innerJoin(workOrders, eq(workOrderParts.workOrderId, workOrders.id))
        .where(and(
          eq(workOrders.status, 'draft'),
          eq(workOrders.warehouseId, warehouseId!)
        ))
        .groupBy(workOrderParts.itemId)

      // 2. Reserved from non-expired held sales (JSONB cart items) - warehouse-scoped
      const heldSalesData = await db.query.heldSales.findMany({
        where: and(
          eq(heldSales.warehouseId, warehouseId!),
          sql`${heldSales.expiresAt} > NOW()`
        ),
      })

      // 3. Reserved from estimates with holdStock enabled - warehouse-scoped
      const reservedFromEstimates = await db
        .select({
          itemId: insuranceEstimateItems.itemId,
          reservedQty: sql<string>`COALESCE(SUM(CAST(${insuranceEstimateItems.quantity} AS DECIMAL)), 0)`,
        })
        .from(insuranceEstimateItems)
        .innerJoin(insuranceEstimates, eq(insuranceEstimateItems.estimateId, insuranceEstimates.id))
        .where(
          and(
            eq(insuranceEstimates.holdStock, true),
            eq(insuranceEstimates.warehouseId, warehouseId!),
            sql`${insuranceEstimates.status} NOT IN ('cancelled', 'work_order_created')`,
            sql`${insuranceEstimateItems.itemId} IS NOT NULL`
          )
        )
        .groupBy(insuranceEstimateItems.itemId)

    // Combine all sources into reservedMap
    const reservedMap = new Map<string, number>()

    // Add work order reservations
    for (const r of reservedFromWorkOrders) {
      reservedMap.set(r.itemId, (reservedMap.get(r.itemId) || 0) + parseFloat(r.reservedQty))
    }

    // Add held sales reservations (parse JSONB cart items)
    for (const held of heldSalesData) {
      const cartItems = held.cartItems as Array<{ itemId: string; quantity: number; uomFactor?: number }>
      if (Array.isArray(cartItems)) {
        for (const item of cartItems) {
          if (item.itemId) {
            reservedMap.set(item.itemId, (reservedMap.get(item.itemId) || 0) + (item.quantity || 0) * (Number(item.uomFactor) || 1))
          }
        }
      }
    }

      // Add estimate reservations (with holdStock enabled)
      for (const r of reservedFromEstimates) {
        if (r.itemId) {
          reservedMap.set(r.itemId, (reservedMap.get(r.itemId) || 0) + parseFloat(r.reservedQty))
        }
      }

      const insufficientStockItems: string[] = []
      for (const cartItem of (skipStockPreCheck ? [] : expandedCartItems)) {
        const item = await db.query.items.findFirst({
          where: eq(items.id, cartItem.itemId),
        })
        if (item && item.trackStock) {
          // Get stock from warehouseStock table (RLS scopes)
          const stock = await db.query.warehouseStock.findFirst({
            where: and(
              eq(warehouseStock.itemId, item.id),
              eq(warehouseStock.warehouseId, warehouseId)
            ),
          })
          const currentStock = stock ? parseFloat(stock.currentStock) : 0
          const reserved = reservedMap.get(item.id) || 0
          const availableStock = currentStock - reserved
          if (availableStock < cartItem.baseQuantity) {
            insufficientStockItems.push(`${cartItem.name} (need: ${cartItem.baseQuantity}, available: ${availableStock})`)
          }
        }
      }

      if (insufficientStockItems.length > 0 && !allowNegativeStock) {
        return NextResponse.json({
          error: `Insufficient stock for: ${insufficientStockItems.join(', ')}`,
          insufficientStockItems,
        }, { status: 400 })
      }

      // Calculate payment amounts using final totals
      const totalAmount = finalTotal
      // Split tender: a 'credit' split is the part left on the customer's account (no money
      // received, no payment row); every other split is money received.
      const saleSplits = Array.isArray(paymentSplits) && paymentSplits.length > 0 ? paymentSplits : null
      const onAccountSplit = saleSplits
        ? roundCurrency(saleSplits.filter(sp => sp.method === 'credit').reduce((sum, sp) => sum + sp.amount, 0))
        : 0
      // Credit payment method means "sell on credit" — no money received now
      const cashCardAmount = saleSplits
        ? roundCurrency(saleSplits.filter(sp => sp.method !== 'credit').reduce((sum, sp) => sum + sp.amount, 0))
        : (paymentMethod === 'credit' ? 0 : (amountPaid || 0))
      const creditUsed = creditAmount || 0
      const totalPaid = cashCardAmount + creditUsed
      // Overpayment can only be kept as store credit when there is a customer to hold it
      const keepOverpayment = !!addOverpaymentToCredit && !!customerId
      const overpayment = Math.max(0, totalPaid - totalAmount)
      const actualPaidAmount = Math.min(totalPaid, totalAmount)
      // What the cash/card tender leaves in the drawer: change handed back is not revenue,
      // unless the overpayment was deliberately kept as customer credit.
      const cashCardRecorded = keepOverpayment
        ? cashCardAmount
        : Math.max(0, Math.min(cashCardAmount, actualPaidAmount - creditUsed))

      // Credit sales require a customer (need to know who owes the money)
      if ((paymentMethod === 'credit' || onAccountSplit > 0) && !customerId) {
        return NextResponse.json({ error: 'A customer must be selected for credit sales' }, { status: 400 })
      }
      // Store credit belongs to a customer, and can settle at most the sale total
      if (creditUsed > 0 && !customerId) {
        return NextResponse.json({ error: 'Select a customer to pay with store credit' }, { status: 400 })
      }
      if (compareCurrency(creditUsed, totalAmount) > 0) {
        return NextResponse.json({ error: 'Store credit used cannot exceed the sale total' }, { status: 400 })
      }
      // Split tenders are exact amounts (no change is given on a split)
      if (saleSplits && compareCurrency(roundCurrency(cashCardAmount + onAccountSplit + creditUsed), totalAmount) > 0) {
        return NextResponse.json({ error: 'Split payments exceed the amount due', code: 'SPLIT_OVERPAYMENT' }, { status: 400 })
      }

      // If using customer credit balance, verify customer has enough balance (RLS scopes)
      // (re-checked under a row lock inside the transaction)
      if (creditUsed > 0 && customerId) {
        const customer = await db.query.customers.findFirst({
          where: eq(customers.id, customerId),
        })
        if (!customer || parseFloat(customer.balance) < creditUsed) {
          return NextResponse.json({ error: 'Insufficient customer credit balance' }, { status: 400 })
        }
      }

      // H7: on-account / pay-later part of this sale against the customer's credit limit
      // (credit_limit > 0; 0 / empty = unlimited, same as dealers)
      let creditCheck: { limit: number; outstanding: number; newCredit: number } | null = null
      const newCredit = roundCurrency(Math.max(0, totalAmount - actualPaidAmount))
      if (customerId && newCredit > 0.004) {
        const customer = await db.query.customers.findFirst({ where: eq(customers.id, customerId), columns: { creditLimit: true } })
        const limit = parseCurrency(customer?.creditLimit)
        if (limit > 0) {
          const outstanding = await customerOutstanding(db, customerId)
          creditCheck = { limit, outstanding, newCredit }
          if (compareCurrency(roundCurrency(outstanding + newCredit), limit) > 0) neededScopes.push('credit_override')
        }
      }

      // H2: supervisor approval for whatever the rules flagged (single-use tokens, spent in the
      // sale's transaction). Offline sales cannot carry a fresh token: accepted and flagged.
      let saleApprovals: ReturnType<typeof coverScopes>['used'] = []
      let approvedBy: string | null = null
      if (neededScopes.length > 0) {
        if (isSupervisor) {
          approvedBy = userId
        } else {
          const cover = coverScopes(neededScopes, verifyApprovalTokens(approvalTokens, { tenantId: session.user.tenantId, requesterId: session.user.id }))
          if (cover.missing.length > 0) {
            if (!isOfflineSale) {
              const messages: Record<string, string> = {
                discount: governingProfile?.allowDiscountChange === false
                  ? 'Discounts on this counter need supervisor approval'
                  : `Discount of ${controls.discountPercent}% is above this counter's limit of ${parseFloat(String(governingProfile?.maxDiscountPercent ?? '100'))}%`,
                price_change: `Price below the catalog price needs supervisor approval (${controls.priceOverrides.map((o) => o.name).slice(0, 3).join(', ')})`,
                credit_override: creditCheck
                  ? `Credit limit exceeded: owes ${creditCheck.outstanding.toFixed(2)} + ${creditCheck.newCredit.toFixed(2)} on this sale, limit ${creditCheck.limit.toFixed(2)}`
                  : 'Credit limit exceeded',
              }
              return NextResponse.json({
                error: cover.missing.map((m) => messages[m]).join('. '),
                code: 'APPROVAL_REQUIRED',
                scopes: cover.missing,
                discountPercent: controls.discountPercent,
                maxDiscountPercent: governingProfile ? parseFloat(String(governingProfile.maxDiscountPercent)) : null,
                priceOverrides: controls.priceOverrides,
                credit: creditCheck,
              }, { status: 403 })
            }
            saleFlags.approvalMissing = { scopes: cover.missing, discountPercent: controls.discountPercent, priceOverrides: controls.priceOverrides, credit: creditCheck }
          }
          saleApprovals = cover.used
          approvedBy = cover.used[0]?.approverId || null
        }
        saleFlags.approvals = {
          scopes: neededScopes,
          approvedBy,
          nonces: saleApprovals.map((a) => a.nonce),
          discountPercent: controls.discountPercent,
          priceOverrides: controls.priceOverrides,
          credit: creditCheck,
        }
      }

      // Resolve cost center from POS profile (GL account now resolved from Modes of Payment in auto-post)
      let costCenterId = providedCostCenterId || null
      if (!costCenterId && shiftCheck.profile?.costCenterId) {
        costCenterId = shiftCheck.profile.costCenterId
      }

      // Stock ledger results of this sale (low-stock listeners are notified after commit)
      let saleStockChanges: Array<{ result: StockChangeResult; input: StockChangeInput }> = []

      // Create sale and items in transaction (RLS scopes)
      const result = await db.transaction(async (tx) => {
        // The real INV- number comes from the per-vendor sequence row (tenant_sequences), which stays
        // locked until commit. To keep that window short for busy stores (many cashiers of one
        // vendor), the sale is written with a unique temporary number and the real number is
        // allocated just before the final GL postings, then applied to the rows that mention it.
        // Numbering stays gap-free because allocation and use share this transaction.
        const pendingInvoiceNo = `PND-${crypto.randomUUID()}`
        let invoiceNo = pendingInvoiceNo

        // Lock the customer row FIRST. Inserting the sale (FK customer_id) takes a KEY SHARE lock
        // on it; two concurrent sales of one customer that each held that and then asked for
        // FOR UPDATE (store credit / loyalty below) deadlocked, and one failed with 409.
        if (customerId) {
          await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId)).for('update')
        }

      // Create sale
      const saleResult = await tx.insert(sales).values({
        tenantId: session.user.tenantId,
        clientSaleId: clientSaleId || null,
        offlineRef: offlineRef || null,
        createdBy: userId,
        customerId: customerId || null,
        vehicleId: vehicleId || null,
        warehouseId: warehouseId,
        posOpeningEntryId: saleShiftId,
        approvedBy,
        // Denormalized fields for historical accuracy
        customerName: resolvedCustomerName || null,
        vehiclePlate: resolvedVehiclePlate || null,
        vehicleDescription: resolvedVehicleDescription || null,
        invoiceNo,
        subtotal: String(finalSubtotal),
        discountAmount: String(finalDiscount),
        discountType: discountType || null,
        discountReason: discountReason || null,
        taxAmount: String(finalTax),
        taxBreakdown: bodyTaxBreakdown || serverTaxResult?.taxBreakdown || null,
        flags: saleFlags,
        total: String(finalTotal),
        paidAmount: String(actualPaidAmount),
        paymentMethod: creditUsed > 0 && cashCardAmount === 0 ? 'credit' : (paymentMethod || 'cash'),
        // Issue #13: Differentiate between pending (no payment) and partial payment
        status: actualPaidAmount >= totalAmount ? 'completed' : actualPaidAmount > 0 ? 'partial' : 'pending',
        isReturn: false,
        costCenterId: costCenterId || null,
        workOrderId: workOrderId || null,
        restaurantOrderId: restaurantOrderId || null,
        promotionDiscount: String(promotionCartDiscount),
        couponCode: usedCoupon && appliedPromotions.length > 0 ? usedCoupon : null,
      }).returning()
      const newSale = (saleResult as typeof sales.$inferSelect[])[0]

      // Quotation → sale (POS loaded the cart from ?fromQuotation): one quotation, one sale,
      // linked inside the sale transaction (RLS + explicit tenant filter)
      // (an offline sale syncing later never fails on it: the sale already happened)
      if (parsed.data.quotationId && !isReturn) {
        try {
          await linkQuotationToSale(tx, session.user.tenantId, parsed.data.quotationId, newSale.id)
        } catch (linkError) {
          if (!isOfflineSale) throw linkError
          logError('api/sales', linkError, { stage: 'offline-quotation-link', saleId: newSale.id })
        }
      }

      // Pharmacy prescription register
      if (parsed.data.prescription && rx.level !== 'none') {
        await recordPrescription(tx, { tenantId: session.user.tenantId, saleId: newSale.id, customerId: customerId || null, userId, level: rx.level, input: parsed.data.prescription })
      }

      // H5: promotion usage (limits are re-checked under lock; offline sales always count)
      if (appliedPromotions.length > 0) {
        await recordPromotionRedemptions(tx, {
          tenantId: session.user.tenantId, saleId: newSale.id, customerId: customerId || null,
          applied: appliedPromotions, strict: !isOfflineSale,
        })
      }

      // Spend the supervisor approvals (a reused token rolls the sale back)
      if (saleApprovals.length > 0) {
        await consumeApprovals(tx, {
          tenantId: session.user.tenantId, usedBy: userId, entityType: 'sale', entityId: newSale.id,
          approvals: saleApprovals, scopesFor: (a) => neededScopes.filter((sc) => a.scopes.includes(sc)),
        })
      }

      // Split tender (multiple payment methods) or single payment.
      // E1: every payment row written here is mirrored in `recordedPayments` — the GL settles the
      // receivable with one debit per method from exactly these rows.
      const recordedPayments: Array<{ method: string; amount: number }> = []
      const splits = saleSplits
      if (splits) {
        for (const split of splits) {
          // 'credit' split = left on the customer's account: receivable stays open, no payment row
          if (split.amount > 0 && split.method !== 'credit') {
            await tx.insert(payments).values({
              tenantId: session.user.tenantId,
              saleId: newSale.id,
              amount: String(split.amount),
              method: split.method,
              reference: split.reference || null,
              receivedBy: userId,
            })
            recordedPayments.push({ method: split.method, amount: roundCurrency(split.amount) })
          }
        }
        // Customer credit applied next to the splits (the balance is deducted below)
        if (creditUsed > 0) {
          await tx.insert(payments).values({
            tenantId: session.user.tenantId,
            saleId: newSale.id,
            amount: String(creditUsed),
            method: 'credit',
            receivedBy: userId,
          })
        }
      } else {
        // Create payment record for cash/card payment (what actually stays in the drawer)
        if (cashCardRecorded > 0) {
          await tx.insert(payments).values({
            tenantId: session.user.tenantId,
            saleId: newSale.id,
            amount: String(cashCardRecorded),
            method: paymentMethod || 'cash',
            receivedBy: userId,
          })
          recordedPayments.push({ method: paymentMethod || 'cash', amount: roundCurrency(cashCardRecorded) })
        }

        // Create payment record for credit used
        if (creditUsed > 0) {
          await tx.insert(payments).values({
            tenantId: session.user.tenantId,
            saleId: newSale.id,
            amount: String(creditUsed),
            method: 'credit',
            receivedBy: userId,
          })
        }
      }

      // K1: register the cheque taken for this sale (bounce / cancel later re-opens the sale)
      const chequeTender = roundCurrency(recordedPayments.filter((p) => p.method === 'cheque').reduce((sum, p) => sum + p.amount, 0))
      if (chequeTender > 0 && parsed.data.cheque) {
        const chequeDetails = parsed.data.cheque
        const [chequePayment] = await tx.select({ id: payments.id }).from(payments)
          .where(and(eq(payments.saleId, newSale.id), eq(payments.method, 'cheque'))).limit(1)
        if (chequePayment) {
          await tx.update(payments).set({ reference: sql`COALESCE(${payments.reference}, ${chequeDetails.chequeNo})` })
            .where(eq(payments.id, chequePayment.id))
        }
        await insertCheque(tx, {
          tenantId: session.user.tenantId,
          direction: 'received',
          details: chequeDetails,
          amount: chequeAmountFor(chequeDetails, chequeTender),
          userId,
          customerId: customerId || null,
          saleId: newSale.id,
          paymentId: chequePayment?.id || null,
          warehouseId,
          partyName: resolvedCustomerName || null,
        })
      }

      // Gift card redemption: atomically deduct from card within same transaction.
      // Split tender: only the gift-card split is drawn from the card; single tender: only what
      // the sale keeps (never the tendered amount beyond the total).
      const giftCardRedeemAmount = splits
        ? roundCurrency(splits.filter(sp => sp.method === 'gift_card').reduce((sum, sp) => sum + sp.amount, 0))
        : (paymentMethod === 'gift_card' ? roundCurrency(cashCardRecorded) : 0)
      if (giftCardRedeemAmount > 0 && !giftCardId) {
        throw new Error('GIFT_CARD_NOT_FOUND')
      }
      if (giftCardId && giftCardRedeemAmount > 0) {
        const [currentCard] = await tx
          .select()
          .from(giftCards)
          .where(and(eq(giftCards.id, giftCardId), eq(giftCards.tenantId, session.user.tenantId)))
          .for('update')

        if (!currentCard) {
          throw new Error('GIFT_CARD_NOT_FOUND')
        }
        if (currentCard.status !== 'active') {
          throw new Error('GIFT_CARD_NOT_ACTIVE')
        }
        if (currentCard.expiryDate) {
          const expiryDate = new Date(currentCard.expiryDate)
          const today = new Date()
          today.setHours(0, 0, 0, 0)
          if (expiryDate < today) {
            await tx.update(giftCards)
              .set({ status: 'expired' })
              .where(eq(giftCards.id, giftCardId))
            throw new Error('GIFT_CARD_EXPIRED')
          }
        }

        const cardBalance = parseCurrency(currentCard.currentBalance)
        if (cardBalance < giftCardRedeemAmount - 0.01) {
          throw new Error('GIFT_CARD_INSUFFICIENT_BALANCE')
        }

        const newBalance = roundCurrency(Math.max(0, cardBalance - giftCardRedeemAmount))
        const newStatus = newBalance < 0.01 ? 'used' as const : 'active' as const

        await tx.update(giftCards)
          .set({ currentBalance: String(newBalance), status: newStatus })
          .where(eq(giftCards.id, giftCardId))

        await tx.insert(giftCardTransactions).values({
          tenantId: session.user.tenantId,
          giftCardId,
          type: 'redemption',
          amount: String(giftCardRedeemAmount),
          balanceAfter: String(newBalance),
          saleId: newSale.id,
          createdBy: userId,
        })
      }

        // Handle customer credit transactions (RLS scopes inside transaction)
        if (customerId && (creditUsed > 0 || (overpayment > 0 && keepOverpayment))) {
          // Row lock: concurrent sales spending the same store credit serialise here and each one
          // re-checks the balance the other left (the pre-check above is only a snapshot).
          const [customer] = await tx
            .select()
            .from(customers)
            .where(eq(customers.id, customerId))
            .for('update')

        if (customer) {
          let newBalance = parseFloat(customer.balance)

          // Deduct credit if used
          if (creditUsed > 0) {
            if (compareCurrency(newBalance, creditUsed) < 0) {
              throw new Error('INSUFFICIENT_CREDIT')
            }
            newBalance = roundCurrency(newBalance - creditUsed)
            await tx.insert(customerCreditTransactions).values({
              tenantId: session.user.tenantId,
              customerId,
              type: 'use',
              amount: String(creditUsed),
              balanceAfter: String(newBalance),
              referenceType: 'sale',
              referenceId: newSale.id,
              notes: `Payment for ${invoiceNo}`,
              createdBy: userId,
            })
          }

          // Add overpayment as credit (only if customer requested)
          if (overpayment > 0 && keepOverpayment) {
            newBalance = roundCurrency(newBalance + overpayment)
            await tx.insert(customerCreditTransactions).values({
              tenantId: session.user.tenantId,
              customerId,
              type: 'overpayment',
              amount: String(overpayment),
              balanceAfter: String(newBalance),
              referenceType: 'sale',
              referenceId: newSale.id,
              notes: `Overpayment from ${invoiceNo}`,
              createdBy: userId,
            })
          }

          // Update customer balance if changed
          if (creditUsed > 0 || (overpayment > 0 && keepOverpayment)) {
            await tx.update(customers)
              .set({
                balance: String(newBalance),
                updatedAt: new Date(),
              })
              .where(eq(customers.id, customerId))
          }
        }
      }

        // AUTHORITATIVE STOCK CHECK through the stock ledger: sale lines are written first, then
        // applyStockChanges locks the warehouse_stock rows in a deterministic order, applies the
        // decrements and records signed movements. Reservations (held sales, draft work orders,
        // estimates) are re-checked against the locked before-value.
        const stockInputs: StockChangeInput[] = []
        const stockLineQty: number[] = []
        // D1: batch-tracked lines draw from item_batches after the stock rows are locked
        const batchLines: Array<{ saleItemId: string; cartItem: ExpandedCartItem }> = []
        // 0179: warranty runs from the sale's local date
        const saleDateLocal = localDateString(newSale.createdAt ?? new Date())
        for (const cartItem of expandedCartItems) {
          const lockedItem = tenantItems.find(i => i.id === cartItem.itemId)
          const lineWarranty = cartItem.quantity > 0 ? saleLineWarranty(lockedItem, saleDateLocal) : { warrantyMonths: null, warrantyUntil: null }

        // Calculate per-item tax: use client-provided per-item data or server-computed template data
        // (by line position: the same item may appear on several lines)
        const clientCartItem = cartItems[cartItem.sourceIndex]
        let itemTaxRate = clientCartItem?.taxRate ?? 0
        let itemTaxAmount = clientCartItem?.taxAmount ?? 0
        let itemTaxTemplateId = clientCartItem?.taxTemplateId ?? null
        let itemTaxBreakdown = clientCartItem?.taxBreakdown ?? null

        // If client didn't provide per-item tax, use server-computed template results
        if (!clientCartItem?.taxAmount && serverTaxResult) {
          const expandedIdx = expandedCartItems.indexOf(cartItem)
          const perItem = expandedIdx >= 0 ? serverTaxResult.perItemTax[expandedIdx] : null
          if (perItem) {
            itemTaxAmount = perItem.taxAmount
            itemTaxBreakdown = perItem.taxBreakdown || null
            // Server-resolved template and effective rate (not 0 / null as the client left them)
            if (!clientCartItem?.taxRate) itemTaxRate = perItem.taxRate
            if (!itemTaxTemplateId) itemTaxTemplateId = perItem.taxTemplateId ?? null
          }
        }

        // Create sale item
        const [saleItemRow] = await tx.insert(saleItems).values({
          tenantId: session.user.tenantId,
          saleId: newSale.id,
          itemId: cartItem.itemId,
          itemName: cartItem.name,
          quantity: String(cartItem.quantity),
          unitPrice: String(cartItem.unitPrice),
          listPrice: String(cartItem.listPrice),
          discount: String(cartItem.discount || 0),
          taxRate: String(itemTaxRate),
          taxAmount: String(itemTaxAmount),
          taxTemplateId: itemTaxTemplateId,
          taxBreakdown: itemTaxBreakdown,
          total: String(cartItem.total),
          serialNumberIds: cartItem.serialNumberIds?.length ? cartItem.serialNumberIds : null,
          // H5: price list, promotions and unit of this line
          priceListId: cartItem.priceListId,
          promotionId: cartItem.promotions[0]?.promotionId ?? null,
          promotionDiscount: String(cartItem.promotionDiscount),
          // line promotions + this line's share of the cart promotions (receipts / reports)
          promotions: (() => {
            const all: Array<{ promotionId: string; label: string; amount: number; cart?: boolean }> = [...cartItem.promotions]
            if (cartPromotionsUsed && cartItem.cartPromotionShare > 0) {
              all.push({ promotionId: pricing.cartPromotions[0].promotionId, label: pricing.cartPromotions.map((c) => c.label).join(' + '), amount: cartItem.cartPromotionShare, cart: true })
            }
            return all.length ? all : null
          })(),
          uom: cartItem.uom,
          uomFactor: String(cartItem.uomFactor),
          warrantyMonths: lineWarranty.warrantyMonths,
          warrantyUntil: lineWarranty.warrantyUntil,
        }).returning({ id: saleItems.id })

          if (lockedItem?.trackBatches && cartItem.quantity > 0) {
            batchLines.push({ saleItemId: saleItemRow.id, cartItem })
          }

          if (lockedItem?.trackStock) {
            // Serial number tracking
            if (lockedItem.trackSerialNumbers && cartItem.serialNumberIds?.length) {
              // Validate serial count matches quantity
              if (cartItem.serialNumberIds.length !== cartItem.quantity) {
                throw new Error(`SERIAL_MISMATCH:${cartItem.name} requires ${cartItem.quantity} serial number(s), but ${cartItem.serialNumberIds.length} provided`)
              }
              // Validate availability + allocate as 'sold'
              await validateSerialAvailability(tx, cartItem.serialNumberIds, cartItem.itemId, warehouseId)
              await allocateSerials(tx, {
                tenantId: session.user.tenantId,
                serialNumberIds: cartItem.serialNumberIds,
                newStatus: 'sold',
                referenceType: 'sale',
                referenceId: newSale.id,
                changedBy: userId,
              })
              await applySerialWarranty(tx, cartItem.serialNumberIds, saleDateLocal, lineWarranty.warrantyUntil)
            }

            stockInputs.push({
              tenantId: session.user.tenantId,
              warehouseId,
              itemId: cartItem.itemId,
              mode: 'delta',
              qty: -cartItem.baseQuantity,
              type: 'out',
              referenceType: 'sale',
              referenceId: newSale.id,
              userId,
              source: 'pos',
              costCenterId: costCenterId || null,
              idempotencyKey: `sale:${newSale.id}:${saleItemRow.id}`,
              // W6: goods already left the shop during the outage; record the shortfall instead.
              // H8: a counter that allows negative stock sells beyond the recorded stock too.
              allowNegative: allowNegativeStock,
            })
            stockLineQty.push(cartItem.baseQuantity)
          }
        }


        // Auto-create gift cards for gift card items sold
        const generatedGiftCards: { cardNumber: string; balance: number }[] = []
        {
          for (const cartItem of expandedCartItems) {
            const item = tenantItems.find(i => i.id === cartItem.itemId)
            if (item?.isGiftCard && cartItem.quantity > 0) {
              for (let gc = 0; gc < cartItem.quantity; gc++) {
                const ts = Date.now().toString(36)
                const rand = crypto.randomBytes(5).toString('hex').toUpperCase()
                const cardNumber = `GC-${ts}-${rand}`
                await tx.insert(giftCards).values({
                  tenantId: session.user.tenantId,
                  cardNumber,
                  initialBalance: String(roundCurrency(cartItem.unitPrice)),
                  currentBalance: String(roundCurrency(cartItem.unitPrice)),
                  status: 'active',
                  issuedTo: customerId || null,
                  createdBy: userId,
                  purchaseSaleId: newSale.id,
                })
                generatedGiftCards.push({
                  cardNumber,
                  balance: roundCurrency(cartItem.unitPrice),
                })
              }
            }
          }
        }

        // === LOYALTY PROGRAM INTEGRATION ===
        if (customerId) {
          // Fetch active loyalty program
          const activeLoyalty = await tx.query.loyaltyPrograms.findFirst({
            where: eq(loyaltyPrograms.status, 'active'),
          })

          if (activeLoyalty) {
            // Fetch tiers for this program
            const tiers = await tx
              .select()
              .from(loyaltyTiers)
              .where(and(
                eq(loyaltyTiers.tenantId, session.user.tenantId),
                eq(loyaltyTiers.isActive, true)
              ))

            // Get current customer data
            const [currentCustomer] = await tx
              .select()
              .from(customers)
              .where(eq(customers.id, customerId))
              .for('update')

            if (currentCustomer) {
              let currentPoints = currentCustomer.loyaltyPoints || 0
              let currentTier = currentCustomer.loyaltyTier || 'bronze'

              // 1. Process redemption FIRST (before earning to prevent inflation)
              if (loyaltyPointsRedeemed && loyaltyPointsRedeemed > 0) {
                // The points' value was taken off the total: the customer must really have them
                // (offline sales are done deals — redeem what is left)
                if (loyaltyPointsRedeemed > currentPoints && !isOfflineSale) {
                  throw new Error('INSUFFICIENT_LOYALTY_POINTS')
                }
                const pointsToRedeem = Math.min(loyaltyPointsRedeemed, currentPoints)
                if (pointsToRedeem > 0) {
                  currentPoints -= pointsToRedeem
                  await tx.insert(loyaltyTransactions).values({
                    tenantId: session.user.tenantId,
                    customerId,
                    type: 'redeem',
                    points: -pointsToRedeem,
                    balanceAfter: currentPoints,
                    saleId: newSale.id,
                    notes: `Redeemed ${pointsToRedeem} points for ${invoiceNo}`,
                  })
                }
              }

              // 2. Calculate and add earned points
              // Fix #13: Default to 0 if collectionFactor/earnRate are null/undefined to prevent NaN
              const collectionFactor = parseFloat(activeLoyalty.collectionFactor) || 0
              const customerTier = tiers.find(t => t.tier === currentTier)
              const earnRate = customerTier ? (parseFloat(customerTier.earnRate) || 1) : 1
              const saleAmount = Math.abs(finalTotal)
              const earnedPoints = Math.floor(saleAmount * collectionFactor * earnRate)

              if (earnedPoints > 0) {
                currentPoints += earnedPoints
                await tx.insert(loyaltyTransactions).values({
                  tenantId: session.user.tenantId,
                  customerId,
                  type: 'earn',
                  points: earnedPoints,
                  balanceAfter: currentPoints,
                  saleId: newSale.id,
                  notes: `Earned ${earnedPoints} points from ${invoiceNo}`,
                })
              }

              // 3. Check for tier upgrade
              const sortedTiers = [...tiers].sort((a, b) => b.minPoints - a.minPoints)
              for (const tier of sortedTiers) {
                if (currentPoints >= tier.minPoints) {
                  currentTier = tier.tier
                  break
                }
              }

              // 4. Update customer loyalty data
              if (earnedPoints > 0 || (loyaltyPointsRedeemed && loyaltyPointsRedeemed > 0)) {
                await tx.update(customers)
                  .set({
                    loyaltyPoints: currentPoints,
                    loyaltyTier: currentTier as 'bronze' | 'silver' | 'gold' | 'platinum',
                    updatedAt: new Date(),
                  })
                  .where(eq(customers.id, customerId))
              }
            }
          }
        }

        // Stock and batch locks are taken as late as possible (just before the invoice number):
        // the warehouse_stock rows of popular items stay locked only from here to commit, so
        // concurrent cashiers selling the same item wait for the shortest possible time.
        const stockResults = stockInputs.length > 0 ? await applyStockChanges(tx, stockInputs) : []
        const shortfalls: NonNullable<SaleFlags['stockShortfall']> = []
        stockResults.forEach((r, i) => {
          const reserved = reservedMap.get(stockInputs[i].itemId) || 0
          const availableStock = Math.round((r.before - reserved) * 1000) / 1000
          if (stockLineQty[i] > 0 && availableStock < stockLineQty[i]) {
            if (!allowNegativeStock) {
              throw new Error(`INSUFFICIENT_STOCK:${r.itemName} (need: ${stockLineQty[i]}, have: ${availableStock})`)
            }
            shortfalls.push({ itemId: stockInputs[i].itemId, name: r.itemName, quantity: stockLineQty[i], available: availableStock })
          }
        })
        saleStockChanges = stockResults.map((result, i) => ({ result, input: stockInputs[i] }))
        if (shortfalls.length > 0) {
          saleFlags.stockShortfall = shortfalls
          if (!isOfflineSale) saleFlags.negativeStockAllowed = true
        }

        // D1: batch allocation (cashier's batch / scanned batch number first, else FEFO).
        // Online: missing batch quantity rejects the sale. Offline: allocate what exists and
        // record the shortfall (the goods already left the shop).
        if (batchLines.length > 0) {
          const salesSettings = await getTenantSalesSettings(tx, session.user.tenantId)
          const batchShortfalls: NonNullable<SaleFlags['batchShortfall']> = []
          for (const b of batchLines) {
            const r = await allocateSaleLineBatches(tx, {
              tenantId: session.user.tenantId,
              warehouseId,
              itemId: b.cartItem.itemId,
              qty: b.cartItem.baseQuantity,
              saleItemId: b.saleItemId,
              preferredBatchId: b.cartItem.batchId,
              preferredBatchNumber: b.cartItem.batchNumber,
              allowExpired: salesSettings.batches.allowExpiredSale,
              allowShortfall: allowNegativeStock,
              itemName: b.cartItem.name,
            })
            if (r.shortfall > 0) {
              batchShortfalls.push({ itemId: b.cartItem.itemId, name: b.cartItem.name, quantity: b.cartItem.baseQuantity, allocated: r.allocated })
            }
          }
          if (batchShortfalls.length > 0) saleFlags.batchShortfall = batchShortfalls
        }

        if (shortfalls.length > 0 || saleFlags.batchShortfall?.length) {
          await tx.update(sales).set({ flags: saleFlags }).where(eq(sales.id, newSale.id))
          newSale.flags = saleFlags
        }

        // Allocate the real invoice number now (see pendingInvoiceNo above) and apply it
        invoiceNo = await nextDocumentNumber(tx, session.user.tenantId, 'invoice')
        await tx.update(sales).set({ invoiceNo }).where(eq(sales.id, newSale.id))
        await tx.execute(sql`UPDATE customer_credit_transactions SET notes = replace(notes, ${pendingInvoiceNo}, ${invoiceNo})
          WHERE reference_type = 'sale' AND reference_id = ${newSale.id} AND notes LIKE ${'%' + pendingInvoiceNo + '%'}`)
        await tx.execute(sql`UPDATE loyalty_transactions SET notes = replace(notes, ${pendingInvoiceNo}, ${invoiceNo})
          WHERE sale_id = ${newSale.id} AND notes LIKE ${'%' + pendingInvoiceNo + '%'}`)
        newSale.invoiceNo = invoiceNo

        // Auto-post to General Ledger
        {
          // Separate gift card items from regular items for GL posting
          const giftCardItemTotal = roundCurrency(expandedCartItems.reduce((sum, ci) => {
            const item = tenantItems.find(i => i.id === ci.itemId)
            return item?.isGiftCard ? sum + ci.total : sum
          }, 0))
          const regularTotal = roundCurrency(finalTotal - giftCardItemTotal)

          // Calculate COGS for regular (non-gift-card) items (also needed for returns to reverse COGS)
          const totalCOGS = roundCurrency(expandedCartItems.reduce((sum, ci) => {
            const item = tenantItems.find(i => i.id === ci.itemId)
            if (item?.isGiftCard) return sum
            return sum + roundCurrency(ci.costPrice * Math.abs(ci.quantity))
          }, 0))

          // E1: settlement per payment method, mirroring the payment rows of this sale. 'credit'
          // rows are not money received: customer store credit is posted via creditAmount (Dr
          // customer advance) and an on-account split leaves the receivable open.
          const settlement = recordedPayments
            .filter(p => p.method !== 'credit' && p.amount > 0)
            .map(p => ({ ...p }))
          // Gift card items (liability, not revenue) are paid first from the settlement, in order
          const giftCardSettlement: Array<{ method: string; amount: number }> = []
          {
            let left = giftCardItemTotal
            for (const p of settlement) {
              if (left <= 0) break
              const take = roundCurrency(Math.min(left, p.amount))
              if (take <= 0) continue
              p.amount = roundCurrency(p.amount - take)
              left = roundCurrency(left - take)
              giftCardSettlement.push({ method: p.method, amount: take })
            }
            if (left > 0) giftCardSettlement.push({ method: paymentMethod || 'cash', amount: left })
          }
          const regularSettlement = settlement.filter(p => p.amount > 0)

          // Post regular items as normal sale
          if (regularTotal > 0) {
            await postSaleToGL(tx, session.user.tenantId, {
              saleId: newSale.id,
              invoiceNumber: newSale.invoiceNo,
              saleDate: new Date().toISOString().split('T')[0],
              subtotal: roundCurrency(finalSubtotal - giftCardItemTotal),
              tax: finalTax,
              discount: finalDiscount,
              total: regularTotal,
              amountPaid: roundCurrency(regularSettlement.reduce((sum, p) => sum + p.amount, 0)),
              creditAmount: creditUsed,
              costOfGoodsSold: totalCOGS,
              paymentMethod: paymentMethod || 'cash',
              paymentSplits: regularSettlement,
              customerId: customerId || null,
              isReturn: false,
              costCenterId: costCenterId || null,
              taxBreakdown: (bodyTaxBreakdown || serverTaxResult?.taxBreakdown) as TaxBreakdownItem[] | undefined,
            })
          }

          // Post gift card items as liability (not revenue), one posting per paying method
          for (const g of giftCardSettlement) {
            await postGiftCardSaleToGL(tx, session.user.tenantId, {
              saleId: newSale.id,
              invoiceNumber: newSale.invoiceNo,
              saleDate: new Date().toISOString().split('T')[0],
              amount: g.amount,
              paymentMethod: g.method,
              customerId: customerId || null,
              costCenterId: costCenterId || null,
            })
          }
        }

        return { ...newSale, generatedGiftCards }
      })

      notifyStockDecreased(saleStockChanges)

      // Broadcast the change to connected clients
      logAndBroadcast(session.user.tenantId, 'sale', 'created', result.id, {
        userId,
        entityName: result.invoiceNo,
        description: generateActivityDescription('create', 'sale', result.invoiceNo),
        metadata: {
          posOpeningEntryId: saleShiftId,
          posProfileId: shiftCheck.shift?.posProfileId || governingProfile?.id || null,
          total: finalTotal,
          discount: finalDiscount,
          discountPercent: controls.discountPercent,
          approvedBy,
          approvals: neededScopes,
          priceOverrides: expandedCartItems
            .filter((ci) => compareCurrency(ci.unitPrice, ci.resolvedPrice) !== 0)
            .map((ci) => ({ itemId: ci.itemId, name: ci.name, before: ci.resolvedPrice, after: ci.unitPrice })),
          credit: creditCheck,
          offline: isOfflineSale || undefined,
          flags: Object.keys(saleFlags).length > 0 ? saleFlags : undefined,
        },
      })
      // WS-3: Broadcast specific item stock updates (not 'all')
      const affectedItemIds = [...new Set(expandedCartItems.map(i => i.itemId))]

      // Low / out-of-stock alerts: stock-alerts listener via notifyStockDecreased (W5)
      for (const itemId of affectedItemIds) {
        logAndBroadcast(session.user.tenantId, 'item', 'updated', itemId)
      }
      // WS-2: Broadcast warehouse-stock updates
      if (warehouseId) {
        logAndBroadcast(session.user.tenantId, 'warehouse-stock', 'updated', warehouseId)
      }
      // Broadcast gift card update (payment with gift card)
      if (giftCardId && paymentMethod === 'gift_card') {
        logAndBroadcast(session.user.tenantId, 'gift-card', 'updated', giftCardId)
      }
      // Broadcast gift card creation (gift card items sold)
      if (result.generatedGiftCards?.length) {
        logAndBroadcast(session.user.tenantId, 'gift-card', 'created', result.id)
      }

      // Update work order to invoiced status if linked
      if (workOrderId) {
        try {
          await withTenant(session.user.tenantId, async (db2) => {
            await db2.update(workOrders).set({
              saleId: result.id,
              status: 'invoiced',
              updatedAt: new Date(),
            }).where(eq(workOrders.id, workOrderId))
            logAndBroadcast(session.user.tenantId, 'work-order', 'updated', workOrderId, { userId })
          })
        } catch (woError) {
          console.error('[Sales] Failed to update work order to invoiced:', woError)
        }
      }

      // AI: Anomaly detection (fire-and-forget)
      {
        checkSaleAnomalies(session.user.tenantId, {
          id: result.id,
          invoiceNo: result.invoiceNo,
          subtotal: finalSubtotal,
          discountAmount: finalDiscount,
          taxAmount: finalTax,
          totalAmount: finalTotal,
          createdByName: session.user.name || undefined,
          items: expandedCartItems.map(i => ({
            itemName: i.name,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            costPrice: i.costPrice,
            discountPercent: (i.unitPrice * i.quantity) > 0 ? (i.discount / (i.unitPrice * i.quantity)) * 100 : 0,
          })),
        })

        // Integrity audit (fire-and-forget)
        auditSaleIntegrity(result.id, session.user.tenantId)

        // AI: Calculation audit (fire-and-forget)
        auditSaleCalculation({
          id: result.id,
          invoiceNo: result.invoiceNo,
          tenantId: session.user.tenantId,
          subtotal: finalSubtotal,
          discountAmount: finalDiscount,
          taxAmount: finalTax,
          totalAmount: finalTotal,
          items: expandedCartItems.map(i => ({
            itemName: i.name,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            discount: i.discount,
            total: i.total,
          })),
        })

        // AI: Duplicate transaction detection (fire-and-forget)
        checkDuplicateTransaction(session.user.tenantId, {
          id: result.id,
          invoiceNo: result.invoiceNo,
          customerId: customerId || null,
          totalAmount: finalTotal,
          createdAt: new Date(),
        })
      }

      if (isOfflineSale && (saleFlags.priceDifferences?.length || saleFlags.taxDifference || saleFlags.stockShortfall?.length || saleFlags.batchShortfall?.length || saleFlags.approvalMissing || saleFlags.shiftIssue || saleFlags.branchIssue)) {
        offlineNotice = { saleId: result.id, invoiceNo: result.invoiceNo }
      }

      return NextResponse.json(result)
    })

    // W6: tell managers about offline sales that differ from the catalog (after commit)
    if (offlineNotice) {
      const notice = offlineNotice as { saleId: string; invoiceNo: string }
      const parts: string[] = []
      for (const d of (saleFlags.priceDifferences || []).slice(0, 3)) {
        parts.push(`${d.name || 'Item'} sold ${d.sold.toFixed(2)} (catalog ${d.catalog.toFixed(2)})`)
      }
      if ((saleFlags.priceDifferences?.length || 0) > 3) parts.push(`+${saleFlags.priceDifferences!.length - 3} more`)
      if (saleFlags.taxDifference) parts.push(`tax differs by ${saleFlags.taxDifference.difference.toFixed(2)}`)
      if (saleFlags.stockShortfall?.length) parts.push(`${saleFlags.stockShortfall.length} item(s) sold beyond recorded stock`)
      if (saleFlags.batchShortfall?.length) parts.push(`${saleFlags.batchShortfall.length} item(s) sold beyond recorded batch quantity`)
      const missing = saleFlags.approvalMissing as { scopes?: string[] } | undefined
      if (missing?.scopes?.length) parts.push(`no supervisor approval for ${missing.scopes.join(', ')}`)
      const shiftIssue = saleFlags.shiftIssue as { code?: string } | undefined
      if (shiftIssue?.code) parts.push(`shift problem: ${shiftIssue.code}`)
      if (saleFlags.branchIssue) parts.push('sold from a branch the cashier is not assigned to')
      void notify(session.user.tenantId, 'offline_price_difference', {
        title: `Offline sale ${offlineRef} (${notice.invoiceNo}) needs review`,
        body: parts.join(' · ') || 'Offline sale differs from the current catalog',
        data: { screen: 'sales', saleId: notice.saleId, invoiceNo: notice.invoiceNo, offlineRef },
        dedupeKey: `offline_price_difference:${notice.saleId}`,
        permission: 'manageSales',
      })
    }
    return response
  } catch (error) {
    // Racing retries of the same clientSaleId: the unique index (tenant_id, client_sale_id)
    // rejected the loser → return the sale the winner created instead of a 500.
    const pgCode = (error as { code?: string; cause?: { code?: string; constraint?: string } })?.cause?.code
      || (error as { code?: string })?.code
    const constraint = (error as { cause?: { constraint?: string }; constraint?: string })?.cause?.constraint
      || (error as { constraint?: string })?.constraint || ''
    if (pgCode === '23505' && idemTenantId && idemOfflineRef && constraint.includes('offline_ref')) {
      try {
        const tenantId = idemTenantId
        const ref = idemOfflineRef
        const existing = await withTenant(tenantId, async (db) =>
          db.query.sales.findFirst({
            where: and(eq(sales.tenantId, tenantId), eq(sales.offlineRef, ref)),
            with: { customer: true, user: SAFE_USER, items: { with: { item: true } } },
          })
        )
        if (existing && idemClientSaleId && existing.clientSaleId && existing.clientSaleId !== idemClientSaleId) {
          return NextResponse.json({ error: `Offline receipt number ${ref} is already used by another sale`, code: 'OFFLINE_REF_CONFLICT' }, { status: 409 })
        }
        if (existing) return NextResponse.json(existing, { status: 200 })
      } catch (lookupError) {
        logError('api/sales', lookupError, { method: 'POST', path: '/api/sales', stage: 'offline-ref-recovery' })
      }
    }
    if (pgCode === '23505' && idemClientSaleId && idemTenantId && constraint.includes('client_sale')) {
      try {
        const tenantId = idemTenantId
        const key = idemClientSaleId
        const existing = await withTenant(tenantId, async (db) =>
          db.query.sales.findFirst({
            where: and(eq(sales.tenantId, tenantId), eq(sales.clientSaleId, key)),
            with: { customer: true, user: SAFE_USER, items: { with: { item: true } } },
          })
        )
        if (existing) return NextResponse.json(existing, { status: 200 })
      } catch (lookupError) {
        logError('api/sales', lookupError, { method: 'POST', path: '/api/sales', stage: 'idempotent-recovery' })
      }
    }

    if (error instanceof ApprovalError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 403 })
    }
    if (error instanceof ChequeError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    if (error instanceof PromotionExhaustedError) {
      return NextResponse.json({
        error: 'A promotion in this cart has just reached its usage limit. Review the cart and try again.',
        code: 'PROMOTION_EXHAUSTED', promotionId: error.promotionId,
      }, { status: 409 })
    }
    logError('api/sales', error, { method: 'POST', path: '/api/sales' })
    const message = error instanceof Error ? error.message : ''

    if (message === 'USER_NOT_FOUND') {
      return NextResponse.json({ error: 'User not found for this tenant. Please log out and log in again.' }, { status: 400 })
    }

    // Handle insufficient stock error from inside transaction
    if (message.startsWith('INSUFFICIENT_STOCK:')) {
      return NextResponse.json({
        error: `Insufficient stock: ${message.replace('INSUFFICIENT_STOCK:', '')}`,
      }, { status: 400 })
    }

    if (message.startsWith('SERIAL_MISMATCH:')) {
      return NextResponse.json({ error: message.replace('SERIAL_MISMATCH:', '') }, { status: 400 })
    }

    const batchError = batchErrorInfo(error)
    if (batchError) {
      return NextResponse.json({ error: batchError.message, code: batchError.code }, { status: 400 })
    }

    // Gift card errors
    if (message === 'GIFT_CARD_NOT_FOUND') {
      return NextResponse.json({ error: 'Gift card not found' }, { status: 400 })
    }
    if (message === 'GIFT_CARD_NOT_ACTIVE') {
      return NextResponse.json({ error: 'Gift card is not active' }, { status: 400 })
    }
    if (message === 'GIFT_CARD_EXPIRED') {
      return NextResponse.json({ error: 'Gift card has expired' }, { status: 400 })
    }
    if (message === 'GIFT_CARD_INSUFFICIENT_BALANCE') {
      return NextResponse.json({ error: 'Insufficient gift card balance' }, { status: 400 })
    }
    if (message === 'INSUFFICIENT_CREDIT') {
      return NextResponse.json({ error: 'Insufficient customer credit balance' }, { status: 400 })
    }
    if (message === 'QUOTATION_NOT_FOUND') {
      return NextResponse.json({ error: 'The quotation this cart came from was not found', code: 'QUOTATION_NOT_FOUND' }, { status: 400 })
    }
    if (message === 'QUOTATION_ALREADY_CONVERTED') {
      return NextResponse.json({ error: 'This quotation has already been converted to another sale', code: 'QUOTATION_ALREADY_CONVERTED' }, { status: 409 })
    }
    if (message === 'QUOTATION_NOT_CONVERTIBLE') {
      return NextResponse.json({ error: 'A cancelled or rejected quotation cannot be converted', code: 'QUOTATION_NOT_CONVERTIBLE' }, { status: 400 })
    }
    if (message === 'INSUFFICIENT_LOYALTY_POINTS') {
      return NextResponse.json({ error: 'Customer does not have enough loyalty points', code: 'INSUFFICIENT_LOYALTY_POINTS' }, { status: 400 })
    }

    const apiError = toApiError(error)
    if (apiError) return apiError

    return NextResponse.json({ error: 'Failed to create sale' }, { status: 500 })
  }
}

type CreateSaleBody = z.infer<typeof createSaleSchema>

/**
 * POST /api/sales with isReturn=true. Contract (W8):
 *  - cartItems carry `originalSaleItemId` (legacy: itemId match) and the quantity to return
 *    (sign ignored); unitPrice / subtotal / tax / total from the client are ignored — the
 *    server prices the return from the original sale (or the catalogue for manual returns).
 *  - refundAmount is optional; when sent it must be <= the computed value (else 400).
 *  - manual returns (no returnAgainst) need returnReason.
 *  Response: the return sale row + { refundAmount (paid out), refundTotal, returnStatus, lines }.
 */
async function handleReturnPost(session: CompanySession, userId: string, body: CreateSaleBody) {
  const tenantId = session.user.tenantId
  const acctError = await requireAccountingConfig(rawDb, tenantId, 'sale')
  if (acctError) return acctError

  try {
    return await withTenant(tenantId, async (db) => {
      if (body.clientSaleId) {
        const existing = await db.query.sales.findFirst({
          where: and(eq(sales.tenantId, tenantId), eq(sales.clientSaleId, body.clientSaleId)),
          with: { customer: true, user: SAFE_USER, items: { with: { item: true } } },
        })
        if (existing) return NextResponse.json(existing, { status: 200 })
      }

      if (body.warehouseId) {
        const warehouse = await db.query.warehouses.findFirst({
          where: and(eq(warehouses.id, body.warehouseId), eq(warehouses.isActive, true)),
        })
        if (!warehouse) {
          return NextResponse.json({ error: 'Selected warehouse not found or inactive' }, { status: 400 })
        }
      }
      let warehouseId = body.warehouseId || null

      // K4: a branch-restricted user returns only into their own branches, and only sales of them
      const branchScope = await getBranchScope(session, db)
      if (branchScope) {
        let originalBranch: string | null = null
        if (body.returnAgainst) {
          const original = await db.query.sales.findFirst({ where: eq(sales.id, body.returnAgainst), columns: { warehouseId: true } })
          originalBranch = original?.warehouseId || null
        }
        if (!warehouseId && !body.returnAgainst) warehouseId = branchScope[0]
        if ((warehouseId && !canAccessBranch(branchScope, warehouseId)) || (originalBranch && !canAccessBranch(branchScope, originalBranch))) {
          return NextResponse.json({ error: await branchDeniedMessage(branchScope, db), code: 'BRANCH_ACCESS_DENIED' }, { status: 403 })
        }
      }
      if (!warehouseId && !body.returnAgainst) {
        const fallback = await db.query.warehouses.findFirst({
          where: and(eq(warehouses.isDefault, true), eq(warehouses.isActive, true)),
        }) || await db.query.warehouses.findFirst({ where: eq(warehouses.isActive, true) })
        warehouseId = fallback?.id || null
      }

      // H1: a refund paid from a drawer must be on an open shift of the cashier (offline: flagged by the queue)
      const shiftCheck = await checkSaleShift(db, {
        posOpeningEntryId: body.posOpeningEntryId,
        userIds: [...new Set([userId, session.user.id])],
        canUseAnyShift: hasPermission(session.user.role, 'manageSales', tenantId, session.user.customRoleId),
      })
      if (shiftCheck.issue && !body.offlineRef) {
        return NextResponse.json({ error: SHIFT_ISSUE_MESSAGES[shiftCheck.issue], code: shiftCheck.issue }, { status: shiftCheck.issue === 'SHIFT_NOT_YOURS' ? 403 : 400 })
      }

      let costCenterId = body.costCenterId || null
      if (!costCenterId && shiftCheck.profile) {
        costCenterId = shiftCheck.profile.costCenterId || null
      }

      const result = await db.transaction(async (tx) => createReturnInTx(tx, { tenantId, userId }, {
        // D1: tenant return settings (serial status, stock vs quarantine)
        ...(await getTenantSalesSettings(tx, tenantId)).returns,
        originalSaleId: body.returnAgainst || null,
        lines: body.cartItems.map((c) => ({
          originalSaleItemId: c.originalSaleItemId || null,
          itemId: c.itemId || null,
          name: c.name,
          quantity: c.quantity,
          serialNumberIds: c.serialNumberIds,
        })),
        refundMethod: body.refundMethod || 'cash',
        clientRefundAmount: body.refundAmount ?? null,
        customerId: body.customerId || null,
        warehouseId,
        posOpeningEntryId: shiftCheck.issue === 'SHIFT_NOT_FOUND' ? null : body.posOpeningEntryId || null,
        costCenterId,
        clientSaleId: body.clientSaleId || null,
        offlineRef: body.offlineRef || null,
        reason: body.returnReason || null,
        notes: body.returnNotes || null,
      }))

      const ret = result.returnSale
      logAndBroadcast(tenantId, 'sale', 'created', ret.id, {
        userId,
        entityName: ret.invoiceNo,
        description: `Processed return ${ret.invoiceNo}${result.originalSale ? ` against ${result.originalSale.invoiceNo}` : ' (no receipt)'}`,
        metadata: {
          posOpeningEntryId: shiftCheck.shift?.id || null,
          posProfileId: shiftCheck.shift?.posProfileId || null,
          originalSaleId: result.originalSale?.id || null,
          refundTotal: result.refundTotal,
          refundPaidOut: result.refundPaidOut,
          refundMethod: result.refundMethod,
          reason: body.returnReason || null,
          lines: result.lines,
          before: result.originalSale ? { status: result.originalSale.status } : undefined,
          after: { returnStatus: result.returnStatus },
        },
      })
      if (result.originalSale) logAndBroadcast(tenantId, 'sale', 'updated', result.originalSale.id)
      for (const itemId of result.affectedItemIds) logAndBroadcast(tenantId, 'item', 'updated', itemId)
      logAndBroadcast(tenantId, 'warehouse-stock', 'updated', result.stockWarehouseId)
      notifyReturnAlerts(tenantId, {
        returnId: ret.id, returnNo: ret.invoiceNo, originalInvoiceNo: result.originalSale?.invoiceNo,
        manual: !result.originalSale, refundTotal: result.refundTotal, actorUserId: userId, actorName: session.user.name,
      })

      if (result.refundPaidOut > 0 && result.originalSale) {
        checkRefundAnomalies(tenantId, {
          id: ret.id,
          saleId: ret.id,
          invoiceNo: ret.invoiceNo,
          refundAmount: result.refundPaidOut,
          refundMethod: result.refundMethod,
          originalSaleTotal: Math.abs(parseCurrency(result.originalSale.total)),
          originalSaleDate: result.originalSale.createdAt.toISOString(),
          originalPaymentMethod: result.originalSale.paymentMethod || undefined,
          cashierName: session.user.name || undefined,
        })
      }

      return NextResponse.json({
        ...ret,
        refundAmount: result.refundPaidOut,
        refundTotal: result.refundTotal,
        refundTax: result.refundTax,
        returnStatus: result.returnStatus,
        originalInvoiceNo: result.originalSale?.invoiceNo || null,
        lines: result.lines,
        generatedGiftCards: [],
      })
    })
  } catch (error) {
    const pgCode = (error as { cause?: { code?: string } })?.cause?.code || (error as { code?: string })?.code
    const constraint = (error as { cause?: { constraint?: string } })?.cause?.constraint || (error as { constraint?: string })?.constraint || ''
    if (pgCode === '23505' && body.clientSaleId && constraint.includes('client_sale')) {
      const existing = await withTenant(tenantId, (db) => db.query.sales.findFirst({
        where: and(eq(sales.tenantId, tenantId), eq(sales.clientSaleId, body.clientSaleId!)),
        with: { customer: true, user: SAFE_USER, items: { with: { item: true } } },
      }))
      if (existing) return NextResponse.json(existing, { status: 200 })
    }
    const mapped = saleFlowErrorResponse(error)
    if (mapped) return mapped
    logError('api/sales', error, { method: 'POST', path: '/api/sales', stage: 'return' })
    return NextResponse.json({ error: 'Failed to process return' }, { status: 500 })
  }
}
