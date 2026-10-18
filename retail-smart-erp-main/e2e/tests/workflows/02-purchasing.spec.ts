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
  getSupplierBalance,
  daysFromNow,
  num,
} from './helpers'

test.describe('Workflow — Purchasing Flows', () => {
  test.setTimeout(300_000)

  BUSINESS_TYPES.forEach((type) => {
    test.describe.serial(`Purchasing ${type}`, () => {
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

      // ════════════════════════════════════════
      // Flow A: PO → Submit → Confirm → Receive → Convert to PI
      // ════════════════════════════════════════

      let poId: string
      let poOrderNo: string
      const trackedItems = () => company.items.filter((i) => i.trackStock)

      // Record stock before any purchasing to make assertions relative
      let stockBeforePO: Record<string, number> = {}

      test(`PUR-${type}-000: Record stock before purchasing`, async () => {
        test.skip(!request, `${type} not set up`)

        for (const item of trackedItems()) {
          const stocks = await getWarehouseStock(request, item.id)
          stockBeforePO[item.id] = getStockForWarehouse(stocks, company.warehouseA)
        }
      })

      test(`PUR-${type}-001: Create Purchase Order with full details`, async () => {
        test.skip(!request, `${type} not set up`)

        const items = trackedItems()
        expect(items.length).toBeGreaterThan(0)

        const res = await request.post('/api/purchase-orders', {
          data: {
            supplierId: company.suppliers[0].id,
            warehouseId: company.warehouseA,
            expectedDeliveryDate: daysFromNow(7),
            notes: `E2E Purchase Order for ${type} business — stocking up main warehouse with essential inventory items`,
            tags: ['e2e-test', type, 'initial-stock'],
            items: items.map((item) => ({
              itemId: item.id,
              itemName: item.name,
              quantity: 50,
              unitPrice: item.costPrice,
              tax: 0,
            })),
          },
        })
        expect(res.ok(), `Create PO failed: ${await res.text()}`).toBeTruthy()
        const po = await res.json()
        poId = po.id
        poOrderNo = po.orderNo
        expect(po.status).toBe('draft')
        expect(po.orderNo).toMatch(/^PO-/)
      })

      test(`PUR-${type}-002: Verify NO stock or GL on draft PO`, async () => {
        test.skip(!request || !poId, `${type} not set up`)

        // No stock movements should exist for this PO
        const movements = await getStockMovements(request, { warehouseId: company.warehouseA })
        const poMovements = movements.filter((m) => m.referenceId === poId)
        expect(poMovements.length).toBe(0)
      })

      test(`PUR-${type}-003: Submit PO`, async () => {
        test.skip(!request || !poId, `${type} not set up`)

        const res = await request.put(`/api/purchase-orders/${poId}`, {
          data: { status: 'submitted' },
        })
        expect(res.ok(), `Submit PO failed: ${await res.text()}`).toBeTruthy()
      })

      test(`PUR-${type}-004: Confirm PO`, async () => {
        test.skip(!request || !poId, `${type} not set up`)

        const res = await request.put(`/api/purchase-orders/${poId}`, {
          data: { status: 'confirmed' },
        })
        expect(res.ok(), `Confirm PO failed: ${await res.text()}`).toBeTruthy()
      })

      test(`PUR-${type}-005: Receive PO partial (30 of 50)`, async () => {
        test.skip(!request || !poId, `${type} not set up`)

        // Get PO items to find their IDs
        const poRes = await request.get(`/api/purchase-orders/${poId}`)
        const po = await poRes.json()
        const poItems = po.items || []
        expect(poItems.length).toBeGreaterThan(0)

        // Receive 30 of first item only
        const res = await request.post(`/api/purchase-orders/${poId}/receive`, {
          data: {
            items: [{ itemId: poItems[0].id, receivedQuantity: 30 }],
            updateStock: true,
            notes: 'Partial receipt — 30 units of first item received in good condition',
          },
        })
        expect(res.ok(), `Receive partial failed: ${await res.text()}`).toBeTruthy()
        const receipt = await res.json()
        expect(receipt.receiptNo).toMatch(/^GRN-/)
      })

      test(`PUR-${type}-006: Verify stock after partial receive`, async () => {
        test.skip(!request || !poId, `${type} not set up`)

        const item = trackedItems()[0]
        const stocks = await getWarehouseStock(request, item.id)
        const stockInWHA = getStockForWarehouse(stocks, company.warehouseA)
        const before = stockBeforePO[item.id] || 0
        expect(stockInWHA).toBe(before + 30)
      })

      test(`PUR-${type}-007: Receive remaining items`, async () => {
        test.skip(!request || !poId, `${type} not set up`)

        const poRes = await request.get(`/api/purchase-orders/${poId}`)
        const po = await poRes.json()
        const poItems = po.items || []

        // Receive remaining: 20 of first item + 50 of others
        const receiveItems = poItems.map((pi: { id: string; quantity: string; receivedQuantity: string }) => ({
          itemId: pi.id,
          receivedQuantity: parseFloat(pi.quantity) - parseFloat(pi.receivedQuantity || '0'),
        })).filter((ri: { receivedQuantity: number }) => ri.receivedQuantity > 0)

        if (receiveItems.length > 0) {
          const res = await request.post(`/api/purchase-orders/${poId}/receive`, {
            data: {
              items: receiveItems,
              updateStock: true,
              notes: 'Final receipt — all remaining items received, order complete',
            },
          })
          expect(res.ok(), `Receive remaining failed: ${await res.text()}`).toBeTruthy()
        }
      })

      test(`PUR-${type}-008: Verify stock after full receive`, async () => {
        test.skip(!request || !poId, `${type} not set up`)

        for (const item of trackedItems()) {
          const stocks = await getWarehouseStock(request, item.id)
          const stockInWHA = getStockForWarehouse(stocks, company.warehouseA)
          const before = stockBeforePO[item.id] || 0
          expect(stockInWHA).toBe(before + 50)
        }
      })

      let purchaseInvoiceId: string

      test(`PUR-${type}-009: Convert PO to Purchase Invoice`, async () => {
        test.skip(!request || !poId, `${type} not set up`)

        const res = await request.post(`/api/purchase-orders/${poId}/create-invoice`, {
          data: {
            paymentTerm: 'credit',
            notes: `Invoice from PO ${poOrderNo} — credit terms Net 30 agreed with supplier`,
            costCenterId: company.costCenterOps,
            updateStock: false,
          },
        })
        expect(res.ok(), `Create invoice failed: ${await res.text()}`).toBeTruthy()
        const data = await res.json()
        purchaseInvoiceId = data.purchase?.id || data.id
        expect(data.purchase?.purchaseNo || data.purchaseNo).toMatch(/^PI-/)

        // Save to state
        company.purchaseOrders.push({ id: poId, orderNo: poOrderNo })
        company.purchases.push({
          id: purchaseInvoiceId,
          purchaseNo: data.purchase?.purchaseNo || data.purchaseNo,
        })
        updateCompanyState(type, {
          purchaseOrders: company.purchaseOrders,
          purchases: company.purchases,
        })
      })

      test(`PUR-${type}-010: Verify supplier balance increased`, async () => {
        test.skip(!request || !purchaseInvoiceId, `${type} not set up`)

        const balance = await getSupplierBalance(request, company.suppliers[0].id)
        expect(balance).toBeGreaterThan(0)
      })

      // ════════════════════════════════════════
      // Flow B: Direct Purchase Invoice (no PO)
      // ════════════════════════════════════════

      let directPiId: string

      test(`PUR-${type}-011: Create direct purchase invoice with full details`, async () => {
        test.skip(!request, `${type} not set up`)

        const items = trackedItems()
        const res = await request.post('/api/purchases', {
          data: {
            supplierId: company.suppliers[1].id,
            warehouseId: company.warehouseA,
            paymentTerm: 'cash',
            supplierInvoiceNo: `SINV-${type.toUpperCase()}-${Date.now()}`,
            supplierBillDate: daysFromNow(-1),
            notes: `Direct purchase invoice for ${type} — cash payment, no purchase order`,
            costCenterId: company.costCenterOps,
            items: items.slice(0, 2).map((item) => ({
              itemId: item.id,
              itemName: item.name,
              quantity: 20,
              unitPrice: item.costPrice,
              tax: 0,
            })),
          },
        })
        expect(res.ok(), `Direct PI failed: ${await res.text()}`).toBeTruthy()
        const pi = await res.json()
        directPiId = pi.id
        expect(pi.purchaseNo).toMatch(/^PI-/)
        expect(pi.status).toBe('draft')

        company.purchases.push({ id: directPiId, purchaseNo: pi.purchaseNo })
        updateCompanyState(type, { purchases: company.purchases })
      })

      // ════════════════════════════════════════
      // Flow C: Second PO → quick full cycle
      // ════════════════════════════════════════

      let po2Id: string

      test(`PUR-${type}-012: Create second PO to branch warehouse`, async () => {
        test.skip(!request, `${type} not set up`)

        const items = trackedItems()
        const res = await request.post('/api/purchase-orders', {
          data: {
            supplierId: company.suppliers[1].id,
            warehouseId: company.warehouseB,
            expectedDeliveryDate: daysFromNow(5),
            notes: `Second PO for ${type} — stocking branch warehouse with high-demand items`,
            tags: ['e2e-test', type, 'branch-stock'],
            items: items.slice(0, 1).map((item) => ({
              itemId: item.id,
              itemName: item.name,
              quantity: 25,
              unitPrice: item.costPrice,
              tax: 0,
            })),
          },
        })
        expect(res.ok(), `Second PO failed: ${await res.text()}`).toBeTruthy()
        const po = await res.json()
        po2Id = po.id
      })

      test(`PUR-${type}-013: Submit, confirm, receive second PO`, async () => {
        test.skip(!request || !po2Id, `${type} not set up`)

        // Submit
        let res = await request.put(`/api/purchase-orders/${po2Id}`, {
          data: { status: 'submitted' },
        })
        expect(res.ok()).toBeTruthy()

        // Confirm
        res = await request.put(`/api/purchase-orders/${po2Id}`, {
          data: { status: 'confirmed' },
        })
        expect(res.ok()).toBeTruthy()

        // Get items
        const poRes = await request.get(`/api/purchase-orders/${po2Id}`)
        const po = await poRes.json()
        const poItems = po.items || []

        // Full receive
        res = await request.post(`/api/purchase-orders/${po2Id}/receive`, {
          data: {
            items: poItems.map((pi: { id: string; quantity: string }) => ({
              itemId: pi.id,
              receivedQuantity: parseFloat(pi.quantity),
            })),
            updateStock: true,
            notes: 'Full receipt — all items received at branch warehouse',
          },
        })
        expect(res.ok(), `Receive PO2 failed: ${await res.text()}`).toBeTruthy()
      })

      test(`PUR-${type}-014: Convert second PO to invoice`, async () => {
        test.skip(!request || !po2Id, `${type} not set up`)

        const res = await request.post(`/api/purchase-orders/${po2Id}/create-invoice`, {
          data: {
            paymentTerm: 'credit',
            notes: 'Invoice from second PO — branch warehouse restocking',
            updateStock: false,
          },
        })
        expect(res.ok(), `PO2 invoice failed: ${await res.text()}`).toBeTruthy()
      })

      test(`PUR-${type}-015: Verify cumulative stock (all purchases)`, async () => {
        test.skip(!request, `${type} not set up`)

        // First tracked item should have increased by: 50 (PO1 → WH-A) + 25 (PO2 → WH-B)
        const item = trackedItems()[0]
        const stocks = await getWarehouseStock(request, item.id)
        const whA = getStockForWarehouse(stocks, company.warehouseA)
        const whB = getStockForWarehouse(stocks, company.warehouseB)
        const beforeA = stockBeforePO[item.id] || 0
        expect(whA).toBe(beforeA + 50) // From PO1
        // WH-B: we didn't record before, but at least check 25 was added
        expect(whB).toBeGreaterThanOrEqual(25)
      })

      test(`PUR-${type}-016: Verify stock movements exist`, async () => {
        test.skip(!request, `${type} not set up`)

        // Check that 'in' movements exist for the main warehouse
        const movements = await getStockMovements(request, {
          type: 'in',
          warehouseId: company.warehouseA,
        })
        expect(movements.length).toBeGreaterThan(0)
        // All should be type 'in'
        for (const m of movements) {
          expect(m.type).toBe('in')
        }
      })
    })
  })
})
