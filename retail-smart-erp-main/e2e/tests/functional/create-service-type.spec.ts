import { test, expect } from '../../fixtures/auth'
import { tenantUrl } from '../../fixtures/auth'

test.describe('Create Service Type', () => {
  const serviceName = `E2E Service ${Date.now()}`

  test('Create a new service type via modal', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/service-types'))
    await page.waitForLoadState('networkidle')

    // Click "Add Service Type" button
    await page.getByRole('button', { name: /add service type/i }).click()

    // Wait for modal
    await page.getByText('New Service Type').waitFor({ timeout: 5_000 })

    // Fill fields - labels aren't linked via <label for>, use positional selectors
    // Modal has: Name (text input), Group (select), Default Hours (text), Default Rate (text), Description (textarea)
    const modalInputs = page.locator('.fixed input[type="text"], .fixed input:not([type])')
    const nameInput = modalInputs.first()
    await nameInput.waitFor({ timeout: 5_000 })
    await nameInput.fill(serviceName)

    // Fill optional fields - Default Hours and Default Rate
    const hoursInput = modalInputs.nth(1)
    if (await hoursInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await hoursInput.fill('2')
    }

    const rateInput = modalInputs.nth(2)
    if (await rateInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await rateInput.fill('75')
    }

    // Click Create button
    await page.getByRole('button', { name: /^create$/i }).click()

    // Wait for success - modal should close
    await page.waitForTimeout(2_000)

    // Verify service type appears in the list
    await expect(page.getByText(serviceName).first()).toBeVisible({ timeout: 10_000 })
  })
})
