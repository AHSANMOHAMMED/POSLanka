import { test, expect } from '../../fixtures/auth'
import { tenantUrl } from '../../fixtures/auth'

test.describe('WebSocket - Real-time Connection [P0]', () => {
  test('WS-001: WebSocket connection established on dashboard', async ({ authenticatedPage: page }) => {
    // Track WebSocket connections
    const wsConnections: string[] = []
    page.on('websocket', ws => {
      wsConnections.push(ws.url())
    })

    await page.goto(tenantUrl('/dashboard'))
    await page.waitForLoadState('networkidle')

    // Give WebSocket time to connect
    await page.waitForTimeout(3_000)

    // Should have at least one WebSocket connection to /ws
    const hasWsConnection = wsConnections.some(url => url.includes('/ws'))
    expect(hasWsConnection).toBeTruthy()
  })

  test('WS-001b: WebSocket connects on items page', async ({ authenticatedPage: page }) => {
    const wsConnections: string[] = []
    page.on('websocket', ws => {
      wsConnections.push(ws.url())
    })

    await page.goto(tenantUrl('/items'))
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(3_000)

    const hasWsConnection = wsConnections.some(url => url.includes('/ws'))
    expect(hasWsConnection).toBeTruthy()
  })
})
