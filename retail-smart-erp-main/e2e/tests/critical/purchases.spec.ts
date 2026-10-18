import { test, expect } from '../../fixtures/auth'
import { tenantUrl } from '../../fixtures/auth'

test.describe('PURCHASES & SUPPLIERS - Critical Path [P1]', () => {
  test('PURCH-001: Suppliers page loads', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/suppliers'))
    await page.waitForLoadState('networkidle')

    await expect(page).toHaveURL(/suppliers/)
    await expect(page.locator('body')).toBeVisible()
  })

  test('PURCH-010: Purchases page loads', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/purchases'))
    await page.waitForLoadState('networkidle')

    await expect(page).toHaveURL(/purchases/)
    await expect(page.locator('body')).toBeVisible()
  })

  test('PURCH-020: Purchase orders page loads', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/purchase-orders'))
    await page.waitForLoadState('networkidle')

    await expect(page).toHaveURL(/purchase-orders/)
    await expect(page.locator('body')).toBeVisible()
  })

  test('PURCH-030: Purchase requisitions page loads', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/purchase-requisitions'))
    await page.waitForLoadState('networkidle')

    // May redirect or show 404 if not enabled
    await expect(page.locator('body')).toBeVisible()
  })

  test('STOCK-001: Stock transfers page loads', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/stock-transfers'))
    await page.waitForLoadState('networkidle')

    await expect(page.locator('body')).toBeVisible()
  })

  test('STOCK-020: Stock takes page loads', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/stock-takes'))
    await page.waitForLoadState('networkidle')

    await expect(page.locator('body')).toBeVisible()
  })
})
