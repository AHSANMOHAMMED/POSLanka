import { test, expect } from '../../fixtures/auth'
import { tenantUrl } from '../../fixtures/auth'

test.describe('HR & PAYROLL - Critical Path [P1]', () => {
  test('HR-001: Employees page loads', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/hr/employees'))
    await page.waitForLoadState('networkidle')

    await expect(page).toHaveURL(/hr\/employees/)
    await expect(page.locator('body')).toBeVisible()
  })

  test('HR-010: Salary components page loads', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/hr/salary-components'))
    await page.waitForLoadState('networkidle')

    await expect(page.locator('body')).toBeVisible()
  })

  test('HR-011: Salary structures page loads', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/hr/salary-structures'))
    await page.waitForLoadState('networkidle')

    await expect(page.locator('body')).toBeVisible()
  })

  test('HR-020: Payroll runs page loads', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/hr/payroll-runs'))
    await page.waitForLoadState('networkidle')

    await expect(page.locator('body')).toBeVisible()
  })

  test('HR-030: Employee advances page loads', async ({ authenticatedPage: page }) => {
    await page.goto(tenantUrl('/hr/employee-advances'))
    await page.waitForLoadState('networkidle')

    await expect(page.locator('body')).toBeVisible()
  })
})
