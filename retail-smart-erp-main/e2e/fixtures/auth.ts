import { test as base, expect, type Page, type BrowserContext } from '@playwright/test'

// Test credentials - must match existing database records
export const TEST_TENANT = {
  slug: 'gajanayaka',
  name: 'Gajanayaka',
  businessType: 'auto_service',
}

export const TEST_USER = {
  email: 'ravindu2012@hotmail.com',
  password: 'Gaje@7616',
}

export const TEST_USER_2 = {
  email: 'ravindu@test.com',
  password: 'TestPass123!',
}

// Extend base test with authenticated page fixture
export const test = base.extend<{
  authenticatedPage: Page
  authenticatedContext: BrowserContext
}>({
  authenticatedPage: async ({ browser }, use) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    await loginAsTestUser(page)
    await use(page)
    await context.close()
  },
  authenticatedContext: async ({ browser }, use) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    await loginAsTestUser(page)
    await page.close()
    await use(context)
    // Context stays authenticated for subsequent pages
    await context.close()
  },
})

export { expect }

export async function loginAsTestUser(page: Page, user = TEST_USER) {
  await page.goto(`/c/${TEST_TENANT.slug}/login`)

  // Wait for login form to be ready
  await page.waitForSelector('input[type="email"]', { timeout: 15_000 })

  await page.fill('input[type="email"]', user.email)
  await page.fill('input[type="password"]', user.password)
  await page.click('button[type="submit"]')

  // Wait for redirect to dashboard
  await page.waitForURL(`**/c/${TEST_TENANT.slug}/dashboard`, { timeout: 30_000 })
}

export async function loginViaApi(page: Page, user = TEST_USER): Promise<void> {
  // Use NextAuth CSRF flow for faster login
  const csrfRes = await page.request.get('/api/auth/csrf')
  const { csrfToken } = await csrfRes.json()

  await page.request.post('/api/auth/callback/credentials', {
    form: {
      email: user.email,
      password: user.password,
      tenantSlug: TEST_TENANT.slug,
      csrfToken,
      callbackUrl: `/c/${TEST_TENANT.slug}/dashboard`,
    },
  })

  // Navigate to trigger cookie-based session
  await page.goto(`/c/${TEST_TENANT.slug}/dashboard`)
  await page.waitForURL(`**/c/${TEST_TENANT.slug}/dashboard`, { timeout: 30_000 })
}

export function tenantUrl(path: string): string {
  return `/c/${TEST_TENANT.slug}${path}`
}
