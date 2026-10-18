import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { db as rawDb, withTenant } from '@/lib/db'
import { sales, saleItems, items, stockMovements, payments, customers, customerCreditTransactions, workOrders, workOrderParts, insuranceEstimates, insuranceEstimateItems, vehicles, warehouseStock, warehouses, loyaltyPrograms, loyaltyTiers, loyaltyTransactions, refunds, heldSales, salesOrders, posProfiles, posOpeningEntries, giftCards, giftCardTransactions } from '@/lib/db/schema'
import { eq, and, desc, sql, or, ilike, inArray } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { generateActivityDescription } from '@/lib/utils/activity-log'
import { requirePermission } from '@/lib/auth/roles'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { roundCurrency, compareCurrency, currencyEquals, parseCurrency } from '@/lib/utils/currency'
import { postSaleToGL, postGiftCardSaleToGL } from '@/lib/accounting/auto-post'
import { requireAccountingConfig } from '@/lib/accounting/validate-config'
import { checkSaleAnomalies, checkRefundAnomalies, checkDuplicateTransaction } from '@/lib/ai/anomaly-detector'
import { auditSaleCalculation } from '@/lib/ai/calculation-auditor'
import { auditSaleIntegrity } from '@/lib/audit/realtime-hooks'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateSerialAvailability, allocateSerials } from '@/lib/inventory/serial-numbers'
import { recalculateDocumentTax } from '@/lib/utils/tax-recalculate'
import { type TaxBreakdownItem } from '@/lib/utils/tax-template'
import { validateBody, validateSearchParams } from '@/lib/validation'
import { salesListSchema, createSaleSchema } from '@/lib/validation/schemas/sales'

// GET all sales for the tenant (with pagination)
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, salesListSchema)
    if (!parsed.success) return parsed.response

    const { search, status, customerId, page, pageSize, all } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Build where conditions (tenantId filter handled by RLS)
      const conditions = []

      // Filter by customer
      if (customerId) {
        conditions.push(eq(sales.customerId, customerId))
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
      const limit = all ? 1000 : Math.min(pageSize, 100) // Max 100 per page
      const offset = all ? undefined : (page - 1) * pageSize

      const result = await db.query.sales.findMany({
        where: whereClause,
        with: {
          customer: true,
          user: true,
          items: {
            with: {
              item: true,
            },
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
            user: true,
            items: {
              with: {
                item: true,
              },
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

            // RC-1: Use proper currency comparison instead of hardcoded epsilon
            // Full return if returned amount >= original total (within currency precision)
            if (compareCurrency(totalReturned, originalTotal) >= 0) {
              returnStatus = 'full'
            } else if (totalReturned > 0) {
              returnStatus = 'partial'
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

    const { customerId, vehicleId, customerName, vehiclePlate, vehicleDescription, cartItems, paymentMethod, paymentSplits, subtotal, discount, discountType, discountReason, tax, taxRate: _bodyTaxRate, taxInclusive: _bodyTaxInclusive, taxBreakdown: bodyTaxBreakdown, total, amountPaid, creditAmount, addOverpaymentToCredit, isReturn, returnAgainst, refundAmount, refundMethod, warehouseId: providedWarehouseId, posOpeningEntryId, loyaltyPointsRedeemed, costCenterId: providedCostCenterId, workOrderId, restaurantOrderId, tipAmount: _tipAmount, giftCardId } = parsed.data

    // Check permission: createSales for regular sales, processReturns for returns
    if (isReturn) {
      const permError = requirePermission(session, 'processReturns')
      if (permError) return permError
    } else {
      const permError = requirePermission(session, 'createSales')
      if (permError) return permError
    }
    // Note: gift_card is NOT in refundMethod enum (Zod blocks it at validation)

    // Early client-side discount sanity check (skip for returns)
    // Server-side validation with calculated subtotal happens after cart expansion (line ~492)
    if (!isReturn && discount && discount < 0) {
      return NextResponse.json({ error: 'Discount cannot be negative' }, { status: 400 })
    }

    // Pre-validate accounting config before starting transaction
    const acctError = await requireAccountingConfig(rawDb, session.user.tenantId, 'sale')
    if (acctError) return acctError

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Get warehouse ID - use provided or default warehouse (RLS scopes the query)
      let warehouseId = providedWarehouseId

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
      }

      if (!warehouseId) {
        const defaultWarehouse = await db.query.warehouses.findFirst({
          where: and(
            eq(warehouses.isDefault, true),
            eq(warehouses.isActive, true)
          ),
        })
        if (defaultWarehouse) {
          warehouseId = defaultWarehouse.id
        } else {
          // Fallback: get any active warehouse
          const anyWarehouse = await db.query.warehouses.findFirst({
            where: eq(warehouses.isActive, true),
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

      // For returns, validate the original sale exists and can be returned (RLS scopes)
      if (isReturn && returnAgainst) {
        const originalSale = await db.query.sales.findFirst({
          where: eq(sales.id, returnAgainst),
          with: {
            items: true,
          },
        })
        if (!originalSale) {
          return NextResponse.json({ error: 'Original sale not found' }, { status: 400 })
        }

        // Issue 16: Prevent returns against voided sales
        if (originalSale.status === 'void') {
          return NextResponse.json({ error: 'Cannot process return against a voided sale' }, { status: 400 })
        }

        // Issue 3 & 6: Check for double returns - calculate already returned amounts (RLS scopes)
        const existingReturns = await db.query.sales.findMany({
          where: and(
            eq(sales.returnAgainst, returnAgainst),
            eq(sales.isReturn, true)
          ),
          with: {
            items: true,
          },
        })

        // RC-2: Build map of already returned quantities per item+price combination
        // Same item at different prices = separate lines
        const returnedQuantities: Record<string, number> = {}
        for (const returnSale of existingReturns) {
          for (const returnItem of returnSale.items) {
            const itemId = returnItem.itemId || returnItem.itemName
            const price = parseCurrency(returnItem.unitPrice)
            // Key includes both itemId and price for precise matching
            const key = `${itemId}:${price.toFixed(2)}`
            const qty = Math.abs(parseFloat(returnItem.quantity))
            returnedQuantities[key] = (returnedQuantities[key] || 0) + qty
          }
        }

        // Issue 17: Validate each return item against original sale
        for (const cartItem of cartItems) {
          const returnQty = Math.abs(cartItem.quantity)
          const returnPrice = parseCurrency(cartItem.unitPrice)

          // RC-2: Match by itemId AND price first (same item, different price = different line)
          let originalItem = originalSale.items.find(
            (si: { itemId: string | null; itemName: string; unitPrice: string }) =>
              (si.itemId === cartItem.itemId || si.itemName === cartItem.name) &&
              currencyEquals(si.unitPrice, cartItem.unitPrice)
          )

          // Fallback to itemId only for legacy data without price matching
          if (!originalItem) {
            originalItem = originalSale.items.find(
              (si: { itemId: string | null; itemName: string }) =>
                si.itemId === cartItem.itemId || si.itemName === cartItem.name
            )
          }

          if (!originalItem) {
            return NextResponse.json({
              error: `Item "${cartItem.name}" was not in the original sale`
            }, { status: 400 })
          }

          const originalQty = Math.abs(parseFloat(originalItem.quantity))
          // RC-2: Use item+price key for lookup
          const returnKey = `${cartItem.itemId}:${returnPrice.toFixed(2)}`
          const legacyKey = cartItem.itemId || cartItem.name
          const alreadyReturned = returnedQuantities[returnKey] || returnedQuantities[`${legacyKey}:${parseCurrency(originalItem.unitPrice).toFixed(2)}`] || 0
          const maxReturnable = originalQty - alreadyReturned

          if (returnQty > maxReturnable) {
            if (maxReturnable <= 0) {
              return NextResponse.json({
                error: `Item "${cartItem.name}" has already been fully returned`
              }, { status: 400 })
            }
            return NextResponse.json({
              error: `Cannot return ${returnQty} of "${cartItem.name}". Only ${maxReturnable} remaining (${alreadyReturned} already returned)`
            }, { status: 400 })
          }
        }

        // Check if entire sale has been fully returned
        const originalTotal = Math.abs(parseFloat(originalSale.total))
        const totalAlreadyReturned = existingReturns.reduce(
          (sum, r) => sum + Math.abs(parseFloat(r.total)), 0
        )
        if (totalAlreadyReturned >= originalTotal) {
          return NextResponse.json({
            error: 'This sale has already been fully returned'
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

    if (!isReturn && tenantItems.length !== itemIds.length) {
      return NextResponse.json({ error: 'Invalid items in cart' }, { status: 400 })
    }

    // Block returns of gift card items — gift cards are non-returnable
    if (isReturn) {
      for (const cartItem of cartItems) {
        const item = tenantItems.find(i => i.id === cartItem.itemId)
        if (item?.isGiftCard) {
          return NextResponse.json({
            error: `Gift card item "${cartItem.name}" cannot be returned`,
            code: 'GIFT_CARD_NOT_RETURNABLE'
          }, { status: 400 })
        }
      }
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
    }

    const expandedCartItems: ExpandedCartItem[] = []

    for (const cartItem of cartItems) {
      const item = tenantItems.find(i => i.id === cartItem.itemId)
      // Issue #3: For returns, allow items with no matching item record (deleted items)
      if (!item && !isReturn) continue

      const unitPrice = roundCurrency(cartItem.unitPrice)
      const quantity = cartItem.quantity
      const itemDiscount = roundCurrency(cartItem.discount || 0)

      // Issue #20: Validate negative prices (only for non-returns)
      if (!isReturn && unitPrice < 0) {
        return NextResponse.json({ error: `Price cannot be negative for "${cartItem.name}"` }, { status: 400 })
      }

      // Issue #15: Validate item-level discount doesn't exceed item subtotal
      const itemSubtotal = roundCurrency(unitPrice * Math.abs(quantity))
      if (itemDiscount > itemSubtotal && !isReturn) {
        return NextResponse.json({ error: `Discount exceeds item total for "${cartItem.name}"` }, { status: 400 })
      }

      const itemTotal = roundCurrency(unitPrice * quantity - itemDiscount)
      expandedCartItems.push({
        itemId: cartItem.itemId || '',
        name: cartItem.name || '',
        quantity: quantity,
        unitPrice: unitPrice,
        discount: itemDiscount,
        total: itemTotal,
        costPrice: item ? roundCurrency(parseFloat(item.costPrice)) : 0,
        serialNumberIds: cartItem.serialNumberIds || undefined,
      })
    }

    const finalSubtotal = subtotal
    const finalDiscount = discount || 0
    const finalTax = tax || 0
    const finalTotal = total

    // Server-side tax recalculation result (populated when client doesn't send taxBreakdown)
    let serverTaxResult: Awaited<ReturnType<typeof recalculateDocumentTax>> | null = null

    // Issue #4: Server-side total validation
    if (!isReturn) {
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

      // Server-side tax validation and recalculation
      // If client sends taxBreakdown (modern POS), validate it.
      // If not, recalculate server-side using templates to ensure correct tax.
      if (bodyTaxBreakdown && bodyTaxBreakdown.length > 0) {
        // Template-based tax from client: validate total matches finalTax
        const breakdownTotal = roundCurrency(bodyTaxBreakdown.reduce((s, b) => s + b.amount, 0))
        if (Math.abs(breakdownTotal - finalTax) > 0.50) {
          return NextResponse.json({
            error: 'Tax breakdown total does not match tax amount. Please refresh and try again.',
          }, { status: 400 })
        }
      } else {
        // No client breakdown: compute server-side using tax templates
        const saleLineItems = expandedCartItems.map(ci => ({
          itemId: ci.itemId || null,
          lineTotal: ci.total,
        }))
        serverTaxResult = await recalculateDocumentTax(db, session.user.tenantId, saleLineItems, { type: 'sales' })
        if (serverTaxResult.taxBreakdown && serverTaxResult.taxBreakdown.length > 0) {
          // Validate server-computed tax vs client tax (allow small rounding diff)
          if (Math.abs(serverTaxResult.totalTax - finalTax) > 0.50) {
            return NextResponse.json({
              error: 'Tax calculation mismatch. Please refresh and try again.',
            }, { status: 400 })
          }
        }
      }
    }

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
      const cartItems = held.cartItems as Array<{ itemId: string; quantity: number }>
      if (Array.isArray(cartItems)) {
        for (const item of cartItems) {
          if (item.itemId) {
            reservedMap.set(item.itemId, (reservedMap.get(item.itemId) || 0) + (item.quantity || 0))
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
      for (const cartItem of expandedCartItems) {
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
          if (availableStock < cartItem.quantity) {
            insufficientStockItems.push(`${cartItem.name} (need: ${cartItem.quantity}, available: ${availableStock})`)
          }
        }
      }

      if (insufficientStockItems.length > 0) {
        return NextResponse.json({
          error: `Insufficient stock for: ${insufficientStockItems.join(', ')}`,
          insufficientStockItems,
        }, { status: 400 })
      }

      // Calculate payment amounts using final totals
      const totalAmount = finalTotal
      // Credit payment method means "sell on credit" — no money received now
      const cashCardAmount = paymentMethod === 'credit' ? 0 : (amountPaid || 0)
      const creditUsed = creditAmount || 0
      const totalPaid = cashCardAmount + creditUsed
      const overpayment = Math.max(0, totalPaid - totalAmount)
      const actualPaidAmount = Math.min(totalPaid, totalAmount)

      // Credit sales require a customer (need to know who owes the money)
      if (paymentMethod === 'credit' && !customerId) {
        return NextResponse.json({ error: 'A customer must be selected for credit sales' }, { status: 400 })
      }

      // If using customer credit balance, verify customer has enough balance (RLS scopes)
      if (creditUsed > 0 && customerId) {
        const customer = await db.query.customers.findFirst({
          where: eq(customers.id, customerId),
        })
        if (!customer || parseFloat(customer.balance) < creditUsed) {
          return NextResponse.json({ error: 'Insufficient customer credit balance' }, { status: 400 })
        }
      }

      // Resolve cost center from POS profile (GL account now resolved from Modes of Payment in auto-post)
      let costCenterId = providedCostCenterId || null
      if (posOpeningEntryId) {
        const openingEntry = await db.query.posOpeningEntries.findFirst({
          where: eq(posOpeningEntries.id, posOpeningEntryId),
        })
        if (openingEntry) {
          const posProfile = await db.query.posProfiles.findFirst({
            where: eq(posProfiles.id, openingEntry.posProfileId),
          })
          if (posProfile && !costCenterId && posProfile.costCenterId) {
            costCenterId = posProfile.costCenterId
          }
        }
      }

      // Create sale and items in transaction (RLS scopes)
      const result = await db.transaction(async (tx) => {
        // Generate invoice/return number atomically inside transaction
        // Use advisory lock to prevent duplicate invoice numbers under concurrency
        const prefix = isReturn ? 'RTN' : 'INV'
        const lockKey = isReturn ? 2 : 1 // Different lock keys for INV vs RTN
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`)
        const [maxResult] = await tx
          .select({ maxNo: sql<string>`MAX(${sales.invoiceNo})` })
          .from(sales)
          .where(sql`${sales.invoiceNo} LIKE ${prefix + '-%'}`)

      const lastNo = maxResult?.maxNo
      const nextNumber = lastNo ? parseInt(lastNo.replace(/\D/g, '')) + 1 : 1
      const invoiceNo = `${prefix}-${String(nextNumber).padStart(6, '0')}`

      // Create sale
      const saleResult = await tx.insert(sales).values({
        tenantId: session.user.tenantId,
        createdBy: userId,
        customerId: customerId || null,
        vehicleId: vehicleId || null,
        warehouseId: warehouseId,
        posOpeningEntryId: posOpeningEntryId || null,
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
        total: String(finalTotal),
        paidAmount: String(isReturn ? 0 : actualPaidAmount), // Returns don't have payments received
        paymentMethod: isReturn ? 'cash' : (creditUsed > 0 && cashCardAmount === 0 ? 'credit' : (paymentMethod || 'cash')),
        // Issue #13: Differentiate between pending (no payment) and partial payment
        status: isReturn ? 'completed' : (actualPaidAmount >= totalAmount ? 'completed' : actualPaidAmount > 0 ? 'partial' : 'pending'),
        isReturn: isReturn || false,
        returnAgainst: isReturn ? returnAgainst : null,
        costCenterId: costCenterId || null,
        workOrderId: workOrderId || null,
        restaurantOrderId: restaurantOrderId || null,
      }).returning()
      const newSale = (saleResult as typeof sales.$inferSelect[])[0]

      // Split tender (multiple payment methods) or single payment
      const splits = Array.isArray(paymentSplits) ? paymentSplits : null
      if (splits && splits.length > 0 && !isReturn) {
        for (const split of splits) {
          if (split.amount > 0) {
            await tx.insert(payments).values({
              tenantId: session.user.tenantId,
              saleId: newSale.id,
              amount: String(split.amount),
              method: split.method,
              reference: split.reference || null,
              receivedBy: userId,
            })
          }
        }
      } else {
        // Create payment record for cash/card payment
        if (cashCardAmount > 0) {
          await tx.insert(payments).values({
            tenantId: session.user.tenantId,
            saleId: newSale.id,
            amount: String(cashCardAmount),
            method: paymentMethod || 'cash',
            receivedBy: userId,
          })
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

      // Gift card redemption: atomically deduct from card within same transaction
      if (paymentMethod === 'gift_card' && giftCardId && cashCardAmount > 0) {
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
        if (cardBalance < cashCardAmount - 0.01) {
          throw new Error('GIFT_CARD_INSUFFICIENT_BALANCE')
        }

        const newBalance = roundCurrency(Math.max(0, cardBalance - cashCardAmount))
        const newStatus = newBalance < 0.01 ? 'used' as const : 'active' as const

        await tx.update(giftCards)
          .set({ currentBalance: String(newBalance), status: newStatus })
          .where(eq(giftCards.id, giftCardId))

        await tx.insert(giftCardTransactions).values({
          tenantId: session.user.tenantId,
          giftCardId,
          type: 'redemption',
          amount: String(cashCardAmount),
          balanceAfter: String(newBalance),
          saleId: newSale.id,
          createdBy: userId,
        })
      }

        // Handle customer credit transactions (RLS scopes inside transaction)
        if (customerId) {
          const customer = await tx.query.customers.findFirst({
            where: eq(customers.id, customerId),
          })

        if (customer) {
          let newBalance = parseFloat(customer.balance)

          // Deduct credit if used
          if (creditUsed > 0) {
            newBalance -= creditUsed
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
          if (overpayment > 0 && addOverpaymentToCredit) {
            newBalance += overpayment
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
          if (creditUsed > 0 || (overpayment > 0 && addOverpaymentToCredit)) {
            await tx.update(customers)
              .set({
                balance: String(newBalance),
                updatedAt: new Date(),
              })
              .where(eq(customers.id, customerId))
          }
        }
      }

        // AUTHORITATIVE STOCK CHECK: Create sale items and update stock
        // This section uses FOR UPDATE locks to prevent race conditions.
        // Even if the pre-transaction check passed, we re-verify here with exclusive locks.
        // This ensures consistency even with concurrent bundle sales.
        for (const cartItem of expandedCartItems) {
          // Get item info (for trackStock flag) - RLS scopes inside transaction
          const [lockedItem] = await tx
            .select()
            .from(items)
            .where(eq(items.id, cartItem.itemId))
            .for('update')

        // Calculate per-item tax: use client-provided per-item data or server-computed template data
        const clientCartItem = cartItems.find(ci => ci.itemId === cartItem.itemId)
        const itemTaxRate = clientCartItem?.taxRate ?? 0
        let itemTaxAmount = clientCartItem?.taxAmount ?? 0
        const itemTaxTemplateId = clientCartItem?.taxTemplateId ?? null
        let itemTaxBreakdown = clientCartItem?.taxBreakdown ?? null

        // If client didn't provide per-item tax, use server-computed template results
        if (!clientCartItem?.taxAmount && serverTaxResult && !isReturn) {
          const expandedIdx = expandedCartItems.findIndex(ci => ci.itemId === cartItem.itemId)
          const perItem = expandedIdx >= 0 ? serverTaxResult.perItemTax[expandedIdx] : null
          if (perItem) {
            itemTaxAmount = perItem.taxAmount
            itemTaxBreakdown = perItem.taxBreakdown || null
          }
        }

        // Create sale item
        await tx.insert(saleItems).values({
          tenantId: session.user.tenantId,
          saleId: newSale.id,
          itemId: cartItem.itemId,
          itemName: cartItem.name,
          quantity: String(cartItem.quantity), // Negative for returns
          unitPrice: String(cartItem.unitPrice),
          discount: String(cartItem.discount || 0),
          taxRate: String(itemTaxRate),
          taxAmount: String(itemTaxAmount),
          taxTemplateId: itemTaxTemplateId,
          taxBreakdown: itemTaxBreakdown,
          total: String(cartItem.total), // Negative for returns
          serialNumberIds: cartItem.serialNumberIds?.length ? cartItem.serialNumberIds : null,
        })

          // Update warehouse stock (safe now because row is locked)
          if (lockedItem?.trackStock) {
            // Lock and get warehouse stock - RLS scopes inside transaction
            const [lockedStock] = await tx
              .select()
              .from(warehouseStock)
              .where(and(
                eq(warehouseStock.itemId, cartItem.itemId),
                eq(warehouseStock.warehouseId, warehouseId)
              ))
              .for('update')

          // For returns: quantity is negative, so subtracting negative = adding back
          // For sales: quantity is positive, so subtracting = reducing stock

          // Skip stock validation for returns (we're adding stock back)
          if (!isReturn && cartItem.quantity > 0) {
            const currentStock = lockedStock ? parseFloat(lockedStock.currentStock) : 0
            const reserved = reservedMap.get(lockedItem.id) || 0
            const availableStock = currentStock - reserved
            if (availableStock < cartItem.quantity) {
              throw new Error(`INSUFFICIENT_STOCK:${cartItem.name} (need: ${cartItem.quantity}, have: ${availableStock})`)
            }
          }

          // Serial number tracking
          if (lockedItem?.trackSerialNumbers && cartItem.serialNumberIds?.length) {
            if (!isReturn) {
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
            } else {
              // For returns: mark serials as 'returned' and move back to warehouse
              await allocateSerials(tx, {
                tenantId: session.user.tenantId,
                serialNumberIds: cartItem.serialNumberIds,
                newStatus: 'returned',
                referenceType: 'return',
                referenceId: newSale.id,
                changedBy: userId,
              })
            }
          }

          if (lockedStock) {
            // Update existing warehouse stock
            await tx.update(warehouseStock)
              .set({
                currentStock: sql`${warehouseStock.currentStock} - ${cartItem.quantity}`,
                updatedAt: new Date(),
              })
              .where(eq(warehouseStock.id, lockedStock.id))
          } else {
            // Create warehouse stock record (for returns adding new stock)
            await tx.insert(warehouseStock).values({
              tenantId: session.user.tenantId,
              warehouseId: warehouseId,
              itemId: cartItem.itemId,
              currentStock: String(-cartItem.quantity), // Negative of negative = positive for returns
              minStock: '0',
            })
          }

          // Create stock movement
          // For returns: quantity is negative, stock movement shows items coming back in
          await tx.insert(stockMovements).values({
            tenantId: session.user.tenantId,
            warehouseId: warehouseId,
            itemId: cartItem.itemId,
            type: isReturn ? 'in' : 'out',
            quantity: String(Math.abs(cartItem.quantity)), // Always positive in stock movement
            referenceType: isReturn ? 'return' : 'sale',
            referenceId: newSale.id,
          })
        }
      }

        // Auto-create gift cards for gift card items sold
        const generatedGiftCards: { cardNumber: string; balance: number }[] = []
        if (!isReturn) {
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

        // For returns, handle refund based on method
        if (isReturn && (refundAmount ?? 0) > 0) {
          if (refundMethod === 'credit' && customerId) {
            // Add refund amount to customer credit
            // Use row lock to prevent race conditions on credit balance update - RLS scopes
            const [customer] = await tx
              .select()
              .from(customers)
              .where(eq(customers.id, customerId))
              .for('update')

          if (customer) {
            const newBalance = parseFloat(customer.balance || '0') + (refundAmount ?? 0)
            await tx.insert(customerCreditTransactions).values({
              tenantId: session.user.tenantId,
              customerId,
              type: 'refund',
              amount: String(refundAmount),
              balanceAfter: String(newBalance),
              referenceType: 'return',
              referenceId: newSale.id,
              notes: `Refund from ${invoiceNo}`,
              createdBy: userId,
            })

            await tx.update(customers)
              .set({
                balance: String(newBalance),
                updatedAt: new Date(),
              })
              .where(eq(customers.id, customerId))
          }
        } else if (refundMethod === 'cash' || refundMethod === 'card') {
          // Issue 7: Create payment record for cash/card refunds (negative amount for audit trail)
          await tx.insert(payments).values({
            tenantId: session.user.tenantId,
            saleId: newSale.id,
            amount: String(-(refundAmount ?? 0)), // Negative to indicate money out
            method: refundMethod,
            receivedBy: userId,
          })
        }

          // 8K: Insert refund audit record
          await tx.insert(refunds).values({
            tenantId: session.user.tenantId,
            saleId: newSale.id,
            originalSaleId: returnAgainst || null,
            amount: String(refundAmount),
            method: refundMethod || 'cash',
            processedBy: userId,
            reason: `Return ${newSale.invoiceNo}${returnAgainst ? ' against original sale' : ''}`,
          })
      }

        // === LOYALTY PROGRAM INTEGRATION ===
        if (customerId && !isReturn) {
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

        // Handle loyalty point reversal for returns
        if (isReturn && returnAgainst && customerId) {
          // Find loyalty transactions from the original sale
          const originalLoyaltyTxns = await tx
            .select()
            .from(loyaltyTransactions)
            .where(and(
              eq(loyaltyTransactions.saleId, returnAgainst),
              eq(loyaltyTransactions.type, 'earn')
            ))

          if (originalLoyaltyTxns.length > 0) {
            const totalEarnedFromOriginal = originalLoyaltyTxns.reduce((sum, t) => sum + t.points, 0)
            // Issue #17: Calculate proportional reversal based on return amount vs original sale total
            const [originalSaleData] = await tx
              .select({ total: sales.total })
              .from(sales)
              .where(eq(sales.id, returnAgainst))
            const originalSaleTotal = originalSaleData ? Math.abs(parseFloat(originalSaleData.total)) : 0
            const returnProportion = originalSaleTotal > 0 ? Math.abs(finalTotal) / originalSaleTotal : 0
            const pointsToReverse = Math.min(totalEarnedFromOriginal, Math.floor(totalEarnedFromOriginal * returnProportion))

            if (pointsToReverse > 0) {
              const [currentCustomer] = await tx
                .select()
                .from(customers)
                .where(eq(customers.id, customerId))
                .for('update')

              if (currentCustomer) {
                const newPoints = Math.max(0, (currentCustomer.loyaltyPoints || 0) - pointsToReverse)
                await tx.insert(loyaltyTransactions).values({
                  tenantId: session.user.tenantId,
                  customerId,
                  type: 'reversal',
                  points: -pointsToReverse,
                  balanceAfter: newPoints,
                  saleId: newSale.id,
                  notes: `Reversed ${pointsToReverse} points due to return ${invoiceNo}`,
                })
                await tx.update(customers)
                  .set({
                    loyaltyPoints: newPoints,
                    updatedAt: new Date(),
                  })
                  .where(eq(customers.id, customerId))
              }
            }
          }
        }

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

          // Post regular items as normal sale
          if (regularTotal > 0 || isReturn) {
            await postSaleToGL(tx, session.user.tenantId, {
              saleId: newSale.id,
              invoiceNumber: newSale.invoiceNo,
              saleDate: new Date().toISOString().split('T')[0],
              subtotal: roundCurrency(finalSubtotal - giftCardItemTotal),
              tax: finalTax,
              discount: finalDiscount,
              total: regularTotal,
              amountPaid: roundCurrency(cashCardAmount - giftCardItemTotal),
              creditAmount: creditUsed,
              costOfGoodsSold: totalCOGS,
              paymentMethod: paymentMethod || 'cash',
              refundMethod: isReturn ? (refundMethod || 'cash') : undefined,
              customerId: customerId || null,
              isReturn,
              costCenterId: costCenterId || null,
              taxBreakdown: (bodyTaxBreakdown || serverTaxResult?.taxBreakdown) as TaxBreakdownItem[] | undefined,
            })
          }

          // Post gift card items as liability (not revenue)
          if (giftCardItemTotal > 0 && !isReturn) {
            await postGiftCardSaleToGL(tx, session.user.tenantId, {
              saleId: newSale.id,
              invoiceNumber: newSale.invoiceNo,
              saleDate: new Date().toISOString().split('T')[0],
              amount: giftCardItemTotal,
              paymentMethod: paymentMethod || 'cash',
              customerId: customerId || null,
              costCenterId: costCenterId || null,
            })
          }
        }

        return { ...newSale, generatedGiftCards }
      })

      // Broadcast the change to connected clients
      logAndBroadcast(session.user.tenantId, 'sale', 'created', result.id, {
        userId,
        entityName: result.invoiceNo,
        description: isReturn
          ? `Processed return ${result.invoiceNo}${returnAgainst ? ' against original sale' : ''}`
          : generateActivityDescription('create', 'sale', result.invoiceNo),
      })
      // WS-3: Broadcast specific item stock updates (not 'all')
      const affectedItemIds = [...new Set(expandedCartItems.map(i => i.itemId))]
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
      if (!isReturn) {
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
      } else {
        // AI: Refund anomaly detection (fire-and-forget)
        if ((refundAmount ?? 0) > 0 && returnAgainst) {
          checkRefundAnomalies(session.user.tenantId, {
            id: result.id,
            saleId: result.id,
            invoiceNo: result.invoiceNo,
            refundAmount: refundAmount ?? 0,
            refundMethod: refundMethod || 'cash',
            originalSaleTotal: finalTotal,
            originalSaleDate: new Date().toISOString(),
            originalPaymentMethod: paymentMethod,
            cashierName: session.user.name || undefined,
          })
        }
      }

      return NextResponse.json(result)
    })
  } catch (error) {
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

    return NextResponse.json({ error: 'Failed to create sale' }, { status: 500 })
  }
}
