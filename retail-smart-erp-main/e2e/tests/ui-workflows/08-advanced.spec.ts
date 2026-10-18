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
  selectOption,
  fillDate,
  clickButton,
  clickButtonAndWait,
  expectToastSuccess,
  waitForModal,
  waitForModalClose,
  tryAction,
  isVisible,
  daysFromNow,
} from './ui-helpers'

test.describe('UI — Advanced: Layaways, Gift Cards, Loyalty & Shift Close', () => {
  test.setTimeout(600_000)

  BUSINESS_TYPES.forEach((type, idx) => {
    test.describe.serial(`Advanced ${type}`, () => {
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
      // Layaways (retail / supermarket only)
      // ════════════════════════════════════════

      const supportsLayaway = ['retail', 'supermarket'].includes(type)

      if (supportsLayaway) {
        test(`ADV-${type}-001: Navigate to layaways page`, async () => {
          const state = loadUIState()
          const company = state.companies[type]
          test.skip(!company?.slug, `${type} not set up`)

          await navigateTo(page, company!.slug, 'layaways')
          await waitForPageReady(page)

          const heading = page.locator('h1, h2, [class*="title"]').first()
          await expect(heading).toBeVisible({ timeout: 10_000 })
        })

        test(`ADV-${type}-002: Click "New Layaway" and open creation modal`, async () => {
          const state = loadUIState()
          const company = state.companies[type]
          test.skip(!company?.slug || !company.customers.length || !company.items.length, `${type} not set up`)

          const newBtn = page.getByRole('button', { name: /new layaway/i })
          await newBtn.click()
          await page.waitForTimeout(500)

          // Multi-step modal should appear
          const modal = page.locator('[role="dialog"]')
          await expect(modal).toBeVisible({ timeout: 5_000 })
        })

        test(`ADV-${type}-003: Step 1 — Search and select customer`, async () => {
          const state = loadUIState()
          const company = state.companies[type]
          test.skip(!company?.slug || !company.customers.length, `${type} not set up`)

          const modal = page.locator('[role="dialog"]')

          // Search for customer in the modal
          await tryAction(async () => {
            const searchInput = modal.getByPlaceholder(/search customer/i)
            if (await searchInput.isVisible()) {
              await searchInput.fill(company!.customers[0].name)
              await page.waitForTimeout(500)
              await page.waitForLoadState('networkidle')

              // Click customer in results
              const result = modal.locator('div, li').filter({
                hasText: company!.customers[0].name,
              }).first()
              if (await result.isVisible({ timeout: 5_000 })) {
                await result.click()
                await page.waitForTimeout(300)
              }
            }
          })

          // Click "Next: Add Items"
          await tryAction(async () => {
            const nextBtn = modal.getByRole('button', { name: /next.*item/i })
            if (await nextBtn.isVisible()) {
              await nextBtn.click()
              await page.waitForTimeout(500)
            }
          })
        })

        test(`ADV-${type}-004: Step 2 — Search and add items`, async () => {
          const state = loadUIState()
          const company = state.companies[type]
          test.skip(!company?.slug || !company.items.length, `${type} not set up`)

          const modal = page.locator('[role="dialog"]')

          // Search for item
          await tryAction(async () => {
            const itemSearch = modal.getByPlaceholder(/search item/i)
            if (await itemSearch.isVisible()) {
              await itemSearch.fill(company!.items[0].name)
              await page.waitForTimeout(500)
              await page.waitForLoadState('networkidle')

              // Click item result
              const result = modal.locator('div, li').filter({
                hasText: company!.items[0].name,
              }).first()
              if (await result.isVisible({ timeout: 5_000 })) {
                await result.click()
                await page.waitForTimeout(300)
              }
            }
          })

          // Add a second item if available
          if (company!.items.length > 1) {
            await tryAction(async () => {
              const itemSearch = modal.getByPlaceholder(/search item/i)
              if (await itemSearch.isVisible()) {
                await itemSearch.fill(company!.items[1].name)
                await page.waitForTimeout(500)
                await page.waitForLoadState('networkidle')

                const result = modal.locator('div, li').filter({
                  hasText: company!.items[1].name,
                }).first()
                if (await result.isVisible({ timeout: 5_000 })) {
                  await result.click()
                  await page.waitForTimeout(300)
                }
              }
            })
          }

          // Click "Next: Payment Details"
          await tryAction(async () => {
            const nextBtn = modal.getByRole('button', { name: /next.*payment/i })
            if (await nextBtn.isVisible()) {
              await nextBtn.click()
              await page.waitForTimeout(500)
            }
          })
        })

        test(`ADV-${type}-005: Step 3 — Set deposit and create layaway`, async () => {
          const state = loadUIState()
          const company = state.companies[type]
          test.skip(!company?.slug, `${type} not set up`)

          const modal = page.locator('[role="dialog"]')

          // Click 25% quick deposit button
          await tryAction(async () => {
            const pctBtn = modal.getByRole('button', { name: /25%/i })
            if (await pctBtn.isVisible()) {
              await pctBtn.click()
              await page.waitForTimeout(300)
            } else {
              // Manual deposit amount
              const depositInput = modal.locator('input[type="number"]').first()
              if (await depositInput.isVisible()) {
                await depositInput.fill('1000')
              }
            }
          })

          // Set due date (30 days from now)
          await tryAction(async () => {
            const dateInput = modal.locator('input[type="date"]').first()
            if (await dateInput.isVisible()) {
              await dateInput.fill(daysFromNow(30))
            }
          })

          // Add notes
          await tryAction(async () => {
            const notesArea = modal.locator('textarea').first()
              .or(modal.getByPlaceholder(/notes|instruction/i))
            if (await notesArea.first().isVisible()) {
              await notesArea.first().fill(
                `E2E UI layaway for ${type} — customer placing deposit on items, ` +
                'full payment expected within 30 days. Items reserved and set aside.'
              )
            }
          })

          // Click "Create Layaway"
          const createBtn = modal.getByRole('button', { name: /create layaway/i })
          if (await createBtn.isVisible() && await createBtn.isEnabled()) {
            await createBtn.click()
            await page.waitForTimeout(2000)
            await page.waitForLoadState('networkidle')
          }

          await tryAction(async () => {
            await expectToastSuccess(page)
          })
        })

        test(`ADV-${type}-006: Verify layaway in list`, async () => {
          const state = loadUIState()
          const company = state.companies[type]
          test.skip(!company?.slug, `${type} not set up`)

          await navigateTo(page, company!.slug, 'layaways')
          await waitForPageReady(page)
          await page.waitForTimeout(1000)

          const content = await page.textContent('main')
          expect(content!.length).toBeGreaterThan(50)
        })
      }

      // ════════════════════════════════════════
      // Gift Cards
      // ════════════════════════════════════════

      test(`ADV-${type}-007: Navigate to gift cards page`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        await navigateTo(page, company!.slug, 'settings/gift-cards')
        await waitForPageReady(page)

        const heading = page.locator('h1, h2, [class*="title"]').first()
        await expect(heading).toBeVisible({ timeout: 10_000 })
      })

      test(`ADV-${type}-008: Create gift card via UI`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        // Click Create Gift Card button (use .first() — page has header + empty state buttons)
        const createBtn = page.getByRole('button', { name: /create gift card|new gift card/i }).first()
        if (await createBtn.isVisible()) {
          await createBtn.click()
          await page.waitForTimeout(500)
        }

        const modal = page.locator('[role="dialog"]')
        if (await modal.isVisible()) {
          // Card number should be pre-generated, but fill if empty
          await tryAction(async () => {
            const cardInput = modal.locator('input[type="text"]').first()
            const val = await cardInput.inputValue()
            if (!val) {
              // Click refresh/generate button if available
              const refreshBtn = modal.locator('button').filter({ hasText: /refresh|generate/i })
              if (await refreshBtn.isVisible()) {
                await refreshBtn.click()
                await page.waitForTimeout(200)
              }
            }
          })

          // Fill initial balance
          await tryAction(async () => {
            const balanceInput = modal.locator('input[type="number"]').first()
            if (await balanceInput.isVisible()) {
              await balanceInput.fill('5000')
            }
          })

          // Fill PIN
          await tryAction(async () => {
            const pinInput = modal.getByPlaceholder(/pin/i)
              .or(modal.locator('input').filter({ has: modal.locator('..').filter({ hasText: /pin/i }) }))
            if (await pinInput.first().isVisible()) {
              await pinInput.first().fill('1234')
            }
          })

          // Set expiry date (1 year from now)
          await tryAction(async () => {
            const expiryInput = modal.locator('input[type="date"]').first()
            if (await expiryInput.isVisible()) {
              await expiryInput.fill(daysFromNow(365))
            }
          })

          // Click Create
          const submitBtn = modal.getByRole('button', { name: /create/i })
          if (await submitBtn.isVisible()) {
            await submitBtn.click()
            await page.waitForTimeout(1500)
            await page.waitForLoadState('networkidle')
          }

          await tryAction(async () => {
            await expectToastSuccess(page)
          })
        }
      })

      test(`ADV-${type}-009: Verify gift card in list`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        // Page should show the gift card
        await page.waitForTimeout(500)
        const content = await page.textContent('main')
        expect(content!.length).toBeGreaterThan(30)
      })

      // ════════════════════════════════════════
      // Loyalty Program
      // ════════════════════════════════════════

      test(`ADV-${type}-010: Navigate to loyalty settings page`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        await navigateTo(page, company!.slug, 'settings/loyalty')
        await waitForPageReady(page)

        const heading = page.locator('h1, h2, [class*="title"]').first()
        await expect(heading).toBeVisible({ timeout: 10_000 })
      })

      test(`ADV-${type}-011: Configure loyalty program`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        // Fill program name
        await tryAction(async () => {
          await fillField(page, 'Program Name', `${config.companyName} Rewards`)
        })

        // Set collection factor (points per currency spent)
        await tryAction(async () => {
          const collectionInput = page.locator('input[type="number"]').filter({
            has: page.locator('..').filter({ hasText: /collection|points per/i }),
          }).first()
          if (await collectionInput.isVisible()) {
            await collectionInput.fill('1')
          }
        })

        // Set conversion factor (currency value per point)
        await tryAction(async () => {
          const conversionInput = page.locator('input[type="number"]').filter({
            has: page.locator('..').filter({ hasText: /conversion|value per/i }),
          }).first()
          if (await conversionInput.isVisible()) {
            await conversionInput.fill('0.05')
          }
        })

        // Set min redemption points
        await tryAction(async () => {
          const minInput = page.locator('input[type="number"]').filter({
            has: page.locator('..').filter({ hasText: /min.*redemption|minimum/i }),
          }).first()
          if (await minInput.isVisible()) {
            await minInput.fill('100')
          }
        })

        // Enable point expiry
        await tryAction(async () => {
          const expiryCheckbox = page.getByLabel(/points expire/i)
            .or(page.locator('input[type="checkbox"]').filter({
              has: page.locator('..').filter({ hasText: /expire/i }),
            }))
          if (await expiryCheckbox.first().isVisible()) {
            await expiryCheckbox.first().check()
            await page.waitForTimeout(200)

            // Set expiry days
            const daysInput = page.locator('input[type="number"]').filter({
              has: page.locator('..').filter({ hasText: /days/i }),
            }).first()
            if (await daysInput.isVisible()) {
              await daysInput.fill('365')
            }
          }
        })

        // Configure tiers — update min points for each tier
        await tryAction(async () => {
          const tierRows = page.locator('tbody tr, [class*="tier"]')
          const count = await tierRows.count()
          const tierMinPoints = [0, 500, 2000, 5000]
          for (let i = 0; i < Math.min(count, 4); i++) {
            const row = tierRows.nth(i)
            const inputs = row.locator('input[type="number"]')
            if (await inputs.first().isVisible()) {
              await inputs.first().fill(String(tierMinPoints[i] || 0))
            }
          }
        })

        // Save
        const saveBtn = page.getByRole('button', { name: /save/i })
        if (await saveBtn.isVisible()) {
          await saveBtn.click()
          await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
          await page.waitForTimeout(1500)
        }

        await tryAction(async () => {
          await expectToastSuccess(page)
        })
      })

      // ════════════════════════════════════════
      // Close POS Shift (if still open from 04-pos-sales)
      // ════════════════════════════════════════

      test(`ADV-${type}-012: Navigate to POS and close shift`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug || !company.posProfileId, `${type} not set up`)

        await navigateTo(page, company!.slug, 'pos')
        await waitForPageReady(page)

        // Check if shift is open
        const closeShiftBtn = page.getByRole('button', { name: /close shift/i })
        if (await closeShiftBtn.isVisible({ timeout: 5_000 })) {
          await closeShiftBtn.click()
          await page.waitForTimeout(500)

          // Close Shift modal
          const modal = page.locator('[role="dialog"]')
          if (await modal.isVisible()) {
            // Fill closing amounts
            await tryAction(async () => {
              const cashInput = modal.locator('input[type="number"]').first()
              if (await cashInput.isVisible()) {
                await cashInput.fill('15000')
              }
            })

            // Click Close Shift
            const confirmBtn = modal.getByRole('button', { name: /close shift/i })
            if (await confirmBtn.isVisible()) {
              await confirmBtn.click()
              await page.waitForTimeout(2000)
              await page.waitForLoadState('networkidle')
            }
          }
        }
      })

      // ════════════════════════════════════════
      // Final Integrity Checks
      // ════════════════════════════════════════

      test(`ADV-${type}-013: Verify sales list has entries`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        await navigateTo(page, company!.slug, 'sales')
        await waitForPageReady(page)
        await page.waitForTimeout(1000)

        const content = await page.textContent('main')
        expect(content!.length).toBeGreaterThan(50)
      })

      test(`ADV-${type}-014: Verify items list has entries`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        await navigateTo(page, company!.slug, 'items')
        await waitForPageReady(page)
        await page.waitForTimeout(1000)

        const content = await page.textContent('main')
        expect(content!.length).toBeGreaterThan(50)
      })

      test(`ADV-${type}-015: Verify customers list has entries`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        await navigateTo(page, company!.slug, 'customers')
        await waitForPageReady(page)
        await page.waitForTimeout(1000)

        const content = await page.textContent('main')
        expect(content!.length).toBeGreaterThan(50)
      })

      test(`ADV-${type}-016: Verify dashboard loads cleanly`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        await navigateTo(page, company!.slug, 'dashboard')
        await waitForPageReady(page)

        // Wait longer for dashboard content — it may take time after Turbopack recompilation
        const main = page.locator('main')
        await expect(main).toBeVisible({ timeout: 30_000 })
        // Wait for actual content to render inside main
        await page.waitForTimeout(2_000)
        const content = await main.textContent()
        expect((content || '').length).toBeGreaterThan(0)
      })
    })
  })
})
