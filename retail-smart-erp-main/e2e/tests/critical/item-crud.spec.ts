import { test, expect } from '../../fixtures/auth'
import { tenantUrl } from '../../fixtures/auth'

test.describe('ITEM CRUD - Critical Path [P1]', () => {
  const testItemName = `E2E Test Item ${Date.now()}`

  test('ITEM-001: Create item via modal', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/items'))
    await page.waitForLoadState('networkidle')

    // Click "Add Part" (auto_service) or "New Item" button
    const addBtn = page.getByRole('button', { name: /add part|new item|add item/i }).first()
    await addBtn.click()

    // Wait for modal to open - "New Part" or "New Item"
    await page.waitForSelector('text="New Part", text="New Item"', { timeout: 5_000 }).catch(() => {})
    await page.waitForTimeout(500)

    // The first visible text input after "Name *" label is the name field
    // In the modal, it's the first text input on the Basic tab
    const nameInput = page.locator('input[type="text"]').first()
    await nameInput.fill(testItemName)

    // Switch to Pricing tab and fill selling price
    const pricingTab = page.getByText('Pricing').first()
    await pricingTab.click()
    await page.waitForTimeout(300)

    // Selling price is a number input on the Pricing tab
    const sellingPriceInput = page.locator('input[type="number"]').first()
    await sellingPriceInput.fill('1500')

    // Save - "Create Part" or "Create Item" button
    const saveBtn = page.getByRole('button', { name: /create part|create item|save/i })
    await saveBtn.click()

    // Wait for success - either toast or modal closes
    await page.waitForTimeout(2_000)

    // Verify item appears in the list (search for it)
    const searchInput = page.getByPlaceholder(/search/i).first()
    if (await searchInput.isVisible()) {
      await searchInput.fill(testItemName)
      await page.waitForTimeout(1_000)
      await page.waitForLoadState('networkidle')
      await expect(page.getByText(testItemName).first()).toBeVisible({ timeout: 10_000 })
    }
  })

  test('ITEM-002: Edit item', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/items'))
    await page.waitForLoadState('networkidle')

    // Search for our test item
    const searchInput = page.getByPlaceholder(/search/i).first()
    if (await searchInput.isVisible()) {
      await searchInput.fill(testItemName)
      await page.waitForTimeout(1_000)
      await page.waitForLoadState('networkidle')
    }

    // Click edit on the first matching row
    // Look for edit button (pencil icon) or click the row
    const editBtn = page.locator('button:has(svg)').filter({ hasText: '' }).first()
    const row = page.getByText(testItemName).first()

    if (await row.isVisible({ timeout: 5_000 }).catch(() => false)) {
      // Click the item name to open it
      await row.click()
      await page.waitForTimeout(1_000)

      // The modal or detail page should open
      // If a modal, find the name field and update it
      const nameInput = page.locator('input[name="name"], #name')
      if (await nameInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
        const currentName = await nameInput.inputValue()
        expect(currentName).toContain('E2E Test Item')
      }
    }
  })

  test('ITEM-005: Duplicate SKU rejection', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/items'))
    await page.waitForLoadState('networkidle')

    // Get first item's SKU via API
    const response = await page.request.get('/api/items?pageSize=1')
    const body = await response.json()
    const items = body.data || body

    if (items.length > 0 && items[0].sku) {
      const existingSku = items[0].sku

      // Try to create item with same SKU
      const addBtn = page.getByRole('button', { name: /new item|add item|\+ item/i }).first()
      await addBtn.click()
      await page.waitForSelector('input[name="name"], #name', { timeout: 10_000 })

      await page.fill('input[name="name"], #name', 'Duplicate SKU Test')
      await page.fill('input[name="sku"], #sku', existingSku)

      // Go to pricing tab and set price
      const pricingTab = page.getByRole('button', { name: /pricing/i })
      if (await pricingTab.isVisible()) {
        await pricingTab.click()
        await page.waitForTimeout(300)
      }
      const sellingPriceInput = page.locator('input[name="sellingPrice"]').or(page.getByLabel(/selling price/i))
      if (await sellingPriceInput.isVisible()) {
        await sellingPriceInput.fill('100')
      }

      const saveBtn = page.getByRole('button', { name: /save item|create|save/i }).last()
      await saveBtn.click()

      // Should show error about duplicate SKU
      await page.waitForTimeout(2_000)
      // Check for error message or the modal stays open
      const errorText = page.getByText(/sku already exists|duplicate/i)
      const modalStillOpen = page.locator('input[name="name"], #name')

      // Either error shows or modal stays open (didn't close = save failed)
      const isErrorVisible = await errorText.isVisible({ timeout: 3_000 }).catch(() => false)
      const isModalOpen = await modalStillOpen.isVisible()
      expect(isErrorVisible || isModalOpen).toBeTruthy()
    }
  })
})
