import { test, expect, Page, BrowserContext } from '@playwright/test'
import {
  BUSINESS_TYPES,
  BusinessType,
  getTestConfig,
  getTerms,
  loadUIState,
  updateUICompanyState,
  loginViaAPI,
  navigateTo,
  waitForPageReady,
  waitForModal,
  waitForModalClose,
  fillField,
  fillFieldIn,
  selectOption,
  selectOptionIn,
  fillAsyncSelect,
  fillAsyncSelectIn,
  fillDate,
  setCheckbox,
  clickTab,
  clickTabIn,
  clickButton,
  expectToastSuccess,
  dismissAllToasts,
  expectRowWithText,
  tryAction,
} from './ui-helpers'

test.describe('UI — Master Data: Categories, Items, Customers, Suppliers', () => {
  test.setTimeout(600_000)

  BUSINESS_TYPES.forEach((type, idx) => {
    test.describe.serial(`Master Data ${type}`, () => {
      let page: Page
      let ctx: BrowserContext
      const config = getTestConfig(type, idx)
      const terms = getTerms(type)

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
      // Categories via UI Modal
      // ════════════════════════════════════════

      test(`MD-${type}-001: Navigate to categories page`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        await navigateTo(page, company!.slug, 'categories')
        await waitForPageReady(page)

        // If we got redirected to setup wizard, skip this and subsequent tests
        if (page.url().includes('/setup')) {
          test.skip(true, 'Setup wizard not completed')
        }
      })

      for (let i = 0; i < config.categories.length; i++) {
        test(`MD-${type}-002-${i}: Create category "${config.categories[i]}" via UI`, async () => {
          const state = loadUIState()
          const company = state.companies[type]
          test.skip(!company?.slug, `${type} not set up`)

          // First check if category already exists (setup wizard may have created it)
          const existingCat = await page.evaluate(async (name) => {
            const res = await fetch('/api/categories?all=true')
            if (!res.ok) return null
            const data = await res.json()
            const list = Array.isArray(data) ? data : data.data || []
            return list.find((c: { name: string; id: string }) => c.name === name) || null
          }, config.categories[i])

          if (existingCat) {
            const current = loadUIState()
            const categories = current.companies[type]!.categories || []
            if (!categories.includes(existingCat.id)) {
              categories.push(existingCat.id)
              updateUICompanyState(type, { categories })
            }
            return
          }

          // Category doesn't exist yet — create via UI
          await clickButton(page, terms.addCategory)
          await waitForModal(page)

          // Fill category name
          const modal = page.locator('[role="dialog"]').first()
          const nameInput = modal.locator('input[type="text"]').first()
          await nameInput.fill(config.categories[i])

          // If second+ category, try to set parent to first category
          if (i === 1) {
            await tryAction(async () => {
              const parentSelect = modal.locator('select').first()
              if (await parentSelect.isVisible()) {
                await parentSelect.selectOption({ label: config.categories[0] })
              }
            })
          }

          // Submit — intercept POST response for category ID
          const catResponsePromise = page.waitForResponse(
            (r) => r.url().includes('/api/categories') && r.request().method() === 'POST',
            { timeout: 15_000 }
          ).catch(() => null)

          const createBtn = modal.getByRole('button', { name: /create/i })
          await createBtn.click()

          const catPostRes = await catResponsePromise
          if (catPostRes && catPostRes.ok()) {
            try {
              const created = await catPostRes.json()
              if (created?.id) {
                const current = loadUIState()
                const categories = current.companies[type]!.categories || []
                if (!categories.includes(created.id)) {
                  categories.push(created.id)
                  updateUICompanyState(type, { categories })
                }
              }
            } catch { /* response already consumed */ }
          }

          // Wait for modal to close + toast
          await waitForModalClose(page)
          await expectToastSuccess(page)

          // If modal is still open (duplicate error), close it
          const modalStillOpen = await page.locator('[role="dialog"]').isVisible().catch(() => false)
          if (modalStillOpen) {
            await page.locator('[role="dialog"] button').filter({ hasText: /cancel|close/i }).first().click().catch(() => {})
            await page.waitForTimeout(500)
          }
        })
      }

      test(`MD-${type}-003: Verify categories in table`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        // Refresh the page to see all categories
        await navigateTo(page, company!.slug, 'categories')
        await waitForPageReady(page)

        for (const catName of config.categories) {
          const row = page.locator('tbody tr, [class*="item"], .card').filter({ hasText: catName })
          await expect(row.first()).toBeVisible({ timeout: 5_000 })
        }
      })

      // ════════════════════════════════════════
      // Items via UI Modal (with all tabs)
      // ════════════════════════════════════════

      test(`MD-${type}-004: Navigate to items page`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        await navigateTo(page, company!.slug, 'items')
        await waitForPageReady(page)
      })

      for (let i = 0; i < config.items.length; i++) {
        const item = config.items[i]

        test(`MD-${type}-005-${i}: Create item "${item.name}" via UI modal`, async () => {
          const state = loadUIState()
          const company = state.companies[type]
          test.skip(!company?.slug, `${type} not set up`)

          // Check if item already exists
          const existingItem = await page.evaluate(async (name) => {
            const res = await fetch(`/api/items?search=${encodeURIComponent(name)}&pageSize=10`)
            if (!res.ok) return null
            const data = await res.json()
            const list = Array.isArray(data) ? data : data.data || []
            return list.find((it: { name: string }) => it.name === name) || null
          }, item.name)

          if (existingItem) {
            // If prices are wrong (0), fix them via API
            const existingCost = parseFloat(existingItem.costPrice || '0')
            const existingSelling = parseFloat(existingItem.sellingPrice || '0')
            if ((existingCost === 0 && item.costPrice > 0) || (existingSelling === 0 && item.sellingPrice > 0)) {
              await page.evaluate(async ({ id, costPrice, sellingPrice }) => {
                await fetch(`/api/items/${id}`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ costPrice, sellingPrice }),
                })
              }, { id: existingItem.id, costPrice: item.costPrice, sellingPrice: item.sellingPrice })
            }

            const current = loadUIState()
            const itemsList = current.companies[type]!.items || []
            if (!itemsList.find((x: { id: string }) => x.id === existingItem.id)) {
              itemsList.push({
                id: existingItem.id, name: existingItem.name,
                sellingPrice: item.sellingPrice || parseFloat(existingItem.sellingPrice || '0'),
                costPrice: item.costPrice || parseFloat(existingItem.costPrice || '0'),
                trackStock: existingItem.trackStock ?? true,
              })
              updateUICompanyState(type, { items: itemsList })
            }
            return
          }

          // Click "Add Item" (text varies by business type: "Add Product", "Add Menu Item", etc.)
          await clickButton(page, terms.addItem)
          await waitForModal(page)

          const modal = page.locator('[role="dialog"]').first()

          // ── Basic Tab ──
          // Name (autofocused, first input)
          const nameInput = modal.locator('input').first()
          await nameInput.fill(item.name)

          // SKU
          if (item.barcode) {
            await tryAction(async () => {
              const skuInput = modal.getByPlaceholder(/sku|e\.g\./i).first()
              if (await skuInput.isVisible()) await skuInput.fill(`SKU-${type.slice(0, 3).toUpperCase()}-${i}`)
            })
          }

          // Barcode
          if (item.barcode) {
            await tryAction(async () => {
              const barcodeInput = modal.getByPlaceholder(/barcode/i).first()
              if (await barcodeInput.isVisible()) await barcodeInput.fill(item.barcode!)
            })
          }

          // Category - try to select from dropdown (CreatableSelect)
          await tryAction(async () => {
            const catIndex = Math.min(i, config.categories.length - 1)
            const catSelect = modal.locator('select').filter({ has: modal.locator(`option:has-text("${config.categories[catIndex]}")`) }).first()
            if (await catSelect.isVisible()) {
              await catSelect.selectOption({ label: config.categories[catIndex] })
            }
          })

          // Brand (auto_service / dealership)
          if (item.brand) {
            await tryAction(async () => {
              const brandInput = modal.getByLabel(/brand/i).first()
              if (await brandInput.isVisible()) await brandInput.fill(item.brand!)
            })
          }

          // OEM Part Number (auto_service)
          if (item.oemPartNumber) {
            await tryAction(async () => {
              const oemInput = modal.getByLabel(/oem/i).first()
              if (await oemInput.isVisible()) await oemInput.fill(item.oemPartNumber!)
            })
          }

          // ── Pricing Tab ──
          await tryAction(async () => {
            await clickTabIn(modal, 'Pricing')
            await page.waitForTimeout(300)

            // FormLabel + FormInput NOT linked via htmlFor — use label sibling pattern
            const pricingInput = (labelText: string | RegExp) =>
              modal.locator('label').filter({ hasText: labelText }).locator('..').locator('input').first()

            const costInput = pricingInput(/Cost Price/)
            if (await costInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
              await costInput.fill(String(item.costPrice))
            }

            const sellingInput = pricingInput(/Selling Price/)
            if (await sellingInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
              await sellingInput.fill(String(item.sellingPrice))
            }
          })

          // ── Inventory Tab ──
          await tryAction(async () => {
            await clickTabIn(modal, 'Inventory')
            await page.waitForTimeout(200)

            if (item.unit) {
              const unitSelect = modal.locator('select').first()
              if (await unitSelect.isVisible()) {
                await tryAction(async () => {
                  // Try common unit names
                  const unitMap: Record<string, string> = {
                    piece: 'pcs', pcs: 'pcs', plate: 'pcs', portion: 'pcs',
                    can: 'pcs', bottle: 'pcs', set: 'pcs', roll: 'pcs',
                    loaf: 'pcs', bag: 'pcs',
                    kg: 'kg', litre: 'l', l: 'l',
                  }
                  const mapped = unitMap[item.unit!] || item.unit!
                  await unitSelect.selectOption({ value: mapped }).catch(async () => {
                    const options = await unitSelect.locator('option').allTextContents()
                    const match = options.find(o => o.toLowerCase().includes(item.unit!.toLowerCase()))
                    if (match) await unitSelect.selectOption({ label: match })
                  })
                })
              }
            }
          })

          // ── Restaurant: Dietary Tab ──
          if (type === 'restaurant' && (item.preparationTime || item.calories)) {
            await tryAction(async () => {
              await clickTabIn(modal, 'Dietary')
              await page.waitForTimeout(200)

              if (item.preparationTime) {
                const prepInput = modal.getByLabel(/preparation/i).or(modal.getByPlaceholder(/15/)).first()
                if (await prepInput.isVisible()) await prepInput.fill(String(item.preparationTime))
              }
              if (item.calories) {
                const calInput = modal.getByLabel(/calories/i).or(modal.getByPlaceholder(/kcal/i)).first()
                if (await calInput.isVisible()) await calInput.fill(String(item.calories))
              }
              if (item.allergens?.length) {
                const allergensInput = modal.getByLabel(/allergens/i).first()
                if (await allergensInput.isVisible()) await allergensInput.fill(item.allergens.join(', '))
              }
              if (item.isVegetarian) await tryAction(() => setCheckbox(modal.page(), 'Vegetarian', true))
              if (item.isVegan) await tryAction(() => setCheckbox(modal.page(), 'Vegan', true))
              if (item.isGlutenFree) await tryAction(() => setCheckbox(modal.page(), 'Gluten Free', true))
            })
          }

          // ── Supermarket: Freshness Tab ──
          if (type === 'supermarket' && (item.pluCode || item.shelfLifeDays)) {
            await tryAction(async () => {
              await clickTabIn(modal, 'Freshness')
              await page.waitForTimeout(200)

              if (item.pluCode) {
                const pluInput = modal.getByLabel(/plu/i).first()
                if (await pluInput.isVisible()) await pluInput.fill(item.pluCode)
              }
              if (item.shelfLifeDays) {
                const shelfInput = modal.getByLabel(/shelf life/i).first()
                if (await shelfInput.isVisible()) await shelfInput.fill(String(item.shelfLifeDays))
              }
            })
          }

          // ── Auto/Dealership: Supplier Tab ──
          if ((type === 'auto_service' || type === 'dealership') && item.supplierPartNumber) {
            await tryAction(async () => {
              await clickTabIn(modal, 'Supplier')
              await page.waitForTimeout(200)

              const spInput = modal.getByLabel(/supplier part/i).first()
              if (await spInput.isVisible()) await spInput.fill(item.supplierPartNumber!)
            })
          }

          // ── Physical Tab ──
          if (item.weight || item.dimensions) {
            await tryAction(async () => {
              await clickTabIn(modal, 'Physical')
              await page.waitForTimeout(200)

              if (item.weight) {
                const weightInput = modal.getByLabel(/weight/i).first()
                if (await weightInput.isVisible()) await weightInput.fill(String(item.weight))
              }
              if (item.dimensions) {
                const dimInput = modal.getByLabel(/dimensions/i).or(modal.getByPlaceholder(/L x W/i)).first()
                if (await dimInput.isVisible()) await dimInput.fill(item.dimensions)
              }
            })
          }

          // ── Submit — intercept POST response for item ID ──
          const itemResponsePromise = page.waitForResponse(
            (r) => r.url().includes('/api/items') && r.request().method() === 'POST',
            { timeout: 15_000 }
          ).catch(() => null)

          const createBtn = modal.getByRole('button', { name: /create/i })
          await createBtn.click()

          const itemPostRes = await itemResponsePromise
          if (itemPostRes && itemPostRes.ok()) {
            try {
              const created = await itemPostRes.json()
              if (created?.id) {
                const current = loadUIState()
                const itemsList = current.companies[type]!.items || []
                if (!itemsList.find((x) => x.id === created.id)) {
                  itemsList.push({
                    id: created.id,
                    name: created.name || item.name,
                    sellingPrice: parseFloat(created.sellingPrice || String(item.sellingPrice)),
                    costPrice: parseFloat(created.costPrice || String(item.costPrice)),
                    trackStock: created.trackStock || false,
                  })
                  updateUICompanyState(type, { items: itemsList })
                }
              }
            } catch { /* response already consumed */ }
          }

          // Wait for modal close + toast
          await waitForModalClose(page)
          await expectToastSuccess(page)

          // If modal still open (validation/duplicate error), close it
          if (await page.locator('[role="dialog"]').isVisible().catch(() => false)) {
            await page.locator('[role="dialog"] button').filter({ hasText: /cancel|close/i }).first().click().catch(() => {})
            await page.waitForTimeout(500)
          }
        })
      }

      test(`MD-${type}-006: Verify items in items table`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        await navigateTo(page, company!.slug, 'items')
        await waitForPageReady(page)

        // Check first item is visible
        const firstItem = config.items[0]
        await expectRowWithText(page, firstItem.name)
      })

      // ════════════════════════════════════════
      // Customers via UI Modal (with all tabs)
      // ════════════════════════════════════════

      test(`MD-${type}-007: Navigate to customers page`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        await navigateTo(page, company!.slug, 'customers')
        await waitForPageReady(page)
      })

      for (let i = 0; i < config.customers.length; i++) {
        const cust = config.customers[i]

        test(`MD-${type}-008-${i}: Create customer "${cust.name}" via UI modal`, async () => {
          const state = loadUIState()
          const company = state.companies[type]
          test.skip(!company?.slug, `${type} not set up`)

          // Check if customer already exists (search by name — phone is hardcoded, email has RUN_ID)
          try {
            const checkRes = await page.request.get(`/api/customers?search=${encodeURIComponent(cust.firstName)}&pageSize=50`)
            if (checkRes.ok()) {
              const data = await checkRes.json()
              const list = Array.isArray(data) ? data : data.data || []
              const existingCust = list.find((c: { email?: string; phone?: string; firstName?: string; name?: string }) =>
                c.email === cust.email || c.phone === cust.phone || c.firstName === cust.firstName
              )
              if (existingCust) {
                const current = loadUIState()
                const customers = current.companies[type]!.customers || []
                if (!customers.find((x: { id: string }) => x.id === existingCust.id)) {
                  customers.push({ id: existingCust.id, name: existingCust.name || `${cust.firstName} ${cust.lastName}` })
                  updateUICompanyState(type, { customers })
                }
                return
              }
            }
          } catch { /* API check failed, proceed with creation */ }

          // Click "New Customer" (or "New Guest" for restaurant, "New Buyer" for dealership)
          await clickButton(page, terms.newCustomer)
          await waitForModal(page)

          const modal = page.locator('[role="dialog"]').first()

          // Helper: find input near a label text (FormLabel + FormInput pattern)
          const inputNearLabel = (labelText: string | RegExp) =>
            modal.locator('label').filter({ hasText: labelText }).locator('..').locator('input, select, textarea').first()

          // ── Basic Tab ──
          // Type (individual or company)
          if (cust.businessType) {
            await tryAction(async () => {
              const typeSelect = modal.locator('select').first()
              if (await typeSelect.isVisible()) {
                const options = await typeSelect.locator('option').allTextContents()
                const match = options.find(o => o.toLowerCase().includes(cust.businessType!.toLowerCase()))
                if (match) await typeSelect.selectOption({ label: match })
              }
            })
          }

          // First Name — FormLabel + FormInput NOT linked via htmlFor, use label sibling
          const fnInput = inputNearLabel(/First Name/)
          await fnInput.waitFor({ state: 'visible', timeout: 5_000 })
          await fnInput.fill(cust.firstName)

          // Last Name
          await tryAction(async () => {
            const lnInput = inputNearLabel(/Last Name/)
            if (await lnInput.isVisible()) await lnInput.fill(cust.lastName)
          })

          // Company Name
          if (cust.companyName) {
            await tryAction(async () => {
              const compInput = inputNearLabel(/Company Name/)
              if (await compInput.isVisible()) await compInput.fill(cust.companyName!)
            })
          }

          // Customer Type
          if (cust.customerType) {
            await tryAction(async () => {
              const ctSelect = inputNearLabel(/Customer Type/)
              if (await ctSelect.isVisible()) {
                const ctOptions = await ctSelect.locator('option').allTextContents()
                const ctMatch = ctOptions.find(o => o.toLowerCase().includes(cust.customerType!.toLowerCase()))
                if (ctMatch) await ctSelect.selectOption({ label: ctMatch }).catch(() => {})
              }
            })
          }

          // Tax ID
          if (cust.taxId) {
            await tryAction(async () => {
              const taxInput = inputNearLabel(/Tax ID/)
              if (await taxInput.isVisible()) await taxInput.fill(cust.taxId!)
            })
          }

          // Birthday
          if (cust.birthday) {
            await tryAction(async () => {
              const bdInput = inputNearLabel(/Birthday/)
              if (await bdInput.isVisible()) await bdInput.fill(cust.birthday!)
            })
          }

          // ── Contact Tab ──
          await tryAction(async () => {
            await clickTabIn(modal, 'Contact')
            await page.waitForTimeout(200)

            const emailInput = inputNearLabel(/Email/)
            if (await emailInput.isVisible()) await emailInput.fill(cust.email)

            const phoneInput = inputNearLabel(/^Phone/)
            if (await phoneInput.isVisible()) await phoneInput.fill(cust.phone)

            if (cust.mobilePhone) {
              const mobileInput = inputNearLabel(/Mobile/)
              if (await mobileInput.isVisible()) await mobileInput.fill(cust.mobilePhone)
            }

            if (cust.referralSource) {
              const refInput = inputNearLabel(/Referral/)
              if (await refInput.isVisible()) await refInput.fill(cust.referralSource)
            }
          })

          // ── Address Tab ──
          await tryAction(async () => {
            await clickTabIn(modal, 'Address')
            await page.waitForTimeout(200)

            const addr1 = inputNearLabel(/Address Line 1/)
            if (await addr1.isVisible()) await addr1.fill(cust.addressLine1)

            if (cust.addressLine2) {
              const addr2 = inputNearLabel(/Address Line 2/)
              if (await addr2.isVisible()) await addr2.fill(cust.addressLine2)
            }

            const cityInput = inputNearLabel(/City/)
            if (await cityInput.isVisible()) await cityInput.fill(cust.city)

            const stateInput = inputNearLabel(/State/)
            if (await stateInput.isVisible()) await stateInput.fill(cust.state)

            const postalInput = inputNearLabel(/Postal/)
            if (await postalInput.isVisible()) await postalInput.fill(cust.postalCode)
          })

          // ── Business Tab ──
          await tryAction(async () => {
            await clickTabIn(modal, 'Business')
            await page.waitForTimeout(200)

            if (cust.creditLimit) {
              const clInput = inputNearLabel(/Credit Limit/)
              if (await clInput.isVisible()) await clInput.fill(String(cust.creditLimit))
            }

            if (cust.paymentTerms) {
              const ptInput = inputNearLabel(/Payment Terms/)
              if (await ptInput.isVisible()) {
                const ptOptions = await ptInput.locator('option').allTextContents()
                const ptMatch = ptOptions.find(o => o.toLowerCase().includes(cust.paymentTerms!.toLowerCase()))
                if (ptMatch) await ptInput.selectOption({ label: ptMatch }).catch(() => {})
              }
            }
          })

          // ── Notes Tab ──
          await tryAction(async () => {
            await clickTabIn(modal, 'Notes')
            await page.waitForTimeout(200)

            if (cust.notes) {
              const notesArea = modal.locator('textarea').first()
              if (await notesArea.isVisible()) await notesArea.fill(cust.notes)
            }
            if (cust.specialInstructions) {
              const siArea = modal.locator('textarea').nth(1)
              if (await siArea.isVisible()) await siArea.fill(cust.specialInstructions)
            }
          })

          // ── Submit — capture the POST response to get customer ID ──
          const custResponsePromise = page.waitForResponse(
            (r) => r.url().includes('/api/customers') && r.request().method() === 'POST',
            { timeout: 15_000 }
          ).catch(() => null)

          const createBtn = modal.getByRole('button', { name: /create/i })
          await createBtn.click()

          const custPostRes = await custResponsePromise
          let customerId: string | null = null
          let customerName: string | null = null

          if (custPostRes && custPostRes.ok()) {
            try {
              const created = await custPostRes.json()
              if (created?.id) {
                customerId = created.id
                customerName = created.name || `${cust.firstName} ${cust.lastName}`
              }
            } catch { /* response parse failed */ }
          }

          // Handle "phone already exists" or other errors — close modal and search
          if (!customerId) {
            // Check if modal is still open (creation failed)
            const modalStillOpen = await page.locator('[role="dialog"]').first().isVisible().catch(() => false)
            if (modalStillOpen) {
              // Close modal
              await page.locator('[role="dialog"]').first().getByRole('button', { name: /cancel|close/i }).first().click().catch(async () => {
                await page.locator('[role="dialog"]').first().locator('button:has(svg)').first().click().catch(() => {})
              })
              await page.waitForTimeout(500)
            }
          }

          // Wait for modal to close and toast
          if (customerId) {
            await waitForModalClose(page)
            await expectToastSuccess(page)
          }

          // Fallback: search for the customer via API
          if (!customerId) {
            try {
              const searchRes = await page.request.get(`/api/customers?search=${encodeURIComponent(cust.firstName)}&pageSize=50`)
              if (searchRes.ok()) {
                const data = await searchRes.json()
                const list = Array.isArray(data) ? data : data.data || []
                const found = list.find((c: { email?: string; phone?: string; firstName?: string }) =>
                  c.email === cust.email || c.phone === cust.phone || c.firstName === cust.firstName
                )
                if (found) {
                  customerId = found.id
                  customerName = found.name
                }
              }
            } catch { /* search failed */ }
          }

          if (customerId) {
            const current = loadUIState()
            const customers = current.companies[type]!.customers || []
            if (!customers.find((x: { id: string }) => x.id === customerId)) {
              customers.push({ id: customerId, name: customerName || `${cust.firstName} ${cust.lastName}` })
              updateUICompanyState(type, { customers })
            }
          }
        })
      }

      // ════════════════════════════════════════
      // Suppliers via UI Modal
      // ════════════════════════════════════════

      test(`MD-${type}-009: Navigate to suppliers page`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        await navigateTo(page, company!.slug, 'suppliers')
        await waitForPageReady(page)
      })

      for (let i = 0; i < config.suppliers.length; i++) {
        const supp = config.suppliers[i]

        test(`MD-${type}-010-${i}: Create supplier "${supp.name}" via UI modal`, async () => {
          const state = loadUIState()
          const company = state.companies[type]
          test.skip(!company?.slug, `${type} not set up`)

          // Check if supplier already exists
          const existingSupp = await page.evaluate(async (name) => {
            const res = await fetch(`/api/suppliers?search=${encodeURIComponent(name)}&pageSize=10`)
            if (!res.ok) return null
            const data = await res.json()
            const list = Array.isArray(data) ? data : data.data || []
            return list.find((s: { name: string }) => s.name === name) || null
          }, supp.name)

          if (existingSupp) {
            const current = loadUIState()
            const suppliers = current.companies[type]!.suppliers || []
            if (!suppliers.find((x) => x.id === existingSupp.id)) {
              suppliers.push({ id: existingSupp.id, name: existingSupp.name })
              updateUICompanyState(type, { suppliers })
            }
            return
          }

          await clickButton(page, 'Add Supplier')
          await waitForModal(page)

          const modal = page.locator('[role="dialog"]').first()

          // Basic tab - Supplier Name
          const nameInput = modal.locator('input[type="text"]').first()
          await nameInput.fill(supp.name)

          // Contact tab
          await tryAction(async () => {
            await clickTabIn(modal, 'Contact')
            await page.waitForTimeout(200)

            const emailInput = modal.getByLabel(/email/i).or(modal.getByPlaceholder(/supplier@/i)).first()
            if (await emailInput.isVisible()) await emailInput.fill(supp.email)

            const phoneInput = modal.getByLabel(/phone/i).or(modal.getByPlaceholder(/\+94/i)).first()
            if (await phoneInput.isVisible()) await phoneInput.fill(supp.phone)

            const addrArea = modal.locator('textarea').first()
            if (await addrArea.isVisible()) await addrArea.fill(supp.address)
          })

          // Tax tab
          if (supp.taxId) {
            await tryAction(async () => {
              await clickTabIn(modal, 'Tax')
              await page.waitForTimeout(200)

              const taxInput = modal.getByLabel(/tax id|vat/i).first()
              if (await taxInput.isVisible()) await taxInput.fill(supp.taxId!)

              if (supp.taxInclusive) {
                const cb = modal.getByLabel(/tax inclusive/i).first()
                if (await cb.isVisible()) await cb.check()
              }
            })
          }

          // Submit — intercept POST response for supplier ID
          const suppResponsePromise = page.waitForResponse(
            (r) => r.url().includes('/api/suppliers') && r.request().method() === 'POST',
            { timeout: 15_000 }
          ).catch(() => null)

          const createBtn = modal.getByRole('button', { name: /create/i })
          await createBtn.click()

          const suppPostRes = await suppResponsePromise
          if (suppPostRes && suppPostRes.ok()) {
            try {
              const created = await suppPostRes.json()
              if (created?.id) {
                const current = loadUIState()
                const suppliers = current.companies[type]!.suppliers || []
                if (!suppliers.find((x) => x.id === created.id)) {
                  suppliers.push({ id: created.id, name: created.name || supp.name })
                  updateUICompanyState(type, { suppliers })
                }
              }
            } catch { /* response already consumed */ }
          }

          await waitForModalClose(page)
          await expectToastSuccess(page)
        })
      }

      // ════════════════════════════════════════
      // Vehicles (auto_service / dealership only)
      // ════════════════════════════════════════

      if (config.vehicles && config.vehicles.length > 0) {
        test(`MD-${type}-011: Navigate to vehicles page`, async () => {
          const state = loadUIState()
          const company = state.companies[type]
          test.skip(!company?.slug, `${type} not set up`)

          await navigateTo(page, company!.slug, 'vehicles')
          await waitForPageReady(page)
        })

        for (let i = 0; i < config.vehicles.length; i++) {
          const vehicle = config.vehicles[i]

          test(`MD-${type}-012-${i}: Create vehicle "${vehicle.licensePlate}" via UI`, async () => {
            const state = loadUIState()
            const company = state.companies[type]
            test.skip(!company?.slug || !company.customers.length, `${type} not set up`)

            // Check if vehicle already exists (from previous run — license plates are hardcoded)
            try {
              const checkRes = await page.request.get(`/api/vehicles?search=${encodeURIComponent(vehicle.licensePlate)}&pageSize=10`)
              if (checkRes.ok()) {
                const data = await checkRes.json()
                const list = Array.isArray(data) ? data : data.data || []
                const existingVeh = list.find((v: { licensePlate?: string }) => v.licensePlate === vehicle.licensePlate)
                if (existingVeh) {
                  const current = loadUIState()
                  const vehicleList = current.companies[type]!.vehicles || []
                  if (!vehicleList.find((x: { id: string }) => x.id === existingVeh.id)) {
                    vehicleList.push({ id: existingVeh.id, plate: existingVeh.licensePlate || vehicle.licensePlate, customerId: existingVeh.customerId })
                    updateUICompanyState(type, { vehicles: vehicleList })
                  }
                  return
                }
              }
            } catch { /* check failed, proceed */ }

            // Pre-create make via API if needed (CreatableSelect needs it in the dropdown)
            let makeId: string | null = null
            try {
              const makesRes = await page.request.get('/api/vehicle-makes?all=true')
              if (makesRes.ok()) {
                const makes = await makesRes.json()
                const existing = (Array.isArray(makes) ? makes : []).find((m: { name: string }) => m.name === vehicle.make)
                if (existing) {
                  makeId = existing.id
                } else {
                  const createRes = await page.request.post('/api/vehicle-makes', { data: { name: vehicle.make } })
                  if (createRes.ok()) {
                    const created = await createRes.json()
                    makeId = created.id
                  }
                }
              }
            } catch { /* will try to create via UI */ }

            // Pre-create model via API if needed
            if (makeId) {
              try {
                const modelsRes = await page.request.get(`/api/vehicle-models?makeId=${makeId}`)
                if (modelsRes.ok()) {
                  const models = await modelsRes.json()
                  const existing = (Array.isArray(models) ? models : []).find((m: { name: string }) => m.name === vehicle.model)
                  if (!existing) {
                    await page.request.post('/api/vehicle-models', { data: { name: vehicle.model, makeId } })
                  }
                }
              } catch { /* will try via UI */ }
            }

            await clickButton(page, 'Add Vehicle')
            await waitForModal(page)

            const modal = page.locator('[role="dialog"]').first()

            // Helper: interact with CreatableSelect — click to open, type, select option
            const fillCreatableSelect = async (labelText: string | RegExp, searchText: string) => {
              const labelEl = modal.locator('label').filter({ hasText: labelText }).first()
              const parent = labelEl.locator('..')
              // Click the container div to open (has class "relative")
              const container = parent.locator('.relative').first()
              await container.click()
              await page.waitForTimeout(200)
              // Type in the search input that appears
              const input = container.locator('input[type="text"]').first()
              await input.fill(searchText)
              await page.waitForTimeout(500)
              // Click matching option in dropdown
              const option = container.locator('.overflow-y-auto div, [class*="cursor-pointer"]')
                .filter({ hasText: new RegExp(`^${searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') })
                .first()
              if (await option.isVisible({ timeout: 3_000 }).catch(() => false)) {
                await option.click()
              } else {
                // Try any option that contains the text
                const anyOption = container.locator('.overflow-y-auto div')
                  .filter({ hasText: searchText })
                  .first()
                if (await anyOption.isVisible({ timeout: 2_000 }).catch(() => false)) {
                  await anyOption.click()
                }
              }
              await page.waitForTimeout(300)
            }

            // ── Basic Info Tab (default) ──
            // Make (CreatableSelect)
            await fillCreatableSelect(/Make/, vehicle.make)

            // Model (CreatableSelect, depends on Make selection)
            await fillCreatableSelect(/Model/, vehicle.model)

            // Year
            await tryAction(async () => {
              const yearInput = modal.locator('label').filter({ hasText: /Year/ }).locator('..').locator('input').first()
              if (await yearInput.isVisible()) await yearInput.fill(String(vehicle.year))
            })

            // Color
            await tryAction(async () => {
              const colorInput = modal.locator('label').filter({ hasText: /Color/ }).locator('..').locator('input').first()
              if (await colorInput.isVisible()) await colorInput.fill(vehicle.color)
            })

            // ── Identification Tab ──
            await clickTabIn(modal, 'Identification')
            await page.waitForTimeout(200)

            // License Plate
            await tryAction(async () => {
              const plateInput = modal.locator('label').filter({ hasText: /License Plate/ }).locator('..').locator('input').first()
              if (await plateInput.isVisible()) await plateInput.fill(vehicle.licensePlate)
            })

            // VIN
            await tryAction(async () => {
              const vinInput = modal.locator('label').filter({ hasText: /VIN/ }).locator('..').locator('input').first()
              if (await vinInput.isVisible()) await vinInput.fill(vehicle.vin)
            })

            // ── Owner Tab ──
            await clickTabIn(modal, 'Owner')
            await page.waitForTimeout(200)

            // Customer (CreatableSelect)
            await tryAction(async () => {
              await fillCreatableSelect(/Customer/, company!.customers[Math.min(i, company!.customers.length - 1)].name)
            })

            // Notes
            await tryAction(async () => {
              const notesArea = modal.locator('textarea').first()
              if (await notesArea.isVisible()) await notesArea.fill(vehicle.notes)
            })

            // Submit — intercept POST response for vehicle ID
            const vehResponsePromise = page.waitForResponse(
              (r) => r.url().includes('/api/vehicles') && r.request().method() === 'POST',
              { timeout: 15_000 }
            ).catch(() => null)

            const saveBtn = modal.getByRole('button', { name: /save|create|add/i })
            await saveBtn.click()

            const vehPostRes = await vehResponsePromise
            if (vehPostRes && vehPostRes.ok()) {
              try {
                const created = await vehPostRes.json()
                if (created?.id) {
                  const current = loadUIState()
                  const vehicleList = current.companies[type]!.vehicles || []
                  vehicleList.push({ id: created.id, plate: created.licensePlate || vehicle.licensePlate, customerId: created.customerId })
                  updateUICompanyState(type, { vehicles: vehicleList })
                }
              } catch { /* response already consumed */ }
            }

            await waitForModalClose(page)
            await expectToastSuccess(page)
          })
        }
      }

      // ════════════════════════════════════════
      // Service Types (auto_service / dealership only)
      // ════════════════════════════════════════

      if (config.serviceTypes && config.serviceTypes.length > 0) {
        test(`MD-${type}-013: Navigate to service types page`, async () => {
          const state = loadUIState()
          const company = state.companies[type]
          test.skip(!company?.slug, `${type} not set up`)

          await navigateTo(page, company!.slug, 'service-types')
          await waitForPageReady(page)
        })

        for (let i = 0; i < config.serviceTypes.length; i++) {
          const st = config.serviceTypes[i]

          test(`MD-${type}-014-${i}: Create service type "${st.name}" via UI`, async () => {
            const state = loadUIState()
            const company = state.companies[type]
            test.skip(!company?.slug, `${type} not set up`)

            // Check if service type already exists
            try {
              const checkRes = await page.request.get(`/api/service-types?search=${encodeURIComponent(st.name)}&pageSize=50`)
              if (checkRes.ok()) {
                const data = await checkRes.json()
                const list = Array.isArray(data) ? data : data.data || []
                const existing = list.find((s: { name: string }) => s.name === st.name)
                if (existing) {
                  const current = loadUIState()
                  const serviceTypes = current.companies[type]!.serviceTypes || []
                  if (!serviceTypes.find((x: { id: string }) => x.id === existing.id)) {
                    serviceTypes.push({ id: existing.id, name: existing.name, rate: parseFloat(existing.defaultRate || st.defaultRate) })
                    updateUICompanyState(type, { serviceTypes })
                  }
                  return
                }
              }
            } catch { /* check failed, proceed */ }

            await clickButton(page, 'Add Service Type')
            await waitForModal(page)

            const modal = page.locator('[role="dialog"]').first()

            // Name
            const nameInput = modal.locator('input[type="text"]').first()
            await nameInput.fill(st.name)

            // Description
            await tryAction(async () => {
              const descArea = modal.locator('textarea').first()
              if (await descArea.isVisible()) await descArea.fill(st.description)
            })

            // Hours
            await tryAction(async () => {
              const hoursInput = modal.getByLabel(/hours/i).first()
              if (await hoursInput.isVisible()) await hoursInput.fill(st.defaultHours)
            })

            // Rate
            await tryAction(async () => {
              const rateInput = modal.getByLabel(/rate/i).first()
              if (await rateInput.isVisible()) await rateInput.fill(st.defaultRate)
            })

            // Submit — intercept POST response for service type ID
            const stResponsePromise = page.waitForResponse(
              (r) => r.url().includes('/api/service-types') && r.request().method() === 'POST',
              { timeout: 15_000 }
            ).catch(() => null)

            const saveBtn = modal.getByRole('button', { name: /save|create/i })
            await saveBtn.click()

            const stPostRes = await stResponsePromise
            if (stPostRes && stPostRes.ok()) {
              try {
                const created = await stPostRes.json()
                if (created?.id) {
                  const current = loadUIState()
                  const serviceTypes = current.companies[type]!.serviceTypes || []
                  if (!serviceTypes.find((x) => x.id === created.id)) {
                    serviceTypes.push({
                      id: created.id,
                      name: created.name || st.name,
                      rate: parseFloat(created.defaultRate || st.defaultRate),
                    })
                    updateUICompanyState(type, { serviceTypes })
                  }
                }
              } catch { /* response already consumed */ }
            }

            await waitForModalClose(page)
            await expectToastSuccess(page)
          })
        }
      }
    })
  })
})
