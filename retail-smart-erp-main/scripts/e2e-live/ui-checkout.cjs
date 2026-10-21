const { createRequire } = require('module')
const req = createRequire(require('path').join(__dirname, '..', '..', 'package.json'))
const { chromium } = req('@playwright/test')
const crypto = require('crypto')
const BASE = process.env.BASE_URL || 'http://localhost:3000'
const results = []
const ok = (name, pass, info = '') => { results.push({ name, pass, info }); console.log(`${pass ? '  ok ' : ' FAIL'} ${name} ${info}`) }

async function api(method, path, body, token, cookie) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = 'Bearer ' + token
  if (cookie) headers.Cookie = cookie
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
  let data = null; try { data = await r.json() } catch {}
  return { status: r.status, data, setCookie: r.headers.get('set-cookie') }
}
function gtinCd(d) { let s = 0; [...d].reverse().forEach((c, i) => { s += +c * (i % 2 === 0 ? 3 : 1) }); return (10 - s % 10) % 10 }

;(async () => {
  const uid = crypto.randomBytes(4).toString('hex'); const slug = 'ui' + uid
  // ---------- data setup via API
  const adm = await api('POST', '/api/sys-control/auth/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })
  const adminCookie = (adm.setCookie || '').split(';')[0]
  const v = await api('POST', '/api/sys-control/vendors', { name: 'UI Mart ' + uid, slug, email: `o${uid}@ex.com`, businessType: 'supermarket', plan: 'trial', country: 'LK', currency: 'LKR', ownerName: 'UI Owner', ownerPassword: 'Owner@12345' }, null, adminCookie)
  if (v.status !== 200) { console.log('vendor create failed', v.status, v.data); process.exit(1) }
  const vendorId = v.data.vendor.id, email = v.data.owner.email
  const ml = await api('POST', '/api/auth/mobile-login', { email, password: 'Owner@12345', tenantSlug: slug })
  const tok = ml.data.token, ownerId = ml.data.user.id
  const ean = '890' + String(parseInt(uid, 16) % 1e9).padStart(9, '0'); const eanFull = ean + gtinCd(ean)
  await api('POST', '/api/items', { name: 'Coconut Oil 1L', sellingPrice: 950, costPrice: 800, barcode: eanFull, trackStock: false }, tok)
  await api('POST', '/api/items', { name: 'Big Onion', sellingPrice: 400, costPrice: 300, pluCode: '00123', isWeighable: true, trackStock: false }, tok)
  await api('PUT', '/api/tenant', { scaleBarcode: { enabled: true, prefixes: ['2'], pluStart: 2, pluLength: 5, valueStart: 7, valueLength: 5, valueType: 'weight', valueDecimals: 3 } }, tok)
  await api('PUT', `/api/users/${ownerId}`, { pin: '2580' }, tok)
  const scaleBody = '2' + '0' + '00123' + '00750'; const scaleCode = scaleBody + gtinCd(scaleBody)

  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const pageErrors = [], serverErrors = []
  page.on('pageerror', e => pageErrors.push(`${page.url()} :: ${e.message}`))
  page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource: the server responded with a status of 40[134]|WebSocket|ws:\/\//i.test(m.text())) pageErrors.push(`${page.url()} :: console: ${m.text().slice(0, 200)}`) })
  page.on('response', r => { if (r.status() >= 500) serverErrors.push(`${r.status()} ${r.request().method()} ${r.url()}`) })

  // ---------- vendor login
  await page.goto(`${BASE}/c/${slug}/login`)
  await page.fill('input[type="email"]', email)
  await page.fill('input[placeholder="Enter your password"]', 'Owner@12345')
  await page.click('button[type="submit"]')
  await page.waitForURL(u => !u.toString().includes('/login'), { timeout: 30000 }).catch(() => {})
  ok('vendor web login', !page.url().includes('/login'), page.url())

  // ---------- POS
  await page.goto(`${BASE}/c/${slug}/pos`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)
  const openBtn = page.getByRole('button', { name: /open shift/i }).first()
  if (await openBtn.isVisible().catch(() => false)) {
    await openBtn.click()
    await page.waitForTimeout(800)
    const amt = page.locator('input[placeholder="0.00"]').first()
    if (await amt.isVisible().catch(() => false)) await amt.fill('5000')
    await page.getByRole('button', { name: /^open shift$/i }).last().click()
    await page.waitForTimeout(2500)
  }
  const bar = await page.locator('text=/Shift SHIFT|Shift POS|Shift [A-Z]+-?\\d+/').first().textContent().catch(() => '')
  const noShift = await page.locator('text=No open shift').count()
  ok('shift opened from POS', noShift === 0, bar || '')

  const search = page.locator('#pos-search-input')
  await page.keyboard.press('F1')
  ok('F1 focuses search', await search.evaluate(el => el === document.activeElement).catch(() => false))
  await search.fill(eanFull); await search.press('Enter'); await page.waitForTimeout(1500)
  ok('Enter on EAN-13 adds item to cart', await page.locator('text=Coconut Oil 1L').count() > 0)
  ok('search box cleared after scan', (await search.inputValue()) === '')
  await search.fill(scaleCode); await search.press('Enter'); await page.waitForTimeout(1500)
  ok('weighing-scale label adds Big Onion', await page.locator('text=Big Onion').count() > 0)
  const bodyText = await page.locator('body').innerText()
  ok('scale weight 0.75 kg priced 300.00', /300\.00/.test(bodyText), '')

  // F4 discount
  await page.keyboard.press('F4'); await page.waitForTimeout(600)
  const discOpen = await page.locator('text=/Apply Discount|Discount/').count()
  ok('F4 opens discount', discOpen > 0)
  await page.keyboard.press('Escape'); await page.waitForTimeout(400)
  const closeX = page.getByRole('button', { name: /cancel|close/i }).first()
  if (await page.locator('text=Apply Discount').isVisible().catch(() => false)) await closeX.click().catch(() => {})

  // F9 pay + Enter complete
  await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {})
  await page.keyboard.press('F9'); await page.waitForTimeout(1000)
  ok('F9 opens payment', await page.getByRole('button', { name: /complete sale/i }).count() > 0)
  await page.keyboard.press('Enter'); await page.waitForTimeout(3000)
  const inv = await page.locator('text=/INV-\\d+/').first().textContent().catch(() => null)
  ok('Enter completes sale, invoice shown', !!inv, inv || '')
  await page.getByRole('button', { name: /new sale|close|done/i }).first().click().catch(() => {})
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForTimeout(800)

  // Hold F2 / Held F3
  await search.fill(eanFull); await search.press('Enter'); await page.waitForTimeout(1200)
  await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {})
  await page.keyboard.press('F2'); await page.waitForTimeout(1500)
  const held = await api('GET', '/api/held-sales?all=true', null, tok)
  const heldCount = Array.isArray(held.data) ? held.data.length : (held.data?.data || []).length
  ok('F2 holds the sale', heldCount >= 1, `held=${heldCount}`)
  await page.keyboard.press('F3'); await page.waitForTimeout(800)
  ok('F3 opens held sales', await page.locator('text=/Held Sales|Held Orders|Recall/i').count() > 0)
  await page.keyboard.press('Escape'); await page.waitForTimeout(500)

  // F8 lock + PIN unlock
  await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {})
  await page.keyboard.press('F8'); await page.waitForTimeout(800)
  const locked = await page.locator('text=/locked|Unlock/i').count()
  ok('F8 locks terminal', locked > 0)
  for (const d of '2580') { await page.keyboard.press(d); await page.waitForTimeout(80) }
  await page.keyboard.press('Enter').catch(() => {})
  await page.waitForTimeout(1500)
  const unlockBtn = page.getByRole('button', { name: /unlock/i }).first()
  if (await unlockBtn.isVisible().catch(() => false)) { await unlockBtn.click().catch(() => {}); await page.waitForTimeout(1500) }
  ok('PIN unlocks terminal', await page.locator('text=/Terminal Locked|Enter your PIN/i').count() === 0)
  
  // ---------- vendor pages
  for (const p of ['dashboard', 'kds', 'kiosk', 'pos/display', 'barcode/settings', 'buying/grn', 'settings/staff', 'items', 'customers', 'sales']) {
    const before = pageErrors.length + serverErrors.length
    const r = await page.goto(`${BASE}/c/${slug}/${p}`, { waitUntil: 'domcontentloaded' }).catch(e => null)
    await page.waitForTimeout(2500)
    ok(`page /c/{slug}/${p}`, r && r.status() < 400 && pageErrors.length + serverErrors.length === before, r ? String(r.status()) : 'nav failed')
  }

  // ---------- super admin console
  const ap = await ctx.newPage()
  ap.on('pageerror', e => pageErrors.push(`${ap.url()} :: ${e.message}`))
  ap.on('response', r => { if (r.status() >= 500) serverErrors.push(`${r.status()} ${r.request().method()} ${r.url()}`) })
  await ap.goto(`${BASE}/sys-control/login`)
  const pw = await ap.locator('input[type="password"]').inputValue()
  ok('admin login has no prefilled password', pw === '')
  await ap.fill('input[type="email"]', process.env.ADMIN_EMAIL)
  await ap.fill('input[type="password"]', process.env.ADMIN_PASSWORD)
  await ap.locator('button[type="submit"]').click()
  await ap.waitForURL(u => !u.toString().includes('/login'), { timeout: 30000 }).catch(() => {})
  ok('super admin web login', !ap.url().includes('/login'), ap.url())
  for (const p of ['', '/sales-wall', '/vendors', `/vendors/${vendorId}`, '/vendors/create', '/users', '/subscriptions', '/payments', '/pricing', '/error-logs', '/audit-logs', '/messages', '/notifications', '/settings']) {
    const before = pageErrors.length + serverErrors.length
    const r = await ap.goto(`${BASE}/sys-control${p}`, { waitUntil: 'domcontentloaded' }).catch(() => null)
    await ap.waitForTimeout(2500)
    ok(`admin /sys-control${p}`, r && r.status() < 400 && !ap.url().includes('/login') && pageErrors.length + serverErrors.length === before, r ? String(r.status()) : 'nav failed')
  }
  await ap.goto(`${BASE}/sys-control/vendors/${vendorId}`); await ap.waitForTimeout(2500)
  ok('vendor dossier shows today sales', /950|1,250|1250/.test(await ap.locator('body').innerText()))

  await browser.close()
  console.log('\nPAGE ERRORS:', pageErrors.length); pageErrors.slice(0, 25).forEach(e => console.log('  ', e))
  console.log('SERVER 5xx:', serverErrors.length); serverErrors.slice(0, 25).forEach(e => console.log('  ', e))
  console.log(`\nPASSED ${results.filter(r => r.pass).length}/${results.length}`)
})().catch(e => { console.error('SCRIPT ERROR', e); process.exit(1) })
