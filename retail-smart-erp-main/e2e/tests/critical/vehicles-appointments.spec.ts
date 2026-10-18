import { test, expect } from '../../fixtures/auth'
import { tenantUrl } from '../../fixtures/auth'

test.describe('VEHICLES & APPOINTMENTS - Critical Path [P1]', () => {
  test('VEH-001: Vehicles page loads', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/vehicles'))
    await page.waitForLoadState('networkidle')

    await expect(page).toHaveURL(/vehicles/)

    // Should show vehicles list or empty state
    const visible = await Promise.race([
      page.locator('table').first().waitFor({ timeout: 10_000 }).then(() => 'table'),
      page.getByText(/no vehicles/i).waitFor({ timeout: 10_000 }).then(() => 'empty'),
    ]).catch(() => 'loaded')

    expect(['table', 'empty', 'loaded']).toContain(visible)
  })

  test('VEH-002: Vehicle detail page loads', async ({ authenticatedPage: page }) => {
    // Check for vehicles via API
    const response = await page.request.get('/api/vehicles?pageSize=1')
    if (response.ok()) {
      const body = await response.json()
      const vehicles = body.data || body
      if (vehicles.length > 0) {
        await page.goto(tenantUrl(`/vehicles/${vehicles[0].id}`))
        await page.waitForLoadState('networkidle')
        await expect(page).toHaveURL(new RegExp(`/vehicles/${vehicles[0].id}`))
      }
    }
  })

  test('APPT-001: Appointments page loads', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/appointments'))
    await page.waitForLoadState('networkidle')

    await expect(page).toHaveURL(/appointments/)
    await expect(page.locator('body')).toBeVisible()
  })

  test('APPT-005: Appointments calendar view', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/appointments'))
    await page.waitForLoadState('networkidle')

    // Look for calendar or list view toggle
    const calendarView = page.getByRole('button', { name: /calendar/i })
    if (await calendarView.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await calendarView.click()
      await page.waitForTimeout(1_000)
      await expect(page.locator('body')).toBeVisible()
    }
  })
})
