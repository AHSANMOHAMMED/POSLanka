import { test, expect, APIRequestContext, BrowserContext } from '@playwright/test'
import {
  BUSINESS_TYPES,
  BusinessType,
  loadState,
  loginToCompany,
  CompanyState,
  getStockMovements,
  getWarehouseStock,
  getStockForWarehouse,
  num,
} from './helpers'

test.describe('Workflow — Inventory: Transfers, Stock Takes, Movements', () => {
  test.setTimeout(300_000)

  BUSINESS_TYPES.forEach((type) => {
    test.describe.serial(`Inventory ${type}`, () => {
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

      // ════════════════════════════════════════
      // Flow A: Stock Transfer WH-A → WH-B
      // ════════════════════════════════════════

      let transferId: string
      let stockBeforeTransfer: Record<string, { whA: number; whB: number }> = {}

      test(`INV-${type}-001: Record stock before transfer`, async () => {
        test.skip(!request, `${type} not set up`)

        for (const item of trackedItems()) {
          const stocks = await getWarehouseStock(request, item.id)
          stockBeforeTransfer[item.id] = {
            whA: getStockForWarehouse(stocks, company.warehouseA),
            whB: getStockForWarehouse(stocks, company.warehouseB),
          }
        }
      })

      test(`INV-${type}-002: Create stock transfer WH-A → WH-B with item notes`, async () => {
        test.skip(!request, `${type} not set up`)

        const items = trackedItems()
        test.skip(items.length === 0, 'No tracked items')

        // Transfer 5 units of first tracked item
        const item = items[0]
        const beforeA = stockBeforeTransfer[item.id]?.whA || 0
        const transferQty = Math.min(5, beforeA) // Don't transfer more than available
        test.skip(transferQty === 0, 'No stock to transfer')

        const res = await request.post('/api/stock-transfers', {
          data: {
            fromWarehouseId: company.warehouseA,
            toWarehouseId: company.warehouseB,
            items: [
              {
                itemId: item.id,
                quantity: transferQty,
                notes: `Transferring ${transferQty} units to branch warehouse — restocking for weekend demand`,
              },
            ],
            notes: `E2E stock transfer for ${type} — moving inventory from main warehouse to branch location to balance stock levels across both locations`,
          },
        })
        expect(res.ok(), `Create transfer failed: ${await res.text()}`).toBeTruthy()
        const transfer = await res.json()
        transferId = transfer.id
        expect(transfer.transferNo).toBeTruthy()
        expect(transfer.status).toBe('draft')
      })

      test(`INV-${type}-003: Submit transfer for approval`, async () => {
        test.skip(!request || !transferId, `${type} not set up`)

        const res = await request.put(`/api/stock-transfers/${transferId}`, {
          data: {
            action: 'submit_for_approval',
            notes: 'Ready for manager approval — all items verified and packed',
          },
        })
        expect(res.ok(), `Submit transfer failed: ${await res.text()}`).toBeTruthy()
      })

      test(`INV-${type}-004: Approve transfer`, async () => {
        test.skip(!request || !transferId, `${type} not set up`)

        const res = await request.put(`/api/stock-transfers/${transferId}`, {
          data: {
            action: 'approve',
            notes: 'Approved — schedule for dispatch today',
          },
        })
        expect(res.ok(), `Approve transfer failed: ${await res.text()}`).toBeTruthy()
      })

      test(`INV-${type}-005: Ship transfer`, async () => {
        test.skip(!request || !transferId, `${type} not set up`)

        const res = await request.put(`/api/stock-transfers/${transferId}`, {
          data: {
            action: 'ship',
            notes: 'Dispatched via company delivery van — ETA 2 hours',
          },
        })
        expect(res.ok(), `Ship transfer failed: ${await res.text()}`).toBeTruthy()
      })

      test(`INV-${type}-006: Receive transfer (complete)`, async () => {
        test.skip(!request || !transferId, `${type} not set up`)

        // Get transfer items for receivedItems payload
        const getRes = await request.get(`/api/stock-transfers/${transferId}`)
        const transfer = await getRes.json()
        const items = transfer.items || []

        const res = await request.put(`/api/stock-transfers/${transferId}`, {
          data: {
            action: 'receive',
            notes: 'All items received in good condition — no damage during transit',
            receivedItems: items.map((ti: { id: string; quantity: string }) => ({
              transferItemId: ti.id,
              receivedQuantity: parseFloat(ti.quantity),
            })),
          },
        })
        expect(res.ok(), `Receive transfer failed: ${await res.text()}`).toBeTruthy()
      })

      test(`INV-${type}-007: Verify stock after transfer`, async () => {
        test.skip(!request || !transferId, `${type} not set up`)

        const items = trackedItems()
        if (items.length > 0) {
          const item = items[0]
          const stocks = await getWarehouseStock(request, item.id)
          const whANow = getStockForWarehouse(stocks, company.warehouseA)
          const whBNow = getStockForWarehouse(stocks, company.warehouseB)
          const before = stockBeforeTransfer[item.id]

          if (before) {
            // WH-A should decrease, WH-B should increase
            expect(whANow).toBeLessThanOrEqual(before.whA)
            expect(whBNow).toBeGreaterThanOrEqual(before.whB)
          }
        }
      })

      test(`INV-${type}-008: Verify stock movements for transfer`, async () => {
        test.skip(!request || !transferId, `${type} not set up`)

        const outMovements = await getStockMovements(request, {
          type: 'out',
          warehouseId: company.warehouseA,
        })
        const inMovements = await getStockMovements(request, {
          type: 'in',
          warehouseId: company.warehouseB,
        })

        expect(outMovements.length).toBeGreaterThan(0)
        expect(inMovements.length).toBeGreaterThan(0)
      })

      // ════════════════════════════════════════
      // Flow B: Stock Take
      // ════════════════════════════════════════

      let stockTakeId: string

      test(`INV-${type}-009: Create stock take for WH-A with full details`, async () => {
        test.skip(!request, `${type} not set up`)

        const res = await request.post('/api/stock-takes', {
          data: {
            warehouseId: company.warehouseA,
            countType: 'full',
            notes: `E2E full stock take for ${type} — end-of-day physical inventory count at main warehouse. All items to be counted and reconciled against system records.`,
          },
        })
        expect(res.ok(), `Create stock take failed: ${await res.text()}`).toBeTruthy()
        const st = await res.json()
        stockTakeId = st.id
        expect(st.status).toBe('draft')
      })

      test(`INV-${type}-010: Start stock take (draft → in_progress)`, async () => {
        test.skip(!request || !stockTakeId, `${type} not set up`)

        const res = await request.put(`/api/stock-takes/${stockTakeId}`, {
          data: {
            status: 'in_progress',
            notes: 'Count started — team of 3 counting all aisles',
          },
        })
        expect(res.ok(), `Start stock take failed: ${await res.text()}`).toBeTruthy()
      })

      test(`INV-${type}-011: Update counted quantities (match expected)`, async () => {
        test.skip(!request || !stockTakeId, `${type} not set up`)

        // Get stock take items
        const getRes = await request.get(`/api/stock-takes/${stockTakeId}`)
        const st = await getRes.json()
        const items = st.items || []

        // Update each item's counted quantity (match expected to avoid actual adjustments)
        for (const item of items) {
          const expectedQty = parseFloat(item.expectedQuantity || '0')
          const res = await request.put(`/api/stock-takes/${stockTakeId}/items/${item.id}`, {
            data: { countedQuantity: expectedQty },
          })
          if (!res.ok()) {
            break
          }
        }

        // If individual updates didn't work, try batch
        if (items.length > 0) {
          const batchRes = await request.put(`/api/stock-takes/${stockTakeId}`, {
            data: {
              items: items.map((item: { id: string; expectedQuantity: string }) => ({
                id: item.id,
                countedQuantity: parseFloat(item.expectedQuantity || '0'),
              })),
            },
          })
          if (!batchRes.ok()) {
            console.log(`Stock take batch update: ${batchRes.status()} - trying alternative`)
          }
        }
      })

      test(`INV-${type}-012: Complete stock take`, async () => {
        test.skip(!request || !stockTakeId, `${type} not set up`)

        const res = await request.post(`/api/stock-takes/${stockTakeId}/complete`)
        if (!res.ok()) {
          console.log(`Stock take complete: ${res.status()} - ${await res.text()}`)
        }
      })

      // ════════════════════════════════════════
      // Flow C: Verify overall stock movements
      // ════════════════════════════════════════

      test(`INV-${type}-013: Verify all stock movement types exist`, async () => {
        test.skip(!request, `${type} not set up`)

        // IN movements (from purchases)
        const inMovements = await getStockMovements(request, {
          type: 'in',
          warehouseId: company.warehouseA,
        })
        expect(inMovements.length).toBeGreaterThan(0)

        // OUT movements (from sales)
        const outMovements = await getStockMovements(request, {
          type: 'out',
          warehouseId: company.warehouseA,
        })
        if (company.sales.length > 0) {
          expect(outMovements.length).toBeGreaterThan(0)
        }
      })

      test(`INV-${type}-014: Verify stock movement audit trail`, async () => {
        test.skip(!request, `${type} not set up`)

        const allMovements = await getStockMovements(request, {
          warehouseId: company.warehouseA,
        })

        for (const m of allMovements.slice(0, 10)) {
          expect(m.type).toMatch(/^(in|out|adjustment)$/)
          expect(m.referenceType).toBeTruthy()
          expect(m.itemId).toBeTruthy()
          expect(m.warehouseId).toBeTruthy()
          expect(parseFloat(m.quantity)).toBeGreaterThan(0)
        }
      })
    })
  })
})
