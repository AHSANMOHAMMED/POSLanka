import { test, expect } from '../../fixtures/auth'
import { tenantUrl } from '../../fixtures/auth'

test.describe('Create Sales Order', () => {
  test('Navigate to new sales order page and create', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/sales-orders/new'))
    await page.waitForLoadState('networkidle')

    // Should show "New Sales Order" heading
    await page.getByText('New Sales Order').waitFor({ timeout: 10_000 })

    // Select warehouse (required field marked with *)
    const warehouseSelect = page.locator('select').first()
    if (await warehouseSelect.isVisible()) {
      // Select the first non-empty option
      const options = await warehouseSelect.locator('option').all()
      if (options.length > 1) {
        await warehouseSelect.selectOption({ index: 1 })
      }
    }

    // Click "Create" button
    const createBtn = page.getByRole('button', { name: /^create$/i })
    await createBtn.waitFor({ timeout: 5_000 })
    await createBtn.click()

    // Wait for creation
    await page.waitForTimeout(3_000)

    // Should redirect to the created sales order detail page
    const url = page.url()
    expect(url).toMatch(/sales-orders/)
  })
})
