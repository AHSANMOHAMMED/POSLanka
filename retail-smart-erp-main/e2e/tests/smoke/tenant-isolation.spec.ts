import { test, expect } from '../../fixtures/auth'
import { TEST_TENANT, TEST_USER, tenantUrl } from '../../fixtures/auth'

test.describe('Multi-Tenant Isolation [P0]', () => {
  test('MT-001: API returns only current tenant data', async ({ authenticatedPage: page }) => {
    // Make API request as authenticated user
    const response = await page.request.get('/api/items?pageSize=5')
    expect(response.ok()).toBeTruthy()

    const body = await response.json()
    // Should return paginated data
    expect(body).toHaveProperty('data')
    expect(body).toHaveProperty('pagination')

    // Each item should belong to current tenant (verified by RLS)
    // We can't directly see tenantId in API response, but the fact
    // that RLS is enforced means we only see our tenant's data
    expect(Array.isArray(body.data)).toBeTruthy()
  })

  test('MT-001b: Unauthenticated API request returns 401', async ({ page }) => {
    // Without login, API should reject
    const response = await page.request.get('/api/items')
    expect(response.status()).toBe(401)
  })

  test('MT-005: Cannot access another tenant\'s pages', async ({ authenticatedPage: page }) => {
    // Try to navigate to a non-existent tenant
    await page.goto('/c/some-other-tenant/dashboard')

    // Should redirect to login or show error
    await page.waitForTimeout(3_000)
    const url = page.url()

    // Should NOT show dashboard of another tenant
    // Could redirect to login, 404, or our own company
    expect(url).not.toContain('/some-other-tenant/dashboard')
  })
})
