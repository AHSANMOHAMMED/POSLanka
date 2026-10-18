import { test, expect } from '../../fixtures/auth'
import { tenantUrl } from '../../fixtures/auth'

test.describe('Create Item (Full Flow)', () => {
  const itemName = `E2E Full Item ${Date.now()}`

  test('Create item with name, pricing, and verify in list', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/items'))
    await page.waitForLoadState('networkidle')

    // Click "Add Part" (auto_service) or similar
    const addBtn = page.getByRole('button', { name: /add part|new item|add item/i }).first()
    await addBtn.click()

    // Wait for modal - "New Part" or "New Item"
    await page.waitForTimeout(1_000)

    // === Basic Tab ===
    // Fill Name (first text input in modal)
    const nameInput = page.locator('.fixed input[type="text"]').first()
    await nameInput.waitFor({ timeout: 5_000 })
    await nameInput.fill(itemName)

    // Fill SKU
    const skuInput = page.locator('.fixed input[type="text"]').nth(1)
    if (await skuInput.isVisible()) {
      await skuInput.fill(`SKU-${Date.now()}`)
    }

    // === Pricing Tab ===
    await page.getByText('Pricing').first().click()
    await page.waitForTimeout(300)

    // Cost Price and Selling Price (number inputs on Pricing tab)
    const numberInputs = page.locator('.fixed input[type="number"]')
    const costPriceInput = numberInputs.first()
    const sellingPriceInput = numberInputs.nth(1)

    if (await costPriceInput.isVisible()) {
      await costPriceInput.fill('800')
    }
    if (await sellingPriceInput.isVisible()) {
      await sellingPriceInput.fill('1200')
    }

    // === Save ===
    const saveBtn = page.getByRole('button', { name: /create part|create item|save/i })
    await saveBtn.click()

    // Wait for save to complete
    await page.waitForTimeout(3_000)

    // === Verify item appears in list ===
    // Search for it
    const searchInput = page.getByPlaceholder(/search|name.*sku.*barcode/i).first()
    await searchInput.fill(itemName)
    await page.waitForTimeout(1_000)
    await page.waitForLoadState('networkidle')

    // Item should be visible in the filtered list
    await expect(page.getByText(itemName).first()).toBeVisible({ timeout: 10_000 })
  })

  test('Create item via API and verify it appears', async ({ authenticatedPage: page }) => {
    const apiItemName = `API Item ${Date.now()}`

    // Create via API
    const res = await page.request.post('/api/items', {
      data: {
        name: apiItemName,
        sellingPrice: '999',
        costPrice: '500',
        trackStock: false,
      },
    })
    expect(res.ok()).toBeTruthy()
    const item = await res.json()
    expect(item.name).toBe(apiItemName)
    expect(item.id).toBeTruthy()

    // Navigate to items page and search
    await page.goto(tenantUrl('/items'))
    await page.waitForLoadState('networkidle')

    const searchInput = page.getByPlaceholder(/search|name.*sku.*barcode/i).first()
    await searchInput.fill(apiItemName)
    await page.waitForTimeout(1_000)
    await page.waitForLoadState('networkidle')

    await expect(page.getByText(apiItemName).first()).toBeVisible({ timeout: 10_000 })

    // Clean up - delete the item
    const delRes = await page.request.delete(`/api/items/${item.id}`)
    expect(delRes.ok()).toBeTruthy()
  })
})
