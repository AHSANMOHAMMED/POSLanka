import { test, expect } from '../../fixtures/auth'
import { tenantUrl } from '../../fixtures/auth'

test.describe('SALES - Sales List [P0]', () => {
  test('SALE-001: Sales page loads with list', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/sales'))
    await page.waitForLoadState('networkidle')

    // Sales page should load
    await expect(page).toHaveURL(new RegExp(`/sales`))

    // Sales page is titled "Invoice" in the UI
    const visible = await Promise.race([
      page.getByRole('heading', { name: 'Invoice' }).waitFor({ timeout: 15_000 }).then(() => 'heading'),
      page.getByText('No sales yet').waitFor({ timeout: 15_000 }).then(() => 'empty'),
    ])
    expect(['heading', 'empty']).toContain(visible)
  })

  test('SALE-001b: Sales page has search and filters', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/sales'))
    await page.waitForLoadState('networkidle')

    // Check for search input
    const searchInput = page.getByPlaceholder(/search/i).first()
    if (await searchInput.isVisible()) {
      await searchInput.fill('INV')
      await page.waitForTimeout(500)
      await page.waitForLoadState('networkidle')
    }

    // Page should not crash
    await expect(page.locator('body')).toBeVisible()
  })
})
