import { test as setup, expect } from '@playwright/test'

setup('verify test environment', async ({ request }) => {
  // Check that the dev server is running and responding
  const healthRes = await request.get('/api/health')
  expect(healthRes.ok()).toBeTruthy()

  // Check that our test tenant's login page loads
  const loginRes = await request.get('/c/gajanayaka/login')
  expect(loginRes.ok()).toBeTruthy()
})
