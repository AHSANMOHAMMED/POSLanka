const { createRequire } = require('module')
const req = createRequire(require('path').join(__dirname, '..', '..', 'package.json'))
const { chromium } = req('@playwright/test')
const crypto = require('crypto')
const BASE = process.env.BASE_URL || 'http://localhost:3000'
const results = []
const ok = (name, pass, info = '') => { results.push({ name, pass }); console.log(`${pass ? '  ok ' : ' FAIL'} ${name} ${info}`) }
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
  const uid = crypto.randomBytes(4).toString('hex'); const slug = 'uit' + uid
  const adm = await api('POST', '/api/sys-control/auth/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })
  const cookie = (adm.setCookie || '').split(';')[0]
  const v = await api('POST', '/api/sys-control/vendors', { name: 'UI2 Mart ' + uid, slug, email: `u${uid}@ex.com`, businessType: 'supermarket', plan: 'trial', country: 'LK', currency: 'LKR', ownerName: 'UI2 Owner', ownerPassword: 'Owner@12345' }, null, cookie)
  const email = v.data.owner.email
  const tok = (await api('POST', '/api/auth/mobile-login', { email, password: 'Owner@12345', tenantSlug: slug })).data.token
  const ean = '890' + String(parseInt(uid, 16) % 1e9).padStart(9, '0'); const bc = ean + gtinCd(ean)
  const it = await api('POST', '/api/items', { name: 'Tea 100g', sellingPrice: 500, costPrice: 400, barcode: bc, trackStock: false }, tok)
  const itemId = it.data.id
  const profiles = (await api('GET', '/api/pos-profiles', null, tok)).data
  const prof = (Array.isArray(profiles) ? profiles : profiles.profiles)[0]
  const methods = (prof.paymentMethods || []).map(m => m.paymentMethod)
  if (!methods.includes('card')) await api('POST', `/api/pos-profiles/${prof.id}/payment-methods`, { paymentMethods: [{ paymentMethod: 'cash', isDefault: true }, { paymentMethod: 'card' }] }, tok)
  const shift = await api('POST', '/api/pos-opening-entries', { posProfileId: prof.id, openingBalances: [{ paymentMethod: 'cash', amount: 1000 }, { paymentMethod: 'card', amount: 0 }] }, tok)
  ok('setup: shift opened via API', shift.status === 200, String(shift.status))

  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true })
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  const errors = []
  page.on('pageerror', e => errors.push(`${page.url()} :: ${e.message}`))
  page.on('response', r => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`) })
  await page.goto(`${BASE}/c/${slug}/login`)
  await page.fill('input[type="email"]', email); await page.fill('input[placeholder="Enter your password"]', 'Owner@12345'); await page.click('button[type="submit"]')
  await page.waitForURL(u => !u.toString().includes('/login'))
  await page.goto(`${BASE}/c/${slug}/pos`); await page.waitForTimeout(3500)
  const search = page.locator('#pos-search-input')

  // --- A. split payment cash + card
  await search.fill(bc); await search.press('Enter'); await page.waitForTimeout(800)
  await search.fill(bc); await search.press('Enter'); await page.waitForTimeout(1200)
  await page.locator('body').click({ position: { x: 5, y: 5 } }); await page.keyboard.press('F9'); await page.waitForTimeout(1000)
  const splitBox = page.locator('label:has-text("Split") input[type="checkbox"]').first()
  const hasSplit = await splitBox.isVisible().catch(() => false)
  ok('payment modal offers split tender', hasSplit)
  if (hasSplit) { await splitBox.check(); await page.waitForTimeout(500) }
  await page.getByRole('button', { name: /complete sale/i }).click(); await page.waitForTimeout(3000)
  const inv = (await page.locator('text=/INV-\\d+/').first().textContent().catch(() => '') || '').match(/INV-\d+/)?.[0]
  ok('split sale completed in UI', !!inv, inv || '')
  const sales = (await api('GET', '/api/sales?page=1&pageSize=5', null, tok)).data
  const saleRow = (sales.data || sales).find(s => s.invoiceNo === inv)
  const detail = saleRow ? (await api('GET', `/api/sales/${saleRow.id}`, null, tok)).data : null
  const methodsPaid = [...new Set((detail?.payments || []).filter(p => !p.voidedAt).map(p => p.method))].sort()
  ok('server recorded two payment methods', hasSplit ? methodsPaid.join(',') === 'card,cash' : true, methodsPaid.join(','))
  await page.keyboard.press('Enter'); await page.waitForTimeout(800)

  // --- B. return by scanning the receipt barcode
  await search.fill(inv); await search.press('Enter'); await page.waitForTimeout(2000)
  const saleBtn = page.locator(`button:has-text("${inv}")`).first()
  ok('scanning the receipt code shows the sale', await saleBtn.isVisible().catch(() => false))
  await saleBtn.click().catch(() => {}); await page.waitForTimeout(2000)
  ok('return lines loaded into cart', await page.locator('text=Tea 100g').count() > 0)
    await page.locator('body').click({ position: { x: 5, y: 5 } }); await page.keyboard.press('F9'); await page.waitForTimeout(1200)
    ok('refund dialog defaults to Original methods for a split-paid sale', await page.locator('button:has-text("Original methods")').count() > 0)
  const completeReturn = page.locator('[role="dialog"] button:has-text("Process Refund"), .fixed button:has-text("Process Refund")').last()
  await completeReturn.click().catch(() => {}); await page.waitForTimeout(3000)
    const rtn = (await page.locator('text=/RTN-\\d+/').first().textContent().catch(() => '') || '').match(/RTN-\d+/)?.[0]
  ok('return completed with RTN number', !!rtn, rtn || '')
  const look = await api('GET', `/api/sales/lookup?code=${inv}`, null, tok)
  ok('server shows original fully returned', look.data?.sale?.returnStatus === 'full', look.data?.sale?.returnStatus)
  await page.keyboard.press('Enter'); await page.waitForTimeout(800)

  // --- C. close shift in the UI
  await page.goto(`${BASE}/c/${slug}/pos`); await page.waitForTimeout(3000)
  const closeBtn = page.getByRole('button', { name: /close shift/i }).first()
  await closeBtn.click().catch(() => {}); await page.waitForTimeout(2500)
    ok('shift close dialog shows summary', await page.locator('text=Shift Summary').count() > 0)
  const amountInputs = page.locator('input[type="number"]')
  const n = await amountInputs.count()
  for (let i = 0; i < n; i++) { const el = amountInputs.nth(i); if (await el.isVisible()) { const ph = await el.getAttribute('placeholder'); if (!ph || /0/.test(ph)) await el.fill('0') } }
    await page.getByRole('button', { name: /^close shift$/i }).last().click().catch(() => {}); await page.waitForTimeout(2500)
    const confirmClose = page.getByRole('button', { name: /confirm|close anyway|yes|close shift/i }).last()
  if (await confirmClose.isVisible().catch(() => false)) { await confirmClose.click().catch(() => {}); await page.waitForTimeout(2500) }
  const cur = (await api('GET', '/api/pos-opening-entries?current=true', null, tok)).data
  ok('shift closed on server', cur && cur.hasOpenShift === false)

  // --- D. stock intake on the web page
  await page.goto(`${BASE}/c/${slug}/inventory/stock-intake`); await page.waitForTimeout(3000)
  ok('stock intake page loads', (await page.locator('body').innerText()).toLowerCase().includes('intake'))
  const wh = (await api('GET', '/api/warehouses', null, tok)).data
  const whId = (Array.isArray(wh) ? wh : wh.data || wh.warehouses)[0].id
  const batch = await api('POST', '/api/stock-intake', { warehouseId: whId }, tok)
  await api('POST', `/api/stock-intake/${batch.data.id}/lines`, { lines: [{ mode: 'receive', barcode: bc, quantity: 12 }, { mode: 'receive', barcode: '2999999' + uid.slice(0, 5), quantity: 3, name: 'Intake New Item', sellingPrice: 250 }] }, tok)
  await page.goto(`${BASE}/c/${slug}/inventory/stock-intake/${batch.data.id}`); await page.waitForTimeout(3000)
    ok('intake batch page shows lines', await page.locator('input[value="Intake New Item"]').count() > 0)
  await page.getByRole('button', { name: /^sync/i }).first().click().catch(() => {}); await page.waitForTimeout(1200)
  const confirm = page.getByRole('button', { name: /confirm|sync now|yes/i }).first()
  if (await confirm.isVisible().catch(() => false)) await confirm.click()
  await page.waitForTimeout(4000)
  const after = (await api('GET', `/api/stock-intake/${batch.data.id}`, null, tok)).data
  ok('Sync from the web page posted the batch', after?.batch?.status === 'posted', after?.batch?.status)

  // --- E. receipt settings preview and item history
  await page.goto(`${BASE}/c/${slug}/settings/receipt`); await page.waitForTimeout(3000)
  ok('receipt settings preview renders', /preview/i.test(await page.locator('body').innerText()))
  await page.goto(`${BASE}/c/${slug}/items`); await page.waitForTimeout(3000)
  await page.locator('text=Tea 100g').first().click().catch(() => {}); await page.waitForTimeout(2000)
  const histTab = page.getByRole('button', { name: /^history$/i }).first()
  await histTab.click().catch(() => {}); await page.waitForTimeout(2500)
    ok('item History tab shows entries', await page.locator('text=Item created').count() > 0 && await page.locator('text=/stock_intake|Stock intake/').count() > 0)
    await browser.close()
  console.log('\nERRORS:', errors.length); errors.slice(0, 15).forEach(e => console.log('  ', e))
  console.log(`PASSED ${results.filter(r => r.pass).length}/${results.length}`)
})().catch(e => { console.error('SCRIPT ERROR', e); process.exit(1) })
