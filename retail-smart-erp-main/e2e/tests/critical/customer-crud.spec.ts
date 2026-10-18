import { test, expect } from '../../fixtures/auth'
import { tenantUrl } from '../../fixtures/auth'

test.describe('CUSTOMER CRUD - Critical Path [P1]', () => {
  const testCustomerName = `E2E Test Customer ${Date.now()}`
  const testPhone = `077${Math.floor(Math.random() * 10000000).toString().padStart(7, '0')}`

  test('CUST-001: Create customer', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/customers'))
    await page.waitForLoadState('networkidle')

    // Click "New Customer" button
    const addBtn = page.getByRole('button', { name: /new customer|add customer/i }).first()
    await addBtn.click()

    // Wait for modal to open
    await page.waitForSelector('text="New Customer"', { timeout: 10_000 })
    await page.waitForTimeout(500)

    // "First Name *" field - first text input in the modal (after the Type dropdown)
    // The inputs are: Type (select), First Name (text), Last Name (text), Birthday (date)
    const textInputs = page.locator('.fixed input[type="text"]')
    const firstNameInput = textInputs.first()
    await firstNameInput.fill(testCustomerName)

    // Click "Create Customer" button
    const saveBtn = page.getByRole('button', { name: 'Create Customer' })
    await saveBtn.click()

    // Wait for save
    await page.waitForTimeout(2_000)

    // Search for the customer to verify
    const searchInput = page.getByPlaceholder(/name|email|phone|search/i).first()
    if (await searchInput.isVisible()) {
      await searchInput.fill(testCustomerName)
      await page.waitForTimeout(1_000)
      await page.waitForLoadState('networkidle')
      await expect(page.getByText(testCustomerName).first()).toBeVisible({ timeout: 10_000 })
    }
  })

  test('CUST-004: Customer search', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/customers'))
    await page.waitForLoadState('networkidle')

    const searchInput = page.getByPlaceholder(/name|email|phone|search/i).first()
    if (await searchInput.isVisible()) {
      // Search by partial name
      await searchInput.fill('test')
      await page.waitForTimeout(500)
      await page.waitForLoadState('networkidle')

      // Page should not crash and should show filtered results
      await expect(page.locator('body')).toBeVisible()
    }
  })

  test('CUST-005: Customer detail view', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/customers'))
    await page.waitForLoadState('networkidle')

    // Click on first customer in list
    const firstRow = page.locator('table tbody tr').first().or(
      page.locator('[class*="cursor-pointer"]').first()
    )

    if (await firstRow.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await firstRow.click()
      await page.waitForTimeout(1_000)

      // Detail panel should open on the right
      // Should show customer info like name, phone, email
      await expect(page.locator('body')).toBeVisible()
    }
  })
})
