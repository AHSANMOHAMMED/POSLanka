import { performance } from 'perf_hooks'

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'

async function authenticate(email, password) {
  const csrfRes = await fetch(`${BASE_URL}/api/auth/csrf`)
  const csrfData = await csrfRes.json()
  const csrfCookie = csrfRes.headers.get('set-cookie') || ''
  const csrfToken = csrfData.csrfToken

  const signInRes = await fetch(`${BASE_URL}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: csrfCookie,
    },
    body: new URLSearchParams({
      email,
      password,
      tenantSlug: 'demo-retail',
      csrfToken,
    }).toString(),
    redirect: 'manual',
  })

  const setCookies = signInRes.headers.getSetCookie ? signInRes.headers.getSetCookie() : [signInRes.headers.get('set-cookie') || '']
  const sessionCookies = setCookies.map(c => c.split(';')[0]).join('; ')
  return `${csrfCookie.split(';')[0]}; ${sessionCookies}`
}

async function measurePage(name, path, cookie) {
  const start = performance.now()
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: cookie ? { Cookie: cookie } : {},
    redirect: 'follow',
  })
  const durationMs = Math.round(performance.now() - start)
  const html = await res.text()

  return {
    name,
    path,
    status: res.status,
    durationMs,
    bytes: html.length,
    hasContent: html.length > 300,
  }
}

async function run() {
  console.log('Authenticating test users (Admin & Cashier)...')
  const adminCookie = await authenticate('admin@demo.poslanka.lk', 'Admin@123456')
  const cashierCookie = await authenticate('cashier@demo.poslanka.lk', 'Cashier@123456')

  const coreRoutes = [
    { name: 'Login Page', path: '/c/demo-retail/login', cookie: null },
    { name: 'Dashboard Page (Admin)', path: '/c/demo-retail/dashboard', cookie: adminCookie },
    { name: 'Cashier POS Page', path: '/c/demo-retail/pos', cookie: cashierCookie },
    { name: 'Items Catalog Page', path: '/c/demo-retail/items', cookie: adminCookie },
    { name: 'Customers Page', path: '/c/demo-retail/customers', cookie: adminCookie },
    { name: 'Sales History Page', path: '/c/demo-retail/sales', cookie: adminCookie },
    { name: 'Items Catalog API', path: '/api/items?pageSize=10', cookie: adminCookie },
    { name: 'Dashboard Stats API', path: '/api/dashboard/stats', cookie: adminCookie },
    { name: 'Tenant Config API', path: '/api/tenant', cookie: cashierCookie },
    { name: 'Categories API', path: '/api/categories?all=true', cookie: cashierCookie },
    { name: 'Label Templates API', path: '/api/label-templates', cookie: adminCookie },
    { name: 'Public Info API (Cached)', path: '/api/c/demo-retail/public-info', cookie: null },
  ]

  console.log('\n--- WARM-UP PASS ---')
  for (const page of coreRoutes) {
    const res = await measurePage(page.name, page.path, page.cookie)
    console.log(`[Warmup] ${page.name.padEnd(26)}: ${res.durationMs}ms (Status: ${res.status})`)
  }

  console.log('\n--- RAPID CLICK & NAVIGATION BENCHMARK (ALL UNDER 10s TARGET) ---')
  const results = []
  for (const page of coreRoutes) {
    const res = await measurePage(page.name, page.path, page.cookie)
    results.push(res)
    const statusMark = res.durationMs < 10000 ? '✅ UNDER 10s' : '❌ SLOW'
    console.log(`[${res.status}] ${res.name.padEnd(26)} | ${res.path.padEnd(32)} | Time: ${String(res.durationMs).padStart(4)}ms | Size: ${String(res.bytes).padStart(6)}B | Visible: ${res.hasContent ? 'YES' : 'NO'} | ${statusMark}`)
  }

  console.log('\n--- FINAL BENCHMARK SUMMARY JSON ---')
  console.log(JSON.stringify(results, null, 2))
}

run().catch(console.error)
