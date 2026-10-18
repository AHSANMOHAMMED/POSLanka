import { test, expect } from '../../fixtures/auth'
import { TEST_TENANT, TEST_USER } from '../../fixtures/auth'

test.describe('API Authentication & Authorization - Critical Path [P1]', () => {
  test('API-001: All major endpoints require authentication', async ({ page }) => {
    const endpoints = [
      '/api/items',
      '/api/customers',
      '/api/sales',
      '/api/work-orders',
      '/api/suppliers',
      '/api/categories',
      '/api/accounting/journal-entries',
      '/api/accounting/payment-entries',
      '/api/accounting/budgets',
    ]

    for (const endpoint of endpoints) {
      const response = await page.request.get(endpoint)
      expect(response.status(), `${endpoint} should require auth`).toBe(401)
    }
  })

  test('API-002: POST endpoints require authentication', async ({ page }) => {
    const endpoints = [
      { url: '/api/items', body: { name: 'Test', sellingPrice: 100 } },
      { url: '/api/customers', body: { name: 'Test Customer' } },
    ]

    for (const { url, body } of endpoints) {
      const response = await page.request.post(url, { data: body })
      expect(response.status(), `POST ${url} should require auth`).toBe(401)
    }
  })

  test('API-003: Authenticated requests succeed', async ({ authenticatedPage: page }) => {
    // Items
    const itemsRes = await page.request.get('/api/items?pageSize=5')
    expect(itemsRes.status()).toBe(200)
    const itemsBody = await itemsRes.json()
    expect(itemsBody).toHaveProperty('data')
    expect(itemsBody).toHaveProperty('pagination')

    // Customers
    const custRes = await page.request.get('/api/customers?pageSize=5')
    expect(custRes.status()).toBe(200)
    const custBody = await custRes.json()
    expect(custBody).toHaveProperty('data')

    // Categories
    const catRes = await page.request.get('/api/categories')
    expect(catRes.status()).toBe(200)
  })

  test('API-004: Pagination works correctly', async ({ authenticatedPage: page }) => {
    const res = await page.request.get('/api/items?page=1&pageSize=2')
    expect(res.status()).toBe(200)
    const body = await res.json()

    expect(body.pagination).toBeDefined()
    expect(body.pagination.page).toBe(1)
    expect(body.pagination.pageSize).toBe(2)
    expect(body.data.length).toBeLessThanOrEqual(2)
  })

  test('API-005: Search filters work', async ({ authenticatedPage: page }) => {
    // Search items with a filter
    const res = await page.request.get('/api/items?search=nonexistent_xyz&pageSize=5')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.data).toBeDefined()
    // No crash, returns empty or filtered results
  })

  test('API-006: Invalid JSON body returns 400', async ({ authenticatedPage: page }) => {
    const res = await page.request.post('/api/items', {
      data: 'not valid json',
      headers: { 'Content-Type': 'application/json' },
    })
    // Should return 400 for invalid data, not 500
    expect([400, 422]).toContain(res.status())
  })
})
