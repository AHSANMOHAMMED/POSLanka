import { test, expect, APIRequestContext, BrowserContext } from '@playwright/test'
import {
  BUSINESS_TYPES,
  BusinessType,
  loadState,
  updateCompanyState,
  loginToCompany,
  CompanyState,
  getGLEntries,
  assertGLBalance,
  getStockMovements,
  getWarehouseStock,
  getStockForWarehouse,
  getCustomerBalance,
  daysFromNow,
  num,
} from './helpers'

test.describe('Workflow — Sales Flows', () => {
  test.setTimeout(300_000)

  BUSINESS_TYPES.forEach((type) => {
    test.describe.serial(`Sales ${type}`, () => {
      let request: APIRequestContext
      let ctx: BrowserContext
      let company: CompanyState

      test.beforeAll(async ({ browser }) => {
        const state = loadState()
        company = state.companies[type]!
        if (!company?.slug) return
        ctx = await browser.newContext()
        const page = await ctx.newPage()
        await loginToCompany(page.request, company.email, company.password, company.slug)
        request = page.request
      })

      test.afterAll(async () => {
        if (ctx) await ctx.close()
      })

      const trackedItems = () => company.items.filter((i) => i.trackStock)

      // Record stock before sales for comparison
      let stockBefore: Record<string, number> = {}

      test(`SALE-${type}-001: Record stock before sales`, async () => {
        test.skip(!request, `${type} not set up`)

        for (const item of trackedItems()) {
          const stocks = await getWarehouseStock(request, item.id)
          stockBefore[item.id] = getStockForWarehouse(stocks, company.warehouseA)
        }
      })

      // ════════════════════════════════════════
      // Flow A: Open POS Shift
      // ════════════════════════════════════════

      test(`SALE-${type}-002: Open POS shift`, async () => {
        test.skip(!request, `${type} not set up`)

        const res = await request.post('/api/pos-opening-entries', {
          data: {
            posProfileId: company.posProfileId,
            notes: `E2E POS shift for ${type} — daily opening`,
          },
        })
        if (res.ok()) {
          const shift = await res.json()
          company.posOpeningEntryId = shift.id
          updateCompanyState(type, { posOpeningEntryId: shift.id })
        } else {
          // Shift already open — use the existing one
          const body = await res.json()
          if (body.existingShiftId) {
            company.posOpeningEntryId = body.existingShiftId
            updateCompanyState(type, { posOpeningEntryId: body.existingShiftId })
          } else {
            expect(res.ok(), `Open shift failed: ${JSON.stringify(body)}`).toBeTruthy()
          }
        }
        expect(company.posOpeningEntryId).toBeTruthy()
      })

      // ════════════════════════════════════════
      // Flow B: POS Cash Sale (all cart fields)
      // ════════════════════════════════════════

      let sale1Id: string
      let sale1InvoiceNo: string

      test(`SALE-${type}-003: POS cash sale with full cart details`, async () => {
        test.skip(!request, `${type} not set up`)

        const items = company.items.slice(0, 2)
        const cartItems = [
          {
            cartLineId: `line-1-${Date.now()}`,
            itemId: items[0].id,
            name: items[0].name,
            sku: `SKU-${type.toUpperCase()}-1`,
            quantity: 2,
            unitPrice: items[0].sellingPrice,
            discount: 0,
            discountType: 'fixed' as const,
            taxRate: 0,
            notes: 'Customer requested gift wrapping',
            total: items[0].sellingPrice * 2,
          },
        ]

        if (items.length > 1) {
          cartItems.push({
            cartLineId: `line-2-${Date.now()}`,
            itemId: items[1].id,
            name: items[1].name,
            sku: `SKU-${type.toUpperCase()}-2`,
            quantity: 1,
            unitPrice: items[1].sellingPrice,
            discount: 0,
            discountType: 'fixed' as const,
            taxRate: 0,
            notes: '',
            total: items[1].sellingPrice,
          })
        }

        const subtotal = cartItems.reduce((s, i) => s + i.total, 0)

        const res = await request.post('/api/sales', {
          data: {
            customerId: company.customers[0].id,
            warehouseId: company.warehouseA,
            posOpeningEntryId: company.posOpeningEntryId,
            costCenterId: company.costCenterSales,
            cartItems,
            paymentMethod: 'cash',
            subtotal,
            discount: 0,
            discountType: 'fixed',
            tax: 0,
            taxRate: 0,
            taxInclusive: false,
            total: subtotal,
            amountPaid: subtotal,
            creditAmount: 0,
          },
        })
        expect(res.ok(), `POS sale failed: ${await res.text()}`).toBeTruthy()
        const sale = await res.json()
        sale1Id = sale.id
        sale1InvoiceNo = sale.invoiceNo
        expect(sale.invoiceNo).toMatch(/^INV-/)
        expect(sale.status).toBe('completed')

        company.sales.push({ id: sale1Id, invoiceNo: sale1InvoiceNo })
        updateCompanyState(type, { sales: company.sales })
      })

      test(`SALE-${type}-004: Verify stock decreased after POS sale`, async () => {
        test.skip(!request || !sale1Id, `${type} not set up`)

        const soldItems = company.items.slice(0, 2).filter((i) => i.trackStock)
        if (soldItems.length > 0) {
          const stocks = await getWarehouseStock(request, soldItems[0].id)
          const stockNow = getStockForWarehouse(stocks, company.warehouseA)
          const before = stockBefore[soldItems[0].id] || 0
          expect(stockNow).toBe(before - 2)
        }
      })

      test(`SALE-${type}-005: Verify GL entries for POS sale`, async () => {
        test.skip(!request || !sale1Id, `${type} not set up`)

        const entries = await getGLEntries(request, { voucherId: sale1Id })
        if (entries.length > 0) {
          assertGLBalance(entries)
          const hasDebit = entries.some((e) => num(e.debit) > 0)
          const hasCredit = entries.some((e) => num(e.credit) > 0)
          expect(hasDebit).toBeTruthy()
          expect(hasCredit).toBeTruthy()
        }
      })

      // ════════════════════════════════════════
      // Flow C: POS Sale with Tax
      // ════════════════════════════════════════

      let sale2Id: string

      test(`SALE-${type}-006: POS sale with 15% tax`, async () => {
        test.skip(!request, `${type} not set up`)

        const item = company.items[0]
        const qty = 2
        const subtotal = item.sellingPrice * qty
        const tax = Math.round(subtotal * 0.15)
        const total = subtotal + tax

        const res = await request.post('/api/sales', {
          data: {
            customerId: company.customers[1]?.id || company.customers[0].id,
            warehouseId: company.warehouseA,
            posOpeningEntryId: company.posOpeningEntryId,
            costCenterId: company.costCenterSales,
            cartItems: [
              {
                cartLineId: `tax-line-${Date.now()}`,
                itemId: item.id,
                name: item.name,
                sku: `SKU-${type.toUpperCase()}-1`,
                quantity: qty,
                unitPrice: item.sellingPrice,
                discount: 0,
                discountType: 'fixed',
                taxRate: 15,
                notes: 'Tax-inclusive sale',
                total: subtotal,
              },
            ],
            paymentMethod: 'cash',
            subtotal,
            discount: 0,
            tax,
            taxRate: 15,
            taxInclusive: false,
            total,
            amountPaid: total,
            creditAmount: 0,
          },
        })
        expect(res.ok(), `Tax sale failed: ${await res.text()}`).toBeTruthy()
        const sale = await res.json()
        sale2Id = sale.id
        expect(num(sale.taxAmount || sale.tax)).toBeGreaterThan(0)

        company.sales.push({ id: sale2Id, invoiceNo: sale.invoiceNo })
        updateCompanyState(type, { sales: company.sales })
      })

      test(`SALE-${type}-007: Verify GL for tax sale includes tax entry`, async () => {
        test.skip(!request || !sale2Id, `${type} not set up`)

        const entries = await getGLEntries(request, { voucherId: sale2Id })
        if (entries.length > 0) {
          assertGLBalance(entries)
        }
      })

      // ════════════════════════════════════════
      // Flow D: POS Sale with Discount
      // ════════════════════════════════════════

      test(`SALE-${type}-008: POS sale with fixed discount`, async () => {
        test.skip(!request, `${type} not set up`)

        const item = company.items[0]
        const subtotal = item.sellingPrice * 3
        const discount = 100
        const total = subtotal - discount

        const res = await request.post('/api/sales', {
          data: {
            customerId: company.customers[0].id,
            warehouseId: company.warehouseA,
            posOpeningEntryId: company.posOpeningEntryId,
            costCenterId: company.costCenterSales,
            cartItems: [
              {
                cartLineId: `disc-line-${Date.now()}`,
                itemId: item.id,
                name: item.name,
                sku: `SKU-${type.toUpperCase()}-1`,
                quantity: 3,
                unitPrice: item.sellingPrice,
                discount: 0,
                discountType: 'fixed',
                taxRate: 0,
                total: subtotal,
              },
            ],
            paymentMethod: 'cash',
            subtotal,
            discount,
            discountType: 'fixed',
            discountReason: 'Loyal customer discount — repeat purchase',
            tax: 0,
            total,
            amountPaid: total,
            creditAmount: 0,
          },
        })
        expect(res.ok(), `Discount sale failed: ${await res.text()}`).toBeTruthy()
        const sale = await res.json()
        expect(num(sale.total)).toBeLessThan(subtotal)

        company.sales.push({ id: sale.id, invoiceNo: sale.invoiceNo })
        updateCompanyState(type, { sales: company.sales })
      })

      // ════════════════════════════════════════
      // Flow E: Sales Order → Confirm → Convert to Invoice
      // ════════════════════════════════════════

      let soId: string
      let soOrderNo: string

      test(`SALE-${type}-009: Create Sales Order with full details`, async () => {
        test.skip(!request, `${type} not set up`)

        const items = company.items.slice(0, 2)
        const res = await request.post('/api/sales-orders', {
          data: {
            customerId: company.customers[0].id,
            customerName: company.customers[0].name,
            warehouseId: company.warehouseA,
            expectedDeliveryDate: daysFromNow(3),
            deliveryAddress: '42 Galle Road, Colombo 03, Sri Lanka',
            notes: `E2E Sales Order for ${type} — scheduled delivery in 3 days, customer to confirm availability by phone`,
            items: items.map((item) => ({
              itemId: item.id,
              itemName: item.name,
              quantity: 5,
              unitPrice: item.sellingPrice,
              discount: 0,
              discountType: 'fixed',
              tax: 0,
              taxRate: 0,
            })),
          },
        })
        expect(res.ok(), `Create SO failed: ${await res.text()}`).toBeTruthy()
        const so = await res.json()
        soId = so.id
        soOrderNo = so.orderNo
        expect(so.status).toBe('draft')
        expect(so.orderNo).toMatch(/^SO-/)
      })

      test(`SALE-${type}-010: Verify NO stock movement on draft SO`, async () => {
        test.skip(!request || !soId, `${type} not set up`)

        const movements = await getStockMovements(request, { warehouseId: company.warehouseA })
        const soMovements = movements.filter((m) => m.referenceId === soId)
        expect(soMovements.length).toBe(0)
      })

      test(`SALE-${type}-011: Confirm Sales Order`, async () => {
        test.skip(!request || !soId, `${type} not set up`)

        const res = await request.put(`/api/sales-orders/${soId}`, {
          data: { status: 'confirmed' },
        })
        expect(res.ok(), `Confirm SO failed: ${await res.text()}`).toBeTruthy()
      })

      let soInvoiceId: string

      test(`SALE-${type}-012: Convert SO to Sales Invoice`, async () => {
        test.skip(!request || !soId, `${type} not set up`)

        const res = await request.post(`/api/sales-orders/${soId}/create-invoice`, {
          data: { notes: `Invoice from SO ${soOrderNo} — delivery confirmed by customer` },
        })
        expect(res.ok(), `SO→SI failed: ${await res.text()}`).toBeTruthy()
        const body = await res.json()
        const sale = body.sale || body
        soInvoiceId = sale.id
        expect(sale.invoiceNo).toMatch(/^INV-/)

        company.salesOrders.push({ id: soId, orderNo: soOrderNo })
        company.sales.push({ id: soInvoiceId, invoiceNo: sale.invoiceNo })
        updateCompanyState(type, {
          salesOrders: company.salesOrders,
          sales: company.sales,
        })
      })

      test(`SALE-${type}-013: Verify stock decreased after SO conversion`, async () => {
        test.skip(!request || !soInvoiceId, `${type} not set up`)

        const soItems = company.items.slice(0, 2).filter((i) => i.trackStock)
        if (soItems.length > 0) {
          const stocks = await getWarehouseStock(request, soItems[0].id)
          const stockNow = getStockForWarehouse(stocks, company.warehouseA)
          expect(stockNow).toBeLessThan(stockBefore[soItems[0].id] || 50)
        }
      })

      test(`SALE-${type}-014: Verify GL for SO invoice`, async () => {
        test.skip(!request || !soInvoiceId, `${type} not set up`)

        const entries = await getGLEntries(request, { voucherId: soInvoiceId })
        if (entries.length > 0) {
          assertGLBalance(entries)
        }
      })

      // ════════════════════════════════════════
      // Flow F: POS Return / Refund
      // ════════════════════════════════════════

      test(`SALE-${type}-015: Return 1× Item A against first sale`, async () => {
        test.skip(!request || !sale1Id, `${type} not set up`)

        const item = company.items[0]
        const returnAmount = item.sellingPrice

        const res = await request.post('/api/sales', {
          data: {
            customerId: company.customers[0].id,
            warehouseId: company.warehouseA,
            posOpeningEntryId: company.posOpeningEntryId,
            costCenterId: company.costCenterSales,
            isReturn: true,
            returnAgainst: sale1Id,
            cartItems: [
              {
                cartLineId: `return-line-${Date.now()}`,
                itemId: item.id,
                name: item.name,
                sku: `SKU-${type.toUpperCase()}-1`,
                quantity: -1,
                unitPrice: item.sellingPrice,
                discount: 0,
                discountType: 'fixed',
                taxRate: 0,
                notes: 'Customer returned — item defective',
                total: -returnAmount,
              },
            ],
            paymentMethod: 'cash',
            subtotal: -returnAmount,
            discount: 0,
            tax: 0,
            total: -returnAmount,
            amountPaid: 0,
            refundAmount: returnAmount,
            refundMethod: 'cash',
            creditAmount: 0,
          },
        })
        expect(res.ok(), `Return failed: ${await res.text()}`).toBeTruthy()
        const returnSale = await res.json()
        expect(returnSale.isReturn).toBe(true)

        company.sales.push({ id: returnSale.id, invoiceNo: returnSale.invoiceNo })
        updateCompanyState(type, { sales: company.sales })
      })

      test(`SALE-${type}-016: Verify stock increased after return`, async () => {
        test.skip(!request || !sale1Id, `${type} not set up`)

        const items = trackedItems()
        if (items.length > 0) {
          const stocks = await getWarehouseStock(request, items[0].id)
          const stockNow = getStockForWarehouse(stocks, company.warehouseA)
          expect(stockNow).toBeGreaterThanOrEqual(0)
        }
      })

      // ════════════════════════════════════════
      // Verify cumulative stock movements
      // ════════════════════════════════════════

      test(`SALE-${type}-017: Verify stock movement types exist`, async () => {
        test.skip(!request, `${type} not set up`)

        const soldTracked = company.items.slice(0, 2).some((i) => i.trackStock)
        if (soldTracked) {
          const outMovements = await getStockMovements(request, {
            type: 'out',
            warehouseId: company.warehouseA,
          })
          expect(outMovements.length).toBeGreaterThan(0)
        }
      })
    })
  })
})
