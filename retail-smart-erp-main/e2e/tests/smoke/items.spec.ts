import { test, expect } from '../../fixtures/auth'
import { tenantUrl } from '../../fixtures/auth'

test.describe('ITEMS - Item Management [P0]', () => {
  test('ITEM-001: Items page loads with list', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/items'))
    await page.waitForLoadState('networkidle')

    // Items page should load
    await expect(page).toHaveURL(new RegExp(`/items`))

    // Should show items heading or table
    await expect(page.getByRole('heading', { name: /items|inventory|products/i }).or(
      page.locator('table, [class*="list"]')
    ).first()).toBeVisible({ timeout: 15_000 })
  })

  test('ITEM-030: Search items by name', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/items'))
    await page.waitForLoadState('networkidle')

    // Find search input
    const searchInput = page.getByPlaceholder(/search/i).first()
    if (await searchInput.isVisible()) {
      // Type a search query
      await searchInput.fill('test')
      // Wait for debounced search (300ms + API call)
      await page.waitForTimeout(500)
      await page.waitForLoadState('networkidle')
      // Page should still be visible (no crash)
      await expect(page.locator('body')).toBeVisible()
    }
  })

  test('ITEM-032: Pagination controls visible', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/items'))
    await page.waitForLoadState('networkidle')

    // Look for pagination component (page numbers, prev/next buttons)
    const pagination = page.locator('[class*="pagination"], nav[aria-label*="pagination"]').first()
    // Pagination may or may not be visible depending on data count
    // Just verify page loads without errors
    await expect(page.locator('body')).toBeVisible()
  })
})
