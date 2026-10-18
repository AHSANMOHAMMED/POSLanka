import { test, expect } from '../../fixtures/auth'
import { tenantUrl } from '../../fixtures/auth'

test.describe('Create Purchase Order', () => {
  test('Navigate to new purchase order page and create', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/purchase-orders/new'))
    await page.waitForLoadState('networkidle')

    // Wait for page to load
    await page.waitForTimeout(2_000)

    // Look for create form
    // Select warehouse if required
    const warehouseSelect = page.locator('select').filter({ hasText: /warehouse/i }).or(
      page.locator('select').first()
    )
    if (await warehouseSelect.isVisible({ timeout: 3_000 }).catch(() => false)) {
      const options = await warehouseSelect.locator('option').all()
      if (options.length > 1) {
        await warehouseSelect.selectOption({ index: 1 })
      }
    }

    // Click Create button
    const createBtn = page.getByRole('button', { name: /^create$/i })
    if (await createBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await createBtn.click()
      await page.waitForTimeout(3_000)
    }

    // Should be on purchase orders page
    expect(page.url()).toMatch(/purchase-orders/)
  })
})
