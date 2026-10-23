/**
 * Browser end-to-end check of the super-admin vendor detail page: every tab and every action
 * (feature switches, change plan, extend, reset owner password, sign-in email, suspend/reactivate,
 * open as owner, archive), each effect verified independently through the API and real sign-ins.
 * Creates its own throwaway vendor (e2e…).
 *
 *   BASE_URL=http://localhost:3000 ADMIN_EMAIL=… ADMIN_PASSWORD=… node scripts/e2e-live/ui-vendor-page.cjs
 */
const { chromium } = require('playwright')
const BASE = process.env.BASE_URL || 'http://localhost:3000'
const ADMIN = { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }
const uid = Math.random().toString(36).slice(2, 8)
const results = []
const ok = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${!pass && detail ? '  — ' + String(detail).slice(0, 300) : ''}`) }

async function mobileLogin(email, password, businessId) {
  const r = await fetch(`${BASE}/api/auth/mobile-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, businessId }) })
  return r.status
}

;(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true })
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const pageErrors = []; const badApi = []
  page.on('pageerror', (e) => pageErrors.push(e.message.slice(0, 200)))
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) badApi.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')}`) })
  const api = async (method, path, body) => {
    const r = await page.request.fetch(BASE + path, { method, data: body, headers: { 'content-type': 'application/json', origin: BASE } })
    let j = null; try { j = await r.json() } catch {}
    return { status: r.status(), body: j }
  }
  const dialogBtn = (name) => page.locator('[role="dialog"]').getByRole('button', { name, exact: true })
  const flash = async () => (await page.locator('[role="status"], [role="alert"]').allInnerTexts().catch(() => [])).join(' | ')
  const openAction = async (name) => { await page.getByRole('button', { name, exact: true }).click(); await page.locator('[role="dialog"]').waitFor({ timeout: 10000 }) }
  const reason = async (text = 'E2E check') => { await page.locator('#act-reason').fill(text) }
  const waitDialogClosed = async () => { await page.locator('[role="dialog"]').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {}) ; await page.waitForTimeout(800) }

  // ---- sign in as super admin
  await page.goto(`${BASE}/sys-control/login`, { waitUntil: 'load' })
  await page.fill('input[type="email"]', ADMIN.email)
  await page.fill('input[type="password"]', ADMIN.password)
  await page.keyboard.press('Enter')
  await page.waitForURL((u) => !u.toString().includes('/login'), { timeout: 30000 })

  // ---- fresh vendor
  const created = await api('POST', '/api/sys-control/vendors', {
    name: `E2E Vendor ${uid}`, slug: `e2e${uid}`, email: `owner-${uid}@example.test`, businessType: 'retail',
    country: 'LK', currency: 'LKR', ownerName: 'E2E Owner', ownerPassword: 'Owner@12345',
  })
  ok('create test vendor via API', created.status === 200 || created.status === 201, JSON.stringify(created.body))
  const vendor = created.body?.vendor; const ownerEmail = created.body?.owner?.email
  const id = vendor?.id; const businessId = vendor?.businessId
  const detail = async () => (await api('GET', `/api/sys-control/vendors/${id}`)).body

  // ---- page load
  await page.goto(`${BASE}/sys-control/vendors/${id}`, { waitUntil: 'load' })
  await page.waitForTimeout(2500)
  const bodyText = await page.locator('body').innerText()
  ok('page loads without error', !bodyText.includes('Could not load the vendor'), bodyText.slice(0, 200))
  ok('shows vendor name and Business ID', bodyText.includes(`E2E Vendor ${uid}`) && bodyText.replace(/-/g, '').includes(businessId), businessId)
  ok('stat cards render (Active users, Plan)', /Active users/.test(bodyText) && /Plan/.test(bodyText))

  // ---- tabs
  for (const [tab, expect] of [['Staff', ownerEmail], ['Billing', 'Subscription'], ['Features', 'Feature switches'], ['Activity', 'Admin activity'], ['Overview', 'Manage vendor']]) {
    await page.getByRole('radio', { name: tab }).or(page.getByRole('tab', { name: tab })).or(page.getByRole('button', { name: tab, exact: true })).first().click()
    await page.waitForTimeout(700)
    const t = await page.locator('body').innerText()
    ok(`tab ${tab} shows "${expect}"`, t.includes(expect), t.slice(0, 160))
  }

  // ---- features: toggle one switch, save, verify, restore
  await page.getByRole('radio', { name: 'Features' }).or(page.getByRole('tab', { name: 'Features' })).or(page.getByRole('button', { name: 'Features', exact: true })).first().click()
  await page.waitForTimeout(600)
  const before = (await detail()).vendor?.featureFlags || {}
  const sw = page.locator('[role="switch"]').first()
  const swName = (await sw.getAttribute('aria-label')) || (await sw.locator('xpath=..').innerText().catch(() => ''))
  await sw.click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForTimeout(1500)
  const after = (await detail()).vendor?.featureFlags || {}
  const changed = Object.keys({ ...before, ...after }).filter((k) => !!before[k] !== !!after[k])
  ok('features: one switch saved to the server', changed.length === 1, `${swName} changed=${changed}`)
  if (process.env.FEATURE_RELOAD) {
    await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1500)
    await page.getByRole('radio', { name: 'Features' }).or(page.getByRole('tab', { name: 'Features' })).or(page.getByRole('button', { name: 'Features', exact: true })).first().click()
    await page.waitForTimeout(600)
  }
  await sw.click(); await page.getByRole('button', { name: 'Save', exact: true }).click({ timeout: 8000 }).catch(() => ok('features: Save enabled after switching back', false, 'Save stayed disabled'))
  await page.waitForTimeout(1500)
  const restored = (await detail()).vendor?.featureFlags || {}
  ok('features: switch restored', Object.keys(before).every((k) => !!before[k] === !!restored[k]))

  await page.getByRole('radio', { name: 'Overview' }).or(page.getByRole('tab', { name: 'Overview' })).or(page.getByRole('button', { name: 'Overview', exact: true })).first().click()
  await page.waitForTimeout(600)

  // ---- change plan
  const tier0 = (await detail()).subscription?.tier?.id
  await openAction('Change plan')
  const tierSelect = page.locator('[role="dialog"] select').first()
  const opts = await tierSelect.locator('option').evaluateAll((os) => os.map((o) => o.value).filter(Boolean))
  const target = opts.find((v) => v !== tier0)
  if (target) await tierSelect.selectOption(target)
  await reason(); await dialogBtn('Change plan').click(); await waitDialogClosed()
  const tier1 = (await detail()).subscription?.tier?.id
  ok('change plan: subscription tier changed', !!target && tier1 === target, `${tier0} → ${tier1} (options ${opts.length})`)

  await page.goto(`${BASE}/sys-control/vendors/${id}`, { waitUntil: 'load' }); await page.waitForTimeout(1500)
  // ---- extend trial / subscription
  const sub0 = (await detail()).subscription
  const end0 = sub0?.trialEndsAt || sub0?.currentPeriodEnd
  const extendLabel = (await page.getByRole('button', { name: 'Extend trial', exact: true }).count()) ? 'Extend trial' : 'Extend subscription'
  if (await page.getByRole('button', { name: extendLabel, exact: true }).isEnabled()) {
    await openAction(extendLabel)
    await page.locator('#act-days').fill('7'); await reason()
    await dialogBtn('Extend').click(); await waitDialogClosed()
    const sub1 = (await detail()).subscription
    const end1 = sub1?.trialEndsAt || sub1?.currentPeriodEnd
    const days = end0 && end1 ? Math.round((new Date(end1) - new Date(end0)) / 86400000) : null
    ok(`${extendLabel}: end date moved by 7 days`, days === 7 || (!end0 && !!end1), `${end0} → ${end1}`)
  } else ok(`${extendLabel} button enabled`, false, 'disabled (plan never expires?)')

  // ---- reset owner password (temporary)
  await openAction('Reset owner password')
  await page.locator('[role="dialog"]').getByText('Set a temporary password').click()
  await reason().catch(() => {})
  await dialogBtn('Set temporary password').click()
  await page.waitForTimeout(2500)
  const dlgText = await page.locator('[role="dialog"]').innerText().catch(() => '')
  const temp = (dlgText.match(/\b[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}\b/) || [])[0]
  ok('reset password: temporary password shown once', !!temp, dlgText.slice(0, 200))
  await dialogBtn('Done').click().catch(() => {}); await waitDialogClosed()
  ok('reset password: old password no longer works', (await mobileLogin(ownerEmail, 'Owner@12345', businessId)) === 401)
  ok('reset password: temporary password signs in', temp ? (await mobileLogin(ownerEmail, temp, businessId)) === 200 : false)

  // ---- email sign-in details / invitation
  const welcomeLabel = (await page.getByRole('button', { name: 'Resend invitation', exact: true }).count()) ? 'Resend invitation' : 'Email sign-in details'
  await openAction(welcomeLabel)
  await dialogBtn('Send email').click(); await waitDialogClosed()
  const fw = await flash()
  ok(`${welcomeLabel}: completes with a message`, fw.length > 0 && !/fail|error/i.test(fw), fw)

  // ---- suspend → sign-in blocked → reactivate → sign-in works
  await openAction('Suspend sign-in'); await reason()
  await dialogBtn('Suspend').click().catch(async () => dialogBtn('Suspend sign-in').click()); await waitDialogClosed()
  ok('suspend: vendor status suspended', (await detail()).vendor?.status === 'suspended')
  const blocked = await mobileLogin(ownerEmail, temp || 'x', businessId)
  ok('suspend: owner cannot sign in', blocked !== 200, blocked)
  await page.goto(`${BASE}/sys-control/vendors/${id}`, { waitUntil: 'load' }); await page.waitForTimeout(1500)
  await openAction('Reactivate'); await reason().catch(() => {})
  await dialogBtn('Reactivate').click(); await waitDialogClosed()
  ok('reactivate: vendor status active', (await detail()).vendor?.status === 'active')
  ok('reactivate: owner can sign in again', temp ? (await mobileLogin(ownerEmail, temp, businessId)) === 200 : false)

  // ---- open as owner (impersonation) in a new tab
  await page.goto(`${BASE}/sys-control/vendors/${id}`, { waitUntil: 'load' }); await page.waitForTimeout(1500)
  await openAction('Open as owner'); await reason('E2E support check').catch(() => {})
  const [popup] = await Promise.all([ctx.waitForEvent('page', { timeout: 20000 }).catch(() => null), dialogBtn('Open vendor app').click()])
  if (popup) {
    await popup.waitForLoadState('load').catch(() => {})
    await popup.waitForURL((u) => !u.toString().startsWith('about:') && !u.toString().includes('/impersonat'), { timeout: 30000 }).catch(() => {})
    await popup.waitForTimeout(2500)
    const u = popup.url()
    ok('open as owner: new tab lands inside the vendor app', u.includes(`/c/e2e${uid}/`) && !u.includes('/login'), u)
    await popup.close()
  } else ok('open as owner: new tab opened', false)
  await waitDialogClosed()

  // ---- archive (type Business ID) → reactivate
  await page.goto(`${BASE}/sys-control/vendors/${id}`, { waitUntil: 'load' }); await page.waitForTimeout(1500)
  await openAction('Archive vendor'); await reason()
  await page.locator('#act-confirm').fill(businessId)
  await dialogBtn('Archive').click(); await waitDialogClosed()
  ok('archive: vendor status cancelled (soft)', (await detail()).vendor?.status === 'cancelled')
  await page.goto(`${BASE}/sys-control/vendors/${id}`, { waitUntil: 'load' }); await page.waitForTimeout(1500)
  await openAction('Reactivate'); await reason().catch(() => {})
  await dialogBtn('Reactivate').click(); await waitDialogClosed()
  ok('archive → reactivate: vendor active again', (await detail()).vendor?.status === 'active')

  // ---- activity tab lists the actions
  await page.goto(`${BASE}/sys-control/vendors/${id}`, { waitUntil: 'load' }); await page.waitForTimeout(1500)
  await page.getByRole('radio', { name: 'Activity' }).or(page.getByRole('tab', { name: 'Activity' })).or(page.getByRole('button', { name: 'Activity', exact: true })).first().click()
  await page.waitForTimeout(800)
  const act = (await detail()).activity || []
  ok('activity: admin actions recorded (≥ 8)', act.length >= 8, act.length)

  // ---- phone width
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(800)
  ok('phone width: no horizontal overflow', !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2)))

  ok('no page errors', pageErrors.length === 0, pageErrors.join(' | '))
  ok('no 5xx API responses', badApi.length === 0, badApi.join(' | '))
  console.log(`VENDOR ${id} ${businessId}`)
  console.log(`${results.filter(Boolean).length}/${results.length} passed`)
  await b.close()
  process.exit(results.every(Boolean) ? 0 : 1)
})().catch((e) => { console.error(e); process.exit(2) })
