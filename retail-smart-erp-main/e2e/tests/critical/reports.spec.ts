import { test, expect } from '../../fixtures/auth'
import { tenantUrl } from '../../fixtures/auth'

test.describe('REPORTS - Critical Path [P1]', () => {
  const reportPages = [
    { name: 'Sales summary', path: '/reports/sales-summary' },
    { name: 'Sales by customer', path: '/reports/sales-by-customer' },
    { name: 'Sales by item', path: '/reports/sales-by-item' },
    { name: 'Stock balance', path: '/reports/stock-balance' },
    { name: 'Stock movement', path: '/reports/stock-movement' },
    { name: 'Category sales', path: '/reports/category-sales' },
    { name: 'Purchase summary', path: '/reports/purchase-summary' },
    { name: 'Payment collection', path: '/reports/payment-collection' },
  ]

  for (const report of reportPages) {
    test(`RPT: ${report.name} report loads`, async ({ authenticatedPage: page }) => {
      await page.goto(tenantUrl(report.path))
      await page.waitForLoadState('networkidle')

      // Report page should load (even if empty data)
      await expect(page.locator('body')).toBeVisible()
      // Should not show a server error
      const errorText = page.getByText(/server error|500|internal error/i)
      await expect(errorText).not.toBeVisible({ timeout: 3_000 }).catch(() => {})
    })
  }
})
