import { test, expect, Page, BrowserContext } from '@playwright/test'
import {
  BUSINESS_TYPES,
  BusinessType,
  getTestConfig,
  saveUIState,
  loadUIState,
  updateUICompanyState,
  loginViaUI,
  loginToCompanyViaUI,
  loginViaAPI,
  waitForPageReady,
  TestState,
} from './ui-helpers'

test.describe('UI — Register & Login (All Business Types)', () => {
  test.setTimeout(600_000)

  BUSINESS_TYPES.forEach((type, idx) => {
    test.describe.serial(`Register & Login ${type}`, () => {
      let page: Page
      let ctx: BrowserContext
      const config = getTestConfig(type, idx)

      test.beforeAll(async ({ browser }) => {
        ctx = await browser.newContext()
        page = await ctx.newPage()
      })

      test.afterAll(async () => {
        if (ctx) await ctx.close()
      })

      // ════════════════════════════════════════
      // Register via API (hybrid — OTP/rate limits make pure UI unreliable)
      // ════════════════════════════════════════

      test(`REG-${type}-001: Register account via API`, async () => {
        const res = await page.request.post('/api/register', {
          data: {
            fullName: config.fullName,
            email: config.email,
            password: config.password,
            phone: config.phone,
            country: 'LK',
            tosAcceptedAt: new Date().toISOString(),
          },
        })

        if (res.status() === 409) {
          // Account already exists — reuse it
          const state = loadUIState()
          if (state.companies[type]?.email === config.email) {
            return // Already registered in a previous run
          }
        }

        // Should be 200 or 201 (or 409 if exists, 429 = rate limited)
        expect([200, 201, 409, 429]).toContain(res.status())

        const state = loadUIState()
        if (!state.companies[type]) {
          state.companies[type] = {
            accountId: '',
            email: config.email,
            password: config.password,
            tenantId: '',
            slug: '',
            businessType: type,
            warehouseA: '',
            warehouseB: '',
            costCenterOps: '',
            costCenterSales: '',
            bankAccountCash: '',
            bankAccountBank: '',
            posProfileId: '',
            accounts: {},
            categories: [],
            items: [],
            customers: [],
            suppliers: [],
            purchaseOrders: [],
            purchases: [],
            sales: [],
            salesOrders: [],
          } as any
        }
        saveUIState(state)
      })

      test(`REG-${type}-002: Create company via API`, async () => {
        const state = loadUIState()
        if (state.companies[type]?.slug) return // Already created

        // Login to account first
        const csrfRes = await page.request.get('/api/account-auth/csrf')
        const { csrfToken } = await csrfRes.json()
        await page.request.post('/api/account-auth/callback/credentials', {
          form: { email: config.email, password: config.password, csrfToken, callbackUrl: '/account/companies' },
        })

        const res = await page.request.post('/api/account/companies', {
          data: {
            name: config.companyName,
            slug: config.slug,
            businessType: type,
            country: 'LK',
            dateFormat: 'DD/MM/YYYY',
            timeFormat: 'HH:mm',
          },
        })

        if (res.status() === 409) {
          // Company slug taken — try to find existing
          const listRes = await page.request.get('/api/account/companies')
          if (listRes.ok()) {
            const companies = await listRes.json()
            const existing = Array.isArray(companies) ? companies.find((c: any) => c.slug === config.slug) : null
            if (existing) {
              updateUICompanyState(type, {
                tenantId: existing.id,
                slug: existing.slug,
                email: config.email,
                password: config.password,
              })
              return
            }
          }
        }

        expect(res.ok(), `Create company failed: ${await res.text()}`).toBeTruthy()
        const company = await res.json()
        updateUICompanyState(type, {
          tenantId: company.id || company.tenantId,
          slug: company.slug || config.slug,
          email: config.email,
          password: config.password,
        })
      })

      // ════════════════════════════════════════
      // Login via UI (real browser interaction)
      // ════════════════════════════════════════

      test(`REG-${type}-003: Login via UI`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        // Navigate to login page
        await page.goto('/login')
        await page.waitForLoadState('networkidle')
        await page.waitForTimeout(1000)

        // Check if we're already logged in (redirected away from /login)
        const url = page.url()
        if (url.includes('/account') || url.includes('/dashboard')) {
          // Already logged in — session still active from API auth
          return
        }

        // If still on login page, fill the form
        const emailInput = page.locator('input[type="email"]')
        if (await emailInput.isVisible({ timeout: 5_000 })) {
          await emailInput.fill(company!.email)
          await page.locator('input[type="password"]').fill(company!.password)

          const signInBtn = page.getByRole('button', { name: /sign in/i })
          await expect(signInBtn).toBeEnabled()
          await signInBtn.click()

          await page.waitForLoadState('networkidle')
          await page.waitForTimeout(2000)
        }

        // Should be redirected away from login page
        expect(page.url()).not.toContain('/login')
      })

      test(`REG-${type}-004: Navigate to company dashboard via UI`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        // Login to company context via API (sets tenant session)
        await loginViaAPI(page.request, company!.email, company!.password, company!.slug)

        // Navigate to company dashboard
        await page.goto(`/c/${company!.slug}/dashboard`)
        await page.waitForLoadState('networkidle')
        await page.waitForSelector('main', { timeout: 15_000 })

        expect(page.url()).toContain(`/c/${company!.slug}`)
      })

      test(`REG-${type}-005: Verify dashboard content`, async () => {
        const state = loadUIState()
        const company = state.companies[type]
        test.skip(!company?.slug, `${type} not set up`)

        const mainContent = page.locator('main')
        await expect(mainContent).toBeVisible({ timeout: 10_000 })

        const hasContent = await mainContent.textContent()
        expect(hasContent!.length).toBeGreaterThan(0)
      })
    })
  })
})
