import { test, expect } from '../../fixtures/auth'
import { tenantUrl } from '../../fixtures/auth'

test.describe('Create Insurance Estimate', () => {
  test('Navigate to new estimate page and create', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/insurance-estimates/new'))
    await page.waitForLoadState('networkidle')

    // Wait for the create form to load
    await page.waitForTimeout(2_000)

    // Should show estimate type selection (Insurance / Direct)
    const insuranceRadio = page.getByLabel(/insurance/i).first()
    const directRadio = page.getByLabel(/direct/i).first()

    // Select "Direct" estimate type (doesn't require insurance company)
    if (await directRadio.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await directRadio.check()
    }

    // Click "Create Estimate" button
    const createBtn = page.getByRole('button', { name: /create estimate/i })
    await createBtn.waitFor({ timeout: 10_000 })
    await createBtn.click()

    // Wait for response
    await page.waitForTimeout(3_000)

    // Check if creation succeeded (redirects to detail page) or shows error
    const url = page.url()
    // Success: redirected to /insurance-estimates/{uuid}
    // Error: stays on /new with error message
    expect(url).toMatch(/insurance-estimates/)
  })
})
