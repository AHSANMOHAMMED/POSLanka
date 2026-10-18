import { test, expect } from '../../fixtures/auth'
import { tenantUrl, TEST_TENANT } from '../../fixtures/auth'

test.describe('Navigation - Core Pages Load [P0]', () => {
  test('Dashboard page loads', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/dashboard'))
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(new RegExp(`/c/${TEST_TENANT.slug}/dashboard`))
    await expect(page.locator('body')).toBeVisible()
  })

  test('Items page loads', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/items'))
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(new RegExp(`/items`))
  })

  test('Customers page loads', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/customers'))
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(new RegExp(`/customers`))
  })

  test('Sales page loads', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/sales'))
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(new RegExp(`/sales`))
  })

  test('POS page loads', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/pos'))
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(new RegExp(`/pos`))
  })

  test('Work Orders page loads (auto_service)', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/work-orders'))
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(new RegExp(`/work-orders`))
  })

  test('Settings page loads', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/settings'))
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(new RegExp(`/settings`))
  })

  test('Suppliers page loads', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/suppliers'))
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(new RegExp(`/suppliers`))
  })

  test('Accounting chart of accounts page loads', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/accounting/chart-of-accounts'))
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(new RegExp(`/accounting/chart-of-accounts`))
  })

  test('Vehicles page loads (auto_service)', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/vehicles'))
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(new RegExp(`/vehicles`))
  })

  test('Appointments page loads (auto_service)', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/appointments'))
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(new RegExp(`/appointments`))
  })

  test('HR employees page loads', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/hr/employees'))
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(new RegExp(`/hr/employees`))
  })
})
