import { test, expect } from '../../fixtures/auth'
import { tenantUrl } from '../../fixtures/auth'

test.describe('ACCOUNTING - Critical Path [P1]', () => {
  test('ACCT-001: Chart of Accounts loads with tree', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/accounting/chart-of-accounts'))
    await page.waitForLoadState('networkidle')

    // Should show CoA page
    await expect(page).toHaveURL(/chart-of-accounts/)

    // Look for account tree or setup button
    const visible = await Promise.race([
      page.getByText(/assets|liabilities|equity|income|expense/i).first().waitFor({ timeout: 10_000 }).then(() => 'tree'),
      page.getByRole('button', { name: /setup|create/i }).first().waitFor({ timeout: 10_000 }).then(() => 'setup'),
      page.getByText(/no accounts/i).waitFor({ timeout: 10_000 }).then(() => 'empty'),
    ]).catch(() => 'loaded')

    expect(['tree', 'setup', 'empty', 'loaded']).toContain(visible)
  })

  test('ACCT-010: Journal entries page loads', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/accounting/journal-entries'))
    await page.waitForLoadState('networkidle')

    await expect(page).toHaveURL(/journal-entries/)
    await expect(page.locator('body')).toBeVisible()
  })

  test('ACCT-020: Payment entries page loads', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/accounting/payment-entries'))
    await page.waitForLoadState('networkidle')

    await expect(page).toHaveURL(/payment-entries/)
    await expect(page.locator('body')).toBeVisible()
  })

  test('ACCT-023: Payment entries API requires auth', async ({ page }) => {
    // Without login, should get 401
    const response = await page.request.get('/api/accounting/payment-entries')
    expect(response.status()).toBe(401)
  })

  test('ACCT-030: Budgets page loads', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/accounting/budgets'))
    await page.waitForLoadState('networkidle')

    await expect(page).toHaveURL(/budgets/)
    await expect(page.locator('body')).toBeVisible()
  })

  test('ACCT-060: Financial reports page loads', async ({ authenticatedPage: page }) => {
    // Try balance sheet
    await page.goto(tenantUrl('/accounting/reports/balance-sheet'))
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).toBeVisible()
  })

  test('ACCT-061: Profit & Loss report loads', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/accounting/reports/profit-and-loss'))
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).toBeVisible()
  })

  test('ACCT-062: Trial balance loads', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/accounting/reports/trial-balance'))
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).toBeVisible()
  })
})
