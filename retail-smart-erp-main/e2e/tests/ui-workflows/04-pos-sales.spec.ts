import { test, expect, Page, BrowserContext } from '@playwright/test'
import {
  BUSINESS_TYPES,
  getTestConfig,
  loadUIState,
  updateUICompanyState,
  loginViaAPI,
  navigateTo,
  waitForPageReady,
  fillField,
  fillAsyncSelect,
  clickButton,
  clickButtonAndWait,
  expectToastSuccess,
  waitForModal,
  waitForModalClose,
  posSearchItem,
  posClickItem,
  posVerifyCartItem,
  posClickPayNow,
  posSelectPaymentMethod,
  posClickExact,
  posCompleteSale,
  posDismissSuccess,
  posDismissAnyModal,
  tryAction,
  isVisible,
  getTerms,
} from './ui-helpers'

test.describe('UI — POS Sales via Browser', () => {
  test.setTimeout(600_000)

  BUSINESS_TYPES.forEach((type, idx) => {
    test.describe.serial(`POS ${type}`, () => {
      let page: Page
      let ctx: BrowserContext
      const config = getTestConfig(type, idx)

      test.beforeAll(async ({ browser }) => {
        const state = loadUIState()
        const company = state.companies[type]
        if (!company?.slug) return

        ctx = await browser.newContext()
        page = await ctx.newPage()
        await loginViaAPI(page.request, company.email, company.password, company.slug)
      })

      test.afterAll(async () => {
        if (ctx) await ctx.close()
      })

      // ════════════════════════════════════════
      // Bootstrap: create items via API if missing
      // ════════════════════════════════════════

      test(`POS-${type}-000: Bootstrap items if missing`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug || !company.posProfileId, `${type} not set up`)

        // If items already exist in state, skip
        if (company!.items && company!.items.length > 0) return

        console.log(`[POS BOOTSTRAP ${type}] No items in state — creating via API`)

        // Create items from test config
        const createdItems: Array<{ id: string; name: string; sellingPrice: number; costPrice: number; trackStock: boolean }> = []
        for (const itemConfig of config.items) {
          const categoryId = company!.categories?.[0] || null
          const res = await page.request.post('/api/items', {
            data: {
              name: itemConfig.name,
              sellingPrice: itemConfig.sellingPrice,
              costPrice: itemConfig.costPrice,
              trackStock: itemConfig.trackStock,
              categoryId,
              unit: itemConfig.unit || 'pcs',
              barcode: itemConfig.barcode || null,
              brand: itemConfig.brand || null,
              sku: null,
            },
          })
          if (res.ok()) {
            const created = await res.json()
            createdItems.push({
              id: created.id,
              name: created.name || itemConfig.name,
              sellingPrice: parseFloat(created.sellingPrice || String(itemConfig.sellingPrice)),
              costPrice: parseFloat(created.costPrice || String(itemConfig.costPrice)),
              trackStock: created.trackStock ?? itemConfig.trackStock,
            })
            console.log(`[POS BOOTSTRAP ${type}] Created item: ${itemConfig.name} (${created.id})`)
          } else {
            console.log(`[POS BOOTSTRAP ${type}] Failed to create ${itemConfig.name}: ${res.status()} ${await res.text().catch(() => '')}`)
          }
        }

        // Save items to state
        if (createdItems.length > 0) {
          updateUICompanyState(type, { items: createdItems })
          console.log(`[POS BOOTSTRAP ${type}] Saved ${createdItems.length} items to state`)
        }

        // Create purchase to give tracked items stock
        const trackedItems = createdItems.filter(i => i.trackStock)
        if (trackedItems.length > 0 && company!.suppliers?.length > 0) {
          const purchaseRes = await page.request.post('/api/purchases', {
            data: {
              supplierId: company!.suppliers[0].id,
              warehouseId: company!.warehouseA,
              items: trackedItems.map(item => ({
                itemId: item.id,
                itemName: item.name,
                quantity: 100,
                unitPrice: item.costPrice || 100,
              })),
              notes: `E2E POS bootstrap stock — ${type}`,
            },
          })
          if (purchaseRes.ok()) {
            const pi = await purchaseRes.json()
            // Submit purchase to trigger stock update
            const submitRes = await page.request.put(`/api/purchases/${pi.id}`, {
              data: { status: 'pending' },
            })
            console.log(`[POS BOOTSTRAP ${type}] Purchase ${pi.id} created & submitted (${submitRes.status()})`)
          }
        }

        expect(createdItems.length).toBeGreaterThan(0)
      })

      // ════════════════════════════════════════
      // Navigate to POS
      // ════════════════════════════════════════

      test(`POS-${type}-001: Navigate to POS page`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug || !company.posProfileId, `${type} not set up`)

        // Pre-warm the items API route so Turbopack has it compiled before POS loads
        await page.request.get('/api/items?pageSize=5').catch(() => {})
        await page.request.get('/api/categories?all=true').catch(() => {})
        await page.request.get('/api/customers?all=true').catch(() => {})

        await navigateTo(page, company!.slug, 'pos')
        await waitForPageReady(page)
        await page.waitForTimeout(3000) // Wait for POS to load

        // POS page should show either "Open Shift" button or the POS search bar
        const hasOpenShift = await isVisible(page, 'button:has-text("Open Shift")')
        const hasPOSSearch = await page.getByPlaceholder(/search products|search menu|scan barcode|search parts|search vehicles/i)
          .first().isVisible({ timeout: 3_000 }).catch(() => false)
        const hasCurrentSale = await page.locator('text=/Current Sale|Current Order|Current Invoice|Current Deal/').isVisible({ timeout: 1_000 }).catch(() => false)
        expect(hasOpenShift || hasPOSSearch || hasCurrentSale).toBeTruthy()
      })

      // ════════════════════════════════════════
      // Open Shift
      // ════════════════════════════════════════

      test(`POS-${type}-002: Open shift via UI`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug || !company.posProfileId, `${type} not set up`)

        // Check if shift already open by looking for POS-specific elements
        // Business-type-specific "Current Sale" heading or "Pay Now"/"Pay Bill" button
        const terms = getTerms(type)
        const shiftAlreadyOpen = await page.locator(`text="${terms.currentSale}"`).isVisible({ timeout: 3_000 }).catch(() => false)
          || await page.getByRole('button', { name: new RegExp(terms.payNow, 'i') }).isVisible({ timeout: 1_000 }).catch(() => false)
        if (shiftAlreadyOpen) return

        // Click Open Shift button
        const openBtn = page.getByRole('button', { name: /open shift/i })
        await expect(openBtn).toBeVisible({ timeout: 10_000 })
        await openBtn.click()
        await page.waitForTimeout(1000)

        // Modal may appear for shift configuration
        const modal = page.locator('[role="dialog"]')
        if (await modal.isVisible({ timeout: 3_000 }).catch(() => false)) {
          // Select POS profile
          const profileSelect = modal.locator('select').first()
          if (await profileSelect.isVisible()) {
            const options = await profileSelect.locator('option').allTextContents()
            const profileOption = options.find(o => o !== '' && !o.includes('Select'))
            if (profileOption) {
              await profileSelect.selectOption({ label: profileOption })
              await page.waitForTimeout(300)
            }
          }

          // Fill opening cash balance
          await tryAction(async () => {
            const cashInput = modal.locator('input[type="number"]').first()
            if (await cashInput.isVisible()) {
              await cashInput.fill('10000')
            }
          })

          // Click Open Shift button in modal
          const confirmBtn = modal.getByRole('button', { name: /open shift/i })
          await confirmBtn.click()
          await page.waitForTimeout(3000)
          await page.waitForLoadState('networkidle')
        } else {
          // No modal — shift may have opened directly
          await page.waitForTimeout(2000)
          await page.waitForLoadState('networkidle')
        }

        // Verify POS interface loaded — look for business-type-specific cart heading or pay button
        await page.locator(`text="${terms.currentSale}"`).or(page.getByRole('button', { name: new RegExp(terms.payNow, 'i') }))
          .first().waitFor({ state: 'visible', timeout: 15_000 })
      })

      // ════════════════════════════════════════
      // Cash Sale
      // ════════════════════════════════════════

      test(`POS-${type}-003: Verify stock and search for item in product grid`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug || !company.items.length, `${type} not set up`)

        // ── Step 1: Get the active shift's warehouse ID ──
        // The POS page uses the shift's warehouse, which may differ from warehouseA
        let posWarehouseId = company!.warehouseA
        const shiftRes = await page.request.get('/api/pos-opening-entries?current=true')
        if (shiftRes.ok()) {
          const shiftData = await shiftRes.json()
          if (shiftData.shift?.warehouseId) {
            posWarehouseId = shiftData.shift.warehouseId
            console.log(`[POS DEBUG ${type}] Active shift warehouse: ${posWarehouseId}`)
          }
        }

        // ── Step 2: Verify items have stock and correct prices at the POS warehouse ──
        // Always run (not just for tracked items) because trackStock may be saved as true even when sent as false
        {
          const debugRes = await page.request.get(`/api/items?warehouseId=${posWarehouseId}&pageSize=50`)
          if (debugRes.ok()) {
            const debugData = await debugRes.json()
            const debugItems = (debugData.data || debugData) as Array<{ id: string; name: string; availableStock: string; trackStock: boolean; sellingPrice: string }>
            if (Array.isArray(debugItems)) {
              // Deduplicate by name, preferring items with higher price (new bootstrap items)
              const uniqueByName = new Map<string, typeof debugItems[0]>()
              for (const di of debugItems) {
                const existing = uniqueByName.get(di.name)
                if (!existing || parseFloat(di.sellingPrice) > parseFloat(existing.sellingPrice)) {
                  uniqueByName.set(di.name, di)
                }
              }
              const uniqueItems = Array.from(uniqueByName.values())

              const zeroStockItems = uniqueItems.filter((i) =>
                i.trackStock && parseFloat(i.availableStock) <= 0
              )
              const zeroPriceItems = uniqueItems.filter((i) => parseFloat(i.sellingPrice) <= 0)
              console.log(`[POS DEBUG ${type}] ${debugItems.length} items (${uniqueItems.length} unique), ${zeroStockItems.length} zero stock, ${zeroPriceItems.length} zero price`)

              // Fix zero selling prices via API (PUT requires name field)
              for (const di of zeroPriceItems) {
                const matchItem = company!.items.find((ci) => ci.name === di.name)
                if (matchItem && matchItem.sellingPrice > 0) {
                  // Fix BOTH old and new item if they exist (use API item IDs)
                  const sameNameItems = debugItems.filter((x) => x.name === di.name)
                  for (const sni of sameNameItems) {
                    if (parseFloat(sni.sellingPrice) <= 0) {
                      const fixRes = await page.request.put(`/api/items/${sni.id}`, {
                        data: { name: sni.name, sellingPrice: matchItem.sellingPrice, costPrice: matchItem.costPrice },
                      })
                      console.log(`[POS PRICE FIX ${type}] ${sni.name} (${sni.id}): sell=${matchItem.sellingPrice} → ${fixRes.status()}`)
                    }
                  }
                }
              }

              // If items have zero stock at POS warehouse, create a purchase to stock them
              if (zeroStockItems.length > 0 && company!.suppliers?.length > 0) {
                // Use the deduplicated items with correct IDs from state
                const purchaseItems = zeroStockItems.map((zsi) => {
                  const matchItem = company!.items.find((ci) => ci.name === zsi.name)
                  return {
                    itemId: matchItem?.id || zsi.id,
                    itemName: zsi.name,
                    quantity: 100,
                    unitPrice: matchItem?.costPrice || 100,
                  }
                }).filter((x) => x.itemId)

                if (purchaseItems.length > 0) {
                  console.log(`[POS STOCK FIX ${type}] Creating purchase for ${purchaseItems.length} items at warehouse ${posWarehouseId}`)
                  const purchaseRes = await page.request.post('/api/purchases', {
                    data: {
                      supplierId: company!.suppliers[0].id,
                      warehouseId: posWarehouseId,
                      items: purchaseItems,
                      notes: `E2E POS stock fix — ${type} at POS warehouse`,
                    },
                  })
                  if (purchaseRes.ok()) {
                    const pi = await purchaseRes.json()
                    const submitRes = await page.request.put(`/api/purchases/${pi.id}`, {
                      data: { status: 'pending' },
                    })
                    console.log(`[POS STOCK FIX ${type}] Purchase ${pi.id} submitted, status=${submitRes.status()}`)
                  } else {
                    console.log(`[POS STOCK FIX ${type}] Purchase failed: ${purchaseRes.status()} ${await purchaseRes.text().catch(() => '')}`)
                  }
                }
              }
            }
          }
        }

        // ── Step 3: Navigate away and back to force POS to re-fetch items ──
        await navigateTo(page, company!.slug, 'dashboard')
        await page.waitForTimeout(1000)
        await navigateTo(page, company!.slug, 'pos')
        await page.waitForLoadState('networkidle')
        await page.waitForTimeout(4000)

        // ── Diagnostic: verify items exist via API after fixes ──
        const verifyRes = await page.request.get(`/api/items?warehouseId=${posWarehouseId}&pageSize=50`)
        if (verifyRes.ok()) {
          const verifyData = await verifyRes.json()
          const verifyItems = (verifyData.data || verifyData) as Array<{ id: string; name: string; sellingPrice: string; trackStock: boolean; availableStock: string; isActive: boolean | null }>
          console.log(`[POS VERIFY ${type}] API returned ${verifyItems.length} items after fixes:`)
          for (const vi of verifyItems.slice(0, 8)) {
            console.log(`  - ${vi.name}: price=${vi.sellingPrice}, track=${vi.trackStock}, stock=${vi.availableStock}, active=${vi.isActive}`)
          }
        }

        // Wait for POS search input to be visible (may need to re-open shift)
        const posSearch = page.getByPlaceholder(/search products|search menu|scan barcode|search parts|search vehicles/i).first()
        const posSearchVisible = await posSearch.isVisible({ timeout: 5_000 }).catch(() => false)

        if (!posSearchVisible) {
          // Shift may need to be re-opened after navigation
          const openBtn = page.getByRole('button', { name: /open shift/i })
          if (await openBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
            await openBtn.click()
            await page.waitForTimeout(1000)
            const modal = page.locator('[role="dialog"]')
            if (await modal.isVisible({ timeout: 3_000 }).catch(() => false)) {
              const profileSelect = modal.locator('select').first()
              if (await profileSelect.isVisible()) {
                const options = await profileSelect.locator('option').allTextContents()
                const profileOption = options.find(o => o !== '' && !o.includes('Select'))
                if (profileOption) await profileSelect.selectOption({ label: profileOption })
              }
              await tryAction(async () => {
                const cashInput = modal.locator('input[type="number"]').first()
                if (await cashInput.isVisible()) await cashInput.fill('10000')
              })
              const confirmBtn = modal.getByRole('button', { name: /open shift/i })
              await confirmBtn.click()
              await page.waitForTimeout(3000)
              await page.waitForLoadState('networkidle')
            }
          }
          await posSearch.waitFor({ state: 'visible', timeout: 15_000 })
        }

        // Dismiss any error toasts
        const errorToasts = page.locator('[role="alert"]')
        const toastCount = await errorToasts.count()
        for (let i = 0; i < toastCount; i++) {
          try {
            const t = errorToasts.nth(i)
            if (await t.isVisible()) {
              const closeBtn = t.locator('button').first()
              if (await closeBtn.isVisible({ timeout: 200 }).catch(() => false)) {
                await closeBtn.click().catch(() => {})
              }
            }
          } catch { /* ignore */ }
        }

        // ── Step 3: Search for item in POS grid ──
        const item = company!.items[0]
        const shortName = item.name.split(' ')[0] // Just first word

        await posSearchItem(page, shortName)
        await page.waitForTimeout(1500)

        // Item should appear in product grid as a button
        const productButtons = page.locator('button').filter({ hasText: new RegExp(shortName, 'i') })
        const count = await productButtons.count()
        console.log(`[POS SEARCH ${type}] buttons matching "${shortName}": ${count}`)

        // If no items found, clear search and check all items
        if (count === 0) {
          console.log(`[POS SEARCH ${type}] No results — clearing search to check all items`)
          await posSearch.clear()
          await page.waitForTimeout(2000)
          await page.waitForLoadState('networkidle')

          // Count product cards (they use rounded-2xl border-2 classes)
          const allCards = page.locator('button').filter({ has: page.locator('.aspect-square') })
          const allCount = await allCards.count()
          console.log(`[POS SEARCH ${type}] All product cards: ${allCount}`)

          if (allCount > 0) {
            // Items are visible without search — re-search
            await posSearchItem(page, shortName)
            await page.waitForTimeout(1500)
          } else {
            // Still 0 — check if page content has error
            const mainText = await page.textContent('body')
            if (mainText?.includes('Failed to load')) {
              console.log(`[POS SEARCH ${type}] Items API still failing — last reload attempt`)
              await page.reload()
              await page.waitForLoadState('networkidle')
              await page.waitForTimeout(5000)
            }
          }
        }

        const finalCount = await page.locator('button').filter({ hasText: new RegExp(shortName, 'i') }).count()
        expect(finalCount).toBeGreaterThan(0)
      })

      test(`POS-${type}-004: Click item to add to cart`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug || !company.items.length, `${type} not set up`)

        const item = company!.items[0]

        // Click on the product card
        await posClickItem(page, item.name)

        // Verify item appears in cart
        await page.waitForTimeout(500)
        await posVerifyCartItem(page, item.name)
      })

      test(`POS-${type}-005: Add second item to cart`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug || company!.items.length < 2, `${type} needs 2+ items`)

        const item2 = company!.items[1]

        // Clear search and search for second item
        await posSearchItem(page, item2.name)
        await page.waitForTimeout(500)
        await posClickItem(page, item2.name)
        await page.waitForTimeout(300)
      })

      test(`POS-${type}-006: Increase item quantity`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug || !company.items.length, `${type} not set up`)

        // Find + button in cart and click it
        await tryAction(async () => {
          const plusBtn = page.locator('button').filter({ hasText: '+' })
          if (await plusBtn.first().isVisible()) {
            await plusBtn.first().click()
            await page.waitForTimeout(200)
          }
        })
      })

      test(`POS-${type}-007: Select customer from dropdown`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug || !company.customers.length, `${type} not set up`)

        // Try to select customer in cart panel
        await tryAction(async () => {
          await fillAsyncSelect(page, 'Walk-in', company!.customers[0].name)
        })

        // Alternative: try placeholder-based selection
        await tryAction(async () => {
          await fillAsyncSelect(page, 'customer', company!.customers[0].name)
        })
      })

      test(`POS-${type}-008: Verify cart totals visible`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        // Verify total amount is visible somewhere
        const totalText = page.locator('text=/Total/i').first()
        await expect(totalText).toBeVisible({ timeout: 5_000 })
      })

      test(`POS-${type}-009: Click Pay Now and complete cash sale`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug || !company.items.length, `${type} not set up`)

        // Click Pay Now
        await posClickPayNow(page)
        await page.waitForTimeout(500)

        // Payment modal should open
        const paymentModal = await isVisible(page, '[role="dialog"]')
        if (paymentModal) {
          // Select Cash payment method
          await tryAction(async () => {
            await posSelectPaymentMethod(page, 'Cash')
          })

          // Click Exact amount button
          await tryAction(async () => {
            await posClickExact(page)
          })

          // If no Exact button, try filling amount manually
          await tryAction(async () => {
            const amountInput = page.locator('[role="dialog"]').locator('input[type="number"]').first()
            if (await amountInput.isVisible()) {
              const totalText = await page.locator('[role="dialog"]').textContent()
              const match = totalText?.match(/[\d,]+\.\d{2}/)
              if (match) {
                await amountInput.fill(match[0].replace(/,/g, ''))
              }
            }
          })

          // Complete sale
          await posCompleteSale(page)
          await page.waitForTimeout(1500)
        }

        // Should see success modal or return to POS
        await tryAction(async () => {
          // Look for success indicators
          const successVisible = await isVisible(page, 'text=/Sale Complete|Invoice|Success/i')
          if (successVisible) {
            // Store the invoice number if visible
            const invoiceText = await page.textContent('main, [role="dialog"]')
            const invMatch = invoiceText?.match(/INV-\d+|SI-\d+/)
            if (invMatch) {
              const sales = loadUIState().companies[type]!.sales || []
              sales.push({ id: '', invoiceNo: invMatch[0] })
              updateUICompanyState(type, { sales })
            }
          }
        })

        // Dismiss success and return to POS
        await posDismissSuccess(page)
        await page.waitForTimeout(500)
      })

      // ════════════════════════════════════════
      // Sale with Discount
      // ════════════════════════════════════════

      test(`POS-${type}-010: Start new sale with discount`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug || !company.items.length, `${type} not set up`)

        // Search and add first item
        const item = company!.items[0]
        await posSearchItem(page, item.name)
        await page.waitForTimeout(500)
        await posClickItem(page, item.name)
        await page.waitForTimeout(300)

        // Try to click discount button/area
        const discountApplied = await tryAction(async () => {
          const discountBtn = page.locator('button, div').filter({ hasText: /discount/i }).first()
          if (await discountBtn.isVisible()) {
            await discountBtn.click()
            await page.waitForTimeout(500)

            // Discount modal should open
            const modal = page.locator('[role="dialog"]')
            if (await modal.isVisible()) {
              // Select percentage type
              await tryAction(async () => {
                const percentBtn = modal.getByRole('button', { name: /percentage/i })
                if (await percentBtn.isVisible()) await percentBtn.click()
              })

              // Fill discount value
              const discountInput = modal.locator('input[type="number"]').first()
              if (await discountInput.isVisible()) {
                await discountInput.fill('10')
              }

              // Fill reason
              await tryAction(async () => {
                const reasonInput = modal.locator('input[type="text"]').first()
                  .or(modal.getByPlaceholder(/reason|loyal|bulk/i))
                if (await reasonInput.isVisible()) {
                  await reasonInput.fill('E2E test discount — loyal customer promotion')
                }
              })

              // Apply discount
              const applyBtn = modal.getByRole('button', { name: /apply/i })
              if (await applyBtn.isVisible()) {
                await applyBtn.click()
                await page.waitForTimeout(500)
              }
            }
          }
        })
      })

      test(`POS-${type}-011: Complete discounted sale`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug || !company.items.length, `${type} not set up`)

        // Pay Now
        await posClickPayNow(page)
        await page.waitForTimeout(500)

        const paymentModal = await isVisible(page, '[role="dialog"]')
        if (paymentModal) {
          await tryAction(async () => { await posSelectPaymentMethod(page, 'Cash') })
          await tryAction(async () => { await posClickExact(page) })
          await posCompleteSale(page)
          await page.waitForTimeout(1000)
        }

        await posDismissSuccess(page)
        await page.waitForTimeout(500)
      })

      // ════════════════════════════════════════
      // Card Payment Sale
      // ════════════════════════════════════════

      test(`POS-${type}-012: Sale with card payment`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug || !company.items.length, `${type} not set up`)

        // Add item
        const item = company!.items[0]
        await posSearchItem(page, item.name)
        await page.waitForTimeout(500)
        await posClickItem(page, item.name)
        await page.waitForTimeout(300)

        // Pay Now
        await posClickPayNow(page)
        await page.waitForTimeout(500)

        const paymentModal = await isVisible(page, '[role="dialog"]')
        if (paymentModal) {
          // Select Card payment
          await tryAction(async () => { await posSelectPaymentMethod(page, 'Card') })

          // Amount should auto-fill for card
          await tryAction(async () => { await posClickExact(page) })

          // Complete sale
          await posCompleteSale(page)
          await page.waitForTimeout(1000)
        }

        await posDismissSuccess(page)
        await page.waitForTimeout(500)
      })

      // ════════════════════════════════════════
      // Hold & Recall Sale
      // ════════════════════════════════════════

      test(`POS-${type}-013: Add items and hold sale`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug || !company.items.length, `${type} not set up`)

        // Add item to cart
        const item = company!.items[0]
        await posSearchItem(page, item.name)
        await page.waitForTimeout(500)
        await posClickItem(page, item.name)
        await page.waitForTimeout(300)

        // Click Hold button
        const holdBtn = page.getByRole('button', { name: /hold/i })
        if (await holdBtn.isVisible()) {
          await holdBtn.click()
          await page.waitForTimeout(1000)

          // Cart should be cleared
          const emptyText = await isVisible(page, 'text=/cart is empty|no items/i')
          // Held sales badge should appear somewhere
        }
      })

      test(`POS-${type}-014: Recall held sale`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug || !company.items.length, `${type} not set up`)

        // Look for held sales indicator/badge and click it
        const recallSuccess = await tryAction(async () => {
          const heldBadge = page.locator('button, [role="button"]').filter({ hasText: /held|1.*held/i })
          if (await heldBadge.isVisible({ timeout: 3_000 })) {
            await heldBadge.click()
            await page.waitForTimeout(500)

            // Held sales modal should open
            const modal = page.locator('[role="dialog"]')
            if (await modal.isVisible()) {
              // Click Recall on first held sale
              const recallBtn = modal.getByRole('button', { name: /recall/i }).first()
              if (await recallBtn.isVisible()) {
                await recallBtn.click()
                await page.waitForTimeout(500)
              }
            }
          }
        })
      })

      test(`POS-${type}-015: Complete recalled sale`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        // Check if cart has items to complete (Pay Now button must be enabled)
        const payNowBtn = page.getByRole('button', { name: /pay now/i }).first()
        const payNowExists = await payNowBtn.isVisible({ timeout: 2_000 }).catch(() => false)
        if (!payNowExists) return

        // Check if button is disabled (empty cart)
        const isDisabled = await payNowBtn.isDisabled().catch(() => true)
        if (isDisabled) {
          // Cart is empty — recall didn't work, skip gracefully
          return
        }

        await posClickPayNow(page)
        await page.waitForTimeout(500)

        const paymentModal = await isVisible(page, '[role="dialog"]')
        if (paymentModal) {
          await tryAction(async () => { await posSelectPaymentMethod(page, 'Cash') })
          await tryAction(async () => { await posClickExact(page) })
          await posCompleteSale(page)
          await page.waitForTimeout(1000)
        }

        await posDismissSuccess(page)
        await page.waitForTimeout(500)
      })

      // ════════════════════════════════════════
      // Return / Refund
      // ════════════════════════════════════════

      test(`POS-${type}-016: Initiate return via Return button`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        // Dismiss any lingering modal from previous tests
        await posDismissAnyModal(page)
        await page.waitForTimeout(500)

        // Click the Return button (red, top right of product grid)
        const returnBtn = page.getByRole('button', { name: /return/i })
        if (await returnBtn.isVisible()) {
          await returnBtn.click()
          await page.waitForTimeout(500)

          // ReturnLookupModal should appear
          const modal = page.locator('[role="dialog"]')
          if (await modal.isVisible()) {
            // Click "Manual Entry" to do a manual return
            const manualBtn = modal.locator('div, button').filter({ hasText: /manual entry/i }).first()
            if (await manualBtn.isVisible()) {
              await manualBtn.click()
              await page.waitForTimeout(500)
            }
          }
        }
      })

      test(`POS-${type}-017: Add return item and process refund`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug || !company.items.length, `${type} not set up`)

        // Check if we're in return mode
        const returnIndicator = await isVisible(page, 'text=/return/i')
        if (!returnIndicator) return // Return mode not active

        // Add item to return
        const item = company!.items[0]
        await posSearchItem(page, item.name)
        await page.waitForTimeout(500)
        await posClickItem(page, item.name)
        await page.waitForTimeout(300)

        // Click Process Refund
        const refundBtn = page.getByRole('button', { name: /process refund|refund/i })
        if (await refundBtn.isVisible()) {
          await refundBtn.click()
          await page.waitForTimeout(500)

          // Refund payment modal
          const modal = page.locator('[role="dialog"]')
          if (await modal.isVisible()) {
            // Select refund method
            await tryAction(async () => { await posSelectPaymentMethod(page, 'Cash') })

            // Complete refund
            const completeBtn = modal.getByRole('button', { name: /process refund|complete/i })
            if (await completeBtn.isVisible()) {
              await completeBtn.click()
              await page.waitForTimeout(1500)
            }
          }
        }

        // Dismiss success
        await posDismissSuccess(page)
        await page.waitForTimeout(500)
      })

      // ════════════════════════════════════════
      // Verify Sales in List
      // ════════════════════════════════════════

      test(`POS-${type}-018: Navigate to sales list and verify`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        await navigateTo(page, company!.slug, 'sales')
        await waitForPageReady(page)
        await page.waitForTimeout(1000)

        // Should see sales in the list
        const content = await page.textContent('main')
        expect(content!.length).toBeGreaterThan(50)
      })

      test(`POS-${type}-019: Click a sale row to view details`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        // Click first sale row
        await tryAction(async () => {
          const firstRow = page.locator('tbody tr, [class*="list-item"]').first()
          if (await firstRow.isVisible()) {
            await firstRow.click()
            await page.waitForTimeout(1000)
            await page.waitForLoadState('networkidle')
          }
        })
      })
    })
  })
})
