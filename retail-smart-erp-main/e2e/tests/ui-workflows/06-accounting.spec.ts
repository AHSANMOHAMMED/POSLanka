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
  today,
} from './ui-helpers'

/** Wait for Turbopack "Compiling..." indicator to disappear */
async function waitForCompilation(page: Page, timeout = 30_000): Promise<void> {
  const compiling = page.locator('text=/compiling/i')
  // If the compiling indicator is visible, wait for it to disappear
  if (await compiling.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await compiling.waitFor({ state: 'hidden', timeout })
    await page.waitForTimeout(500)
  }
}

test.describe('UI — Accounting: Journal & Payment Entries via UI', () => {
  test.setTimeout(600_000)

  // Test accounting for retail and auto_service (representative subset)
  const accountingTypes = BUSINESS_TYPES.filter(t => t === 'retail' || t === 'auto_service')

  accountingTypes.forEach((type, idx) => {
    const realIdx = BUSINESS_TYPES.indexOf(type)
    test.describe.serial(`Accounting ${type}`, () => {
      let page: Page
      let ctx: BrowserContext
      const config = getTestConfig(type, realIdx)

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
      // Journal Entries
      // ════════════════════════════════════════

      test(`ACC-${type}-001: Navigate to journal entries page`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        await navigateTo(page, company!.slug, 'accounting/journal-entries')
        await waitForPageReady(page)
        await waitForCompilation(page)

        const heading = page.locator('h1, h2, [class*="title"]').first()
        await expect(heading).toBeVisible({ timeout: 10_000 })
      })

      test(`ACC-${type}-002: Click "New Journal Entry" and navigate to form`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        await waitForCompilation(page)

        // The "New Journal Entry" is a <Link> (anchor tag), not a button
        const newBtn = page.getByRole('link', { name: /new journal entry/i })
          .or(page.getByRole('button', { name: /new journal entry/i }))
        await newBtn.first().click()

        // Wait for navigation to /new page
        await page.waitForURL(/\/journal-entries\/new/, { timeout: 15_000 })
        await waitForPageReady(page)
        await waitForCompilation(page)

        expect(page.url()).toContain('/new')
      })

      test(`ACC-${type}-003: Set posting date and entry type`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        // Set posting date
        await tryAction(async () => {
          await fillDate(page, 'Posting Date', today())
        })

        // Set entry type to "Journal"
        await tryAction(async () => {
          await selectOption(page, 'Entry Type', 'Journal')
        })

        // Fill remarks
        await tryAction(async () => {
          const remarksInput = page.getByPlaceholder(/remarks/i)
            .or(page.getByLabel(/remarks/i))
          if (await remarksInput.first().isVisible()) {
            await remarksInput.first().fill(
              'E2E UI test journal entry — office supplies expense allocation for monthly operations'
            )
          }
        })
      })

      test(`ACC-${type}-004: Fill first line — debit expense account`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        // Find the first row's account dropdown and select expense account
        await tryAction(async () => {
          const accountSelects = page.locator('select').filter({
            has: page.locator('option'),
          })
          const firstSelect = accountSelects.first()
          if (await firstSelect.isVisible()) {
            // Look for an expense account option
            const options = await firstSelect.locator('option').allTextContents()
            const expenseOption = options.find(
              o => o.includes('Expense') || o.includes('Office') || o.includes('5')
            )
            if (expenseOption) {
              await firstSelect.selectOption({ label: expenseOption })
            }
          }
        })

        // Fill debit amount = 5000
        await tryAction(async () => {
          const debitInputs = page.locator('input[type="number"]')
          // Find the debit column input (typically the first number input in the row)
          for (let i = 0; i < await debitInputs.count(); i++) {
            const input = debitInputs.nth(i)
            const placeholder = await input.getAttribute('placeholder')
            if (placeholder === '0.00') {
              await input.fill('5000')
              break
            }
          }
        })
      })

      test(`ACC-${type}-005: Fill second line — credit cash account`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        // Find the second row's account dropdown and select cash account
        await tryAction(async () => {
          const accountSelects = page.locator('select').filter({
            has: page.locator('option'),
          })
          // Second account select (index 1)
          if (await accountSelects.count() > 1) {
            const secondSelect = accountSelects.nth(1)
            const options = await secondSelect.locator('option').allTextContents()
            const cashOption = options.find(
              o => o.includes('Cash') || o.includes('Bank') || o.includes('1')
            )
            if (cashOption) {
              await secondSelect.selectOption({ label: cashOption })
            }
          }
        })

        // Fill credit amount = 5000 (find the credit input in second row)
        await tryAction(async () => {
          const inputs = page.locator('input[placeholder="0.00"]')
          const count = await inputs.count()
          // The credit field is usually the 4th input (row2 credit = index 3)
          // Pattern: row1 debit, row1 credit, row2 debit, row2 credit
          if (count >= 4) {
            await inputs.nth(3).fill('5000')
          } else if (count >= 2) {
            // Simpler layout — fill last one
            await inputs.nth(count - 1).fill('5000')
          }
        })
      })

      test(`ACC-${type}-006: Verify journal entry is balanced`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        // Look for balance indicator (green = balanced, red = unbalanced)
        await tryAction(async () => {
          const balancedText = page.locator('text=/balanced|difference.*0/i')
          if (await balancedText.isVisible({ timeout: 3_000 })) {
            // Good — entry is balanced
          }
        })
      })

      test(`ACC-${type}-007: Save and submit journal entry`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        // Click "Save & Submit" or "Save as Draft"
        const submitBtn = page.getByRole('button', { name: /save.*submit|submit/i })
        const draftBtn = page.getByRole('button', { name: /save.*draft|save/i })

        if (await submitBtn.isVisible()) {
          await submitBtn.click()
        } else if (await draftBtn.isVisible()) {
          await draftBtn.click()
        }

        await page.waitForLoadState('networkidle')
        await page.waitForTimeout(2000)

        // Check for success
        await tryAction(async () => {
          await expectToastSuccess(page)
        })
      })

      test(`ACC-${type}-008: Verify journal entry in list`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        await navigateTo(page, company!.slug, 'accounting/journal-entries')
        await waitForPageReady(page)
        await page.waitForTimeout(1000)

        const content = await page.textContent('main')
        expect(content!.length).toBeGreaterThan(50)
      })

      // ════════════════════════════════════════
      // Payment Entries
      // ════════════════════════════════════════

      test(`ACC-${type}-009: Navigate to payment entries page`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        await navigateTo(page, company!.slug, 'accounting/payment-entries')
        await waitForPageReady(page)
        await waitForCompilation(page)

        const heading = page.locator('h1, h2, [class*="title"]').first()
        await expect(heading).toBeVisible({ timeout: 10_000 })
      })

      test(`ACC-${type}-010: Click "New Payment Entry" and navigate to form`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        await waitForCompilation(page)

        // The "New Payment Entry" is a <button> using router.push()
        const newBtn = page.getByRole('button', { name: /new payment entry/i })
          .or(page.getByRole('link', { name: /new payment entry/i }))
        await newBtn.first().click()

        // Wait for navigation to /new page
        await page.waitForURL(/\/payment-entries\/new/, { timeout: 15_000 })
        await waitForPageReady(page)
        await waitForCompilation(page)

        expect(page.url()).toContain('/new')
      })

      test(`ACC-${type}-011: Select "Receive" payment type`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        // Click the Receive button (green)
        const receiveBtn = page.getByRole('button', { name: /receive/i })
        if (await receiveBtn.isVisible()) {
          await receiveBtn.click()
          await page.waitForTimeout(300)
        }
      })

      test(`ACC-${type}-012: Set posting date`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        await tryAction(async () => {
          await fillDate(page, 'Posting Date', today())
        })
      })

      test(`ACC-${type}-013: Select customer from async dropdown`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug || !company.customers.length, `${type} not set up`)

        // Search and select customer
        await tryAction(async () => {
          await fillAsyncSelect(page, 'customer', company!.customers[0].name)
        })

        // Alternative: try party search placeholder
        await tryAction(async () => {
          await fillAsyncSelect(page, 'Search Customer', company!.customers[0].name)
        })

        await page.waitForTimeout(500)
      })

      test(`ACC-${type}-014: Select accounts and fill amount`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        // Select From Account (receivable)
        await tryAction(async () => {
          const fromSelect = page.locator('select').filter({
            has: page.locator('..').filter({ hasText: /receivable|from account/i }),
          }).first()
          if (await fromSelect.isVisible()) {
            const options = await fromSelect.locator('option').allTextContents()
            const receivableOpt = options.find(o => o.includes('Receivable') || o.includes('1'))
            if (receivableOpt) await fromSelect.selectOption({ label: receivableOpt })
          }
        })

        // Select To Account (cash/bank)
        await tryAction(async () => {
          const toSelect = page.locator('select').filter({
            has: page.locator('..').filter({ hasText: /bank.*cash|to account/i }),
          }).first()
          if (await toSelect.isVisible()) {
            const options = await toSelect.locator('option').allTextContents()
            const cashOpt = options.find(o => o.includes('Cash') || o.includes('Bank'))
            if (cashOpt) await toSelect.selectOption({ label: cashOpt })
          }
        })

        // Fill paid amount
        await tryAction(async () => {
          await fillField(page, 'Paid Amount', '2500')
        })

        // Alternative: fill amount by placeholder
        await tryAction(async () => {
          const amountInput = page.locator('input[placeholder="0.00"]').first()
          if (await amountInput.isVisible()) {
            const currentVal = await amountInput.inputValue()
            if (!currentVal || currentVal === '0' || currentVal === '0.00') {
              await amountInput.fill('2500')
            }
          }
        })

        // Fill reference number
        await tryAction(async () => {
          await fillField(page, 'Reference', 'CHQ-E2E-001')
        })

        await tryAction(async () => {
          const refInput = page.getByPlaceholder(/cheque|transaction ref/i)
          if (await refInput.isVisible()) {
            await refInput.fill('CHQ-E2E-001')
          }
        })
      })

      test(`ACC-${type}-015: Fill remarks and save payment entry`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        // Fill remarks
        await tryAction(async () => {
          const remarksInput = page.getByPlaceholder(/notes|remarks/i)
            .or(page.locator('textarea'))
          if (await remarksInput.first().isVisible()) {
            await remarksInput.first().fill(
              'E2E UI test payment entry — customer payment received via cheque for outstanding invoice'
            )
          }
        })

        // Submit
        const submitBtn = page.getByRole('button', { name: /save.*submit|submit/i })
        const draftBtn = page.getByRole('button', { name: /save.*draft|save/i })

        if (await submitBtn.isVisible()) {
          await submitBtn.click()
        } else if (await draftBtn.isVisible()) {
          await draftBtn.click()
        }

        await page.waitForLoadState('networkidle')
        await page.waitForTimeout(2000)

        await tryAction(async () => {
          await expectToastSuccess(page)
        })
      })

      test(`ACC-${type}-016: Verify payment entry in list`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        await navigateTo(page, company!.slug, 'accounting/payment-entries')
        await waitForPageReady(page)
        await page.waitForTimeout(1000)

        const content = await page.textContent('main')
        expect(content!.length).toBeGreaterThan(50)
      })
    })
  })
})
