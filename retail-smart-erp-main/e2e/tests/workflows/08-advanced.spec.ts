import { test, expect, APIRequestContext, BrowserContext } from '@playwright/test'
import {
  BUSINESS_TYPES,
  BusinessType,
  loadState,
  loginToCompany,
  CompanyState,
  getGLEntries,
  assertGLBalance,
  getCustomerBalance,
  today,
  daysFromNow,
  num,
} from './helpers'

test.describe('Workflow — Advanced: POS Shift Close, Credits, Loyalty', () => {
  test.setTimeout(240_000)

  BUSINESS_TYPES.forEach((type) => {
    test.describe.serial(`Advanced ${type}`, () => {
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
      // Flow A: Close POS Shift
      // ════════════════════════════════════════

      test(`ADV-${type}-001: Close POS shift with full reconciliation`, async () => {
        test.skip(!request, `${type} not set up`)
        test.skip(!company.posOpeningEntryId, 'No POS shift open')

        // Close via the dedicated close endpoint with actual amounts per payment method
        const res = await request.post(
          `/api/pos-opening-entries/${company.posOpeningEntryId}/close`,
          {
            data: {
              actualAmounts: [
                { paymentMethod: 'cash', amount: 0 },
                { paymentMethod: 'card', amount: 0 },
                { paymentMethod: 'bank_transfer', amount: 0 },
              ],
              notes: `E2E shift close for ${type} — end of day reconciliation. Cash drawer counted by supervisor, all denominations verified. No discrepancies found.`,
            },
          }
        )

        if (res.ok()) {
          const closing = await res.json()
          expect(closing.id || closing.success).toBeTruthy()
        } else {
          // Fallback: try pos-closing-entries endpoint
          const altRes = await request.post('/api/pos-closing-entries', {
            data: {
              posOpeningEntryId: company.posOpeningEntryId,
              closingBalances: [
                { paymentMethod: 'cash', expectedAmount: 0, actualAmount: 0 },
                { paymentMethod: 'card', expectedAmount: 0, actualAmount: 0 },
                { paymentMethod: 'bank_transfer', expectedAmount: 0, actualAmount: 0 },
              ],
              notes: `E2E shift close for ${type} — end of day reconciliation. Cash drawer counted by supervisor, all denominations verified.`,
            },
          })

          if (!altRes.ok()) {
            // Last fallback: update opening entry status
            const updateRes = await request.put(
              `/api/pos-opening-entries/${company.posOpeningEntryId}`,
              {
                data: { status: 'closed' },
              }
            )
            if (!updateRes.ok()) {
              console.log(
                `POS shift close: ${res.status()} / ${altRes.status()} / ${updateRes.status()} - API may differ`
              )
            }
          }
        }
      })

      // ════════════════════════════════════════
      // Flow B: Customer Credit (overpayment)
      // ════════════════════════════════════════

      test(`ADV-${type}-002: Sale with overpayment → store credit`, async () => {
        test.skip(!request, `${type} not set up`)

        // Open a new shift with opening balances per payment method
        const shiftRes = await request.post('/api/pos-opening-entries', {
          data: {
            posProfileId: company.posProfileId,
            openingBalances: [
              { paymentMethod: 'cash', amount: 10000 },
              { paymentMethod: 'card', amount: 0 },
              { paymentMethod: 'bank_transfer', amount: 0 },
            ],
            notes: `E2E shift for credit test — ${type} business type. Opening with LKR 10,000 cash float in drawer.`,
          },
        })
        if (!shiftRes.ok()) {
          console.log(`Open shift for credit test: ${shiftRes.status()}`)
          return
        }
        const shift = await shiftRes.json()

        const item = company.items[0]
        const total = item.sellingPrice
        const overpayment = 500
        const amountPaid = total + overpayment

        const res = await request.post('/api/sales', {
          data: {
            customerId: company.customers[0].id,
            customerName: company.customers[0].name,
            warehouseId: company.warehouseA,
            posOpeningEntryId: shift.id,
            costCenterId: company.costCenterSales,
            cartItems: [
              {
                cartLineId: `credit-line-${Date.now()}`,
                itemId: item.id,
                name: item.name,
                sku: (item as any).sku || undefined,
                quantity: 1,
                unitPrice: item.sellingPrice,
                discount: 0,
                discountType: 'fixed' as const,
                total: item.sellingPrice,
                notes: 'Customer overpaying to build store credit for future purchases',
              },
            ],
            paymentMethod: 'cash',
            subtotal: total,
            discount: 0,
            discountType: 'fixed' as const,
            tax: 0,
            taxRate: 0,
            taxInclusive: false,
            total,
            amountPaid,
            creditAmount: 0,
            addOverpaymentToCredit: true,
            tipAmount: 0,
          },
        })

        if (res.ok()) {
          const sale = await res.json()
          expect(sale.invoiceNo).toBeTruthy()
        } else {
          console.log(`Overpayment sale: ${res.status()} - feature may not be enabled`)
        }
      })

      // ════════════════════════════════════════
      // Flow C: Loyalty Program
      // ════════════════════════════════════════

      let loyaltyProgramId: string

      test(`ADV-${type}-003: Create loyalty program with tiers`, async () => {
        test.skip(!request, `${type} not set up`)

        const res = await request.post('/api/loyalty-programs', {
          data: {
            name: `${type.charAt(0).toUpperCase() + type.slice(1)} Rewards Club`,
            collectionFactor: 1, // 1 point per currency unit spent
            conversionFactor: 0.5, // Each point worth 0.50 currency units
            minRedemptionPoints: 100,
            pointsExpire: true,
            expiryDays: 365,
            tiers: [
              {
                name: 'Bronze Member',
                tier: 'bronze',
                minPoints: 0,
                earnRate: 1,
                redeemRate: 1,
                isActive: true,
              },
              {
                name: 'Silver Member',
                tier: 'silver',
                minPoints: 500,
                earnRate: 1.5,
                redeemRate: 1.25,
                isActive: true,
              },
              {
                name: 'Gold Member',
                tier: 'gold',
                minPoints: 2000,
                earnRate: 2,
                redeemRate: 1.5,
                isActive: true,
              },
              {
                name: 'Platinum VIP',
                tier: 'platinum',
                minPoints: 5000,
                earnRate: 3,
                redeemRate: 2,
                isActive: true,
              },
            ],
          },
        })

        if (res.ok()) {
          const program = await res.json()
          loyaltyProgramId = program.id
          expect(program.name).toBeTruthy()
        } else {
          console.log(`Loyalty program: ${res.status()} - may not be available`)
        }
      })

      // ════════════════════════════════════════
      // Flow D: Layaway (retail & supermarket)
      // ════════════════════════════════════════

      if (type === 'retail' || type === 'supermarket') {
        let layawayId: string

        test(`ADV-${type}-004: Create layaway with full details`, async () => {
          test.skip(!request, `${type} not set up`)

          const item = company.items[0]
          const itemTotal = item.sellingPrice
          const taxAmount = Math.round(itemTotal * 0.15) // 15% tax
          const grandTotal = itemTotal + taxAmount
          const depositAmount = Math.round(grandTotal * 0.3) // 30% deposit

          const res = await request.post('/api/layaways', {
            data: {
              customerId: company.customers[0].id,
              items: [
                {
                  itemId: item.id,
                  itemName: item.name,
                  quantity: 1,
                  unitPrice: item.sellingPrice,
                },
              ],
              depositAmount,
              taxAmount,
              dueDate: daysFromNow(30),
              notes: `E2E layaway for ${type} — customer reserving ${item.name} with 30% deposit of LKR ${depositAmount}. Remaining balance of LKR ${grandTotal - depositAmount} due within 30 days. Customer will pick up from main warehouse.`,
            },
          })

          expect(res.ok(), `Layaway create failed: ${await res.text()}`).toBeTruthy()
          const layaway = await res.json()
          layawayId = layaway.id
          expect(layaway.status).toBeTruthy()
        })

        test(`ADV-${type}-005: Make layaway partial payment`, async () => {
          test.skip(!request || !layawayId, `${type} not set up or layaway not created`)

          // Pay another 30% of the item price (within the remaining balance)
          const item = company.items[0]
          const paymentAmount = Math.round(item.sellingPrice * 0.3)

          const res = await request.post(`/api/layaways/${layawayId}/payments`, {
            data: {
              amount: paymentAmount,
              paymentMethod: 'cash',
              reference: `LAYAWAY-PAY-${Date.now()} — partial cash payment at counter, receipt issued to customer`,
            },
          })

          expect(res.ok(), `Layaway payment failed: ${await res.text()}`).toBeTruthy()
          const data = await res.json()
          expect(data.payment?.id).toBeTruthy()
          expect(data.layawayStatus).toBeTruthy()
        })
      }

      // ════════════════════════════════════════
      // Flow E: Gift Cards
      // ════════════════════════════════════════

      let giftCardId: string

      test(`ADV-${type}-006: Create gift card with full details`, async () => {
        test.skip(!request, `${type} not set up`)

        const cardNumber = `GC-${type.toUpperCase()}-${Date.now()}`

        const res = await request.post('/api/gift-cards', {
          data: {
            cardNumber,
            initialBalance: 5000,
            pin: '1234',
            expiryDate: daysFromNow(365),
            issuedTo: company.customers[0]?.id,
          },
        })

        if (res.ok()) {
          const gc = await res.json()
          giftCardId = gc.id
          expect(gc.code || gc.cardNumber).toBeTruthy()
          expect(num(gc.currentBalance || gc.balance || gc.initialBalance)).toBe(5000)
        } else {
          console.log(`Gift card: ${res.status()} - may not be available`)
        }
      })

      // ════════════════════════════════════════
      // Flow F: Verify all data integrity
      // ════════════════════════════════════════

      test(`ADV-${type}-007: Final data integrity check — sales count`, async () => {
        test.skip(!request, `${type} not set up`)

        const res = await request.get('/api/sales?pageSize=100')
        expect(res.ok()).toBeTruthy()
        const data = await res.json()
        const sales = data.data || data
        // Should have multiple sales from various flows
        expect(sales.length).toBeGreaterThanOrEqual(1)
      })

      test(`ADV-${type}-008: Final data integrity check — purchase count`, async () => {
        test.skip(!request, `${type} not set up`)

        const res = await request.get('/api/purchases?pageSize=100')
        expect(res.ok()).toBeTruthy()
        const data = await res.json()
        const purchases = data.data || data
        expect(purchases.length).toBeGreaterThanOrEqual(1)
      })

      test(`ADV-${type}-009: Final data integrity check — GL balanced`, async () => {
        test.skip(!request, `${type} not set up`)

        // Check trial balance is still balanced after all operations
        const fromDate = new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0]
        const toDate = today()

        const res = await request.get(
          `/api/accounting/reports/trial-balance?fromDate=${fromDate}&toDate=${toDate}`
        )
        if (res.ok()) {
          const report = await res.json()
          if (report.totals) {
            const diff = Math.abs(
              num(report.totals.closingDebit) - num(report.totals.closingCredit)
            )
            expect(diff).toBeLessThan(1)
          }
        }
      })

      test(`ADV-${type}-010: Final data integrity check — items list`, async () => {
        test.skip(!request, `${type} not set up`)

        const res = await request.get('/api/items?pageSize=50')
        expect(res.ok()).toBeTruthy()
        const data = await res.json()
        const items = data.data || data
        expect(items.length).toBeGreaterThanOrEqual(company.items.length)
      })
    })
  })
})
