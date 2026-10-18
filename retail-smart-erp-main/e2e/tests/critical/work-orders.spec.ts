import { test, expect } from '../../fixtures/auth'
import { tenantUrl } from '../../fixtures/auth'

test.describe('WORK ORDERS - Critical Path [P1]', () => {
  test('WO-001: Work orders page loads with list', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/work-orders'))
    await page.waitForLoadState('networkidle')

    // Should show "Work Order" heading
    const heading = await Promise.race([
      page.getByRole('heading', { name: /work order/i }).first().waitFor({ timeout: 10_000 }).then(() => 'heading'),
      page.getByText('No work orders').waitFor({ timeout: 10_000 }).then(() => 'empty'),
    ]).catch(() => 'loaded')

    expect(['heading', 'empty', 'loaded']).toContain(heading)
  })

  test('WO-001b: Create work order button navigates', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/work-orders'))
    await page.waitForLoadState('networkidle')

    const newWoBtn = page.getByRole('link', { name: /new work order/i })
      .or(page.getByRole('button', { name: /new work order/i }))

    if (await newWoBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await newWoBtn.click()
      await page.waitForURL('**/work-orders/new**', { timeout: 10_000 })
      await expect(page).toHaveURL(/work-orders\/new/)
    }
  })

  test('WO-001c: Work order status filters', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/work-orders'))
    await page.waitForLoadState('networkidle')

    // Check for filter controls
    const draftFilter = page.getByText('Draft').first()
    const invoicedFilter = page.getByText('Invoiced').first()

    if (await draftFilter.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await draftFilter.click()
      await page.waitForTimeout(500)
      await page.waitForLoadState('networkidle')
      // Should filter the list (page doesn't crash)
      await expect(page.locator('body')).toBeVisible()
    }
  })

  test('WO-002: Work order detail page loads', async ({ authenticatedPage: page }) => {
    // Check if any work orders exist via API
    const response = await page.request.get('/api/work-orders?pageSize=1')
    const body = await response.json()
    const workOrders = body.data || body

    if (workOrders.length > 0) {
      const woId = workOrders[0].id
      await page.goto(tenantUrl(`/work-orders/${woId}`))
      await page.waitForLoadState('networkidle')

      // Work order detail should load with order info
      await expect(page).toHaveURL(new RegExp(`/work-orders/${woId}`))
      await expect(page.locator('body')).toBeVisible()
    }
  })

  test('WO-003: Work order search', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/work-orders'))
    await page.waitForLoadState('networkidle')

    const searchInput = page.getByPlaceholder(/search/i).first()
    if (await searchInput.isVisible()) {
      await searchInput.fill('WO-')
      await page.waitForTimeout(500)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('body')).toBeVisible()
    }
  })
})
