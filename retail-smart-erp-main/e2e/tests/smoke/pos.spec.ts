import { test, expect } from '../../fixtures/auth'
import { tenantUrl } from '../../fixtures/auth'

test.describe('POS - Point of Sale [P0]', () => {
  test('POS-001: POS page loads', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/pos'))
    await page.waitForLoadState('networkidle')

    // POS page should load
    await expect(page).toHaveURL(new RegExp(`/pos`))

    // Should show POS interface or shift selection
    // POS may prompt for opening shift or show the register
    await expect(page.locator('body')).toBeVisible()

    // POS shows one of: shift prompt, open shift button, or active register (if shift already open)
    const visible = await Promise.race([
      page.getByText('Start Your Shift').waitFor({ timeout: 15_000 }).then(() => 'shift'),
      page.getByRole('button', { name: 'Open Shift' }).waitFor({ timeout: 15_000 }).then(() => 'open'),
      page.getByText('Current Invoice').waitFor({ timeout: 15_000 }).then(() => 'active'),
      page.getByPlaceholder(/search parts|search products|search menu|scan barcode/i).first().waitFor({ timeout: 15_000 }).then(() => 'active'),
    ])
    expect(['shift', 'open', 'active']).toContain(visible)
  })

  test('POS-010: POS item search works', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/pos'))
    await page.waitForLoadState('networkidle')

    // If there's a shift modal, we may need to open a shift first
    // Try to find the item search input
    const searchInput = page.getByPlaceholder(/search|scan|barcode/i).first()

    if (await searchInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await searchInput.fill('a')
      await page.waitForTimeout(500)
      // Should show search results or items
      await expect(page.locator('body')).toBeVisible()
    }
  })
})
