import { test, expect } from '../../fixtures/auth'
import { tenantUrl } from '../../fixtures/auth'

test.describe('SETTINGS - Critical Path [P1]', () => {
  test('SET-001: Staff management page loads', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/settings/staff'))
    await page.waitForLoadState('networkidle')

    await expect(page).toHaveURL(/settings\/staff/)
    await expect(page.locator('body')).toBeVisible()
  })

  test('SET-010: Warehouses page loads', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/settings/warehouses'))
    await page.waitForLoadState('networkidle')

    await expect(page).toHaveURL(/settings\/warehouses/)
    await expect(page.locator('body')).toBeVisible()
  })

  test('SET-020: POS profiles page loads', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/pos-profiles'))
    await page.waitForLoadState('networkidle')

    await expect(page.locator('body')).toBeVisible()
  })

  test('SET-030: Module access settings page', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/settings'))
    await page.waitForLoadState('networkidle')

    // Settings page should have sections for configuration
    await expect(page).toHaveURL(/settings/)
    await expect(page.locator('body')).toBeVisible()
  })
})
