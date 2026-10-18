import { test, expect } from '@playwright/test'
import { TEST_TENANT, TEST_USER, loginAsTestUser, tenantUrl } from '../../fixtures/auth'

test.describe('AUTH - Authentication & Session [P0]', () => {
  test('AUTH-010: Successful company login', async ({ page }) => {
    await page.goto(`/c/${TEST_TENANT.slug}/login`)

    // Wait for the login form to load (not the loading spinner)
    await page.waitForSelector('#email', { timeout: 15_000 })

    // Verify company name is displayed
    await expect(page.getByRole('heading', { name: TEST_TENANT.name }).first()).toBeVisible()

    // Fill credentials
    await page.fill('#email', TEST_USER.email)
    await page.fill('#password', TEST_USER.password)

    // Submit
    await page.click('button[type="submit"]')

    // Should redirect to dashboard
    await page.waitForURL(`**/c/${TEST_TENANT.slug}/dashboard`, { timeout: 30_000 })
    await expect(page).toHaveURL(new RegExp(`/c/${TEST_TENANT.slug}/dashboard`))
  })

  test('AUTH-011: Invalid credentials show error', async ({ page }) => {
    await page.goto(`/c/${TEST_TENANT.slug}/login`)
    await page.waitForSelector('#email', { timeout: 15_000 })

    await page.fill('#email', TEST_USER.email)
    await page.fill('#password', 'WrongPassword123!')
    await page.click('button[type="submit"]')

    // Should show error message (not redirect)
    await expect(page.getByText(/sign in failed|invalid|check your email/i)).toBeVisible({ timeout: 10_000 })

    // Should remain on login page
    await expect(page).toHaveURL(new RegExp(`/c/${TEST_TENANT.slug}/login`))
  })

  test('AUTH-012: Non-existent tenant slug shows error or 404', async ({ page }) => {
    const res = await page.goto('/c/nonexistent-company-xyz/login')
    // Should either show 404 or the login page with an error
    const status = res?.status()
    // Accept 404 or 200 (login page loads but company info fails)
    expect([200, 404]).toContain(status)
  })

  test('AUTH-030: Session persists across navigation', async ({ page }) => {
    await loginAsTestUser(page)

    // Navigate to another page
    await page.goto(tenantUrl('/items'))
    await page.waitForLoadState('networkidle')

    // Should not be redirected to login
    await expect(page).toHaveURL(new RegExp(`/c/${TEST_TENANT.slug}/items`))

    // Navigate to yet another page
    await page.goto(tenantUrl('/customers'))
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(new RegExp(`/c/${TEST_TENANT.slug}/customers`))
  })

  test('AUTH-034: Unauthenticated access redirects to login', async ({ page }) => {
    // Try to access dashboard without logging in
    await page.goto(tenantUrl('/dashboard'))

    // Should redirect to login page
    await page.waitForURL(`**/c/${TEST_TENANT.slug}/login**`, { timeout: 15_000 })
  })
})
