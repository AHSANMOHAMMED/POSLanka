/**
 * Whole-app crawl: one vendor per business type, every vendor page as the owner of each type, as
 * every staff role of a supermarket and as the type-specific roles (chef / waiter, technician,
 * dealer sales). A page fails on a page crash (pageerror), a 5xx response, an error screen, a
 * 404, or — for the owner — "No access to this page". 403 API answers on a page the role may open
 * are reported as warnings (the page is offered but its data is refused).
 *
 *   BASE_URL=http://localhost:3000 ADMIN_EMAIL=… ADMIN_PASSWORD=… node scripts/e2e-live/ui-crawl-all.cjs
 *
 * Options: TYPES=retail,restaurant (default all ten), ROLES=owner,cashier (default all),
 * CONCURRENCY=3, CHROME_PATH=/usr/bin/google-chrome, OUT=crawl-result.json.
 * Creates vendors named "crawl…" — run against a local or staging database only.
 */
const { createRequire } = require('module')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const root = path.join(__dirname, '..', '..')
const { chromium } = createRequire(path.join(root, 'package.json'))('@playwright/test')

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '')
const CONCURRENCY = Number(process.env.CONCURRENCY || 3)
const PASSWORD = 'Crawl@12345'
const ALL_TYPES = ['retail', 'supermarket', 'restaurant', 'auto_service', 'dealership', 'pharmacy', 'electronics', 'hardware', 'print_studio', 'office', 'textile']
const STAFF_ROLES = ['manager', 'cashier', 'system_manager', 'accounts_manager', 'sales_manager', 'purchase_manager', 'hr_manager', 'stock_manager', 'pos_user', 'report_user']
const TYPE_ROLES = { restaurant: ['chef', 'waiter'], auto_service: ['technician'], dealership: ['dealer_sales'], electronics: ['technician'], textile: ['technician'], supermarket: STAFF_ROLES }
const types = (process.env.TYPES || ALL_TYPES.join(',')).split(',').filter(Boolean)
const roleFilter = process.env.ROLES ? new Set(process.env.ROLES.split(',')) : null
// Pages that are not part of a signed-in session or that sign the user out
const SKIP = new Set(['/login', '/forgot-password', '/setup', '/locked'])
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

function staticPages() {
  const dir = path.join(root, 'src/app/c/[slug]')
  const out = []
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) { if (!e.name.startsWith('[') && !e.name.startsWith('(') && !e.name.startsWith('_')) walk(path.join(d, e.name), `${rel}/${e.name}`) }
      else if (e.name === 'page.tsx') out.push(rel || '/')
    }
  }
  walk(dir, '')
  return out.filter((p) => !SKIP.has(p)).sort()
}

async function api(method, p, body, cookie) {
  const headers = { 'Content-Type': 'application/json', Origin: BASE }
  if (cookie) headers.Cookie = cookie
  const r = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined })
  let data = null
  try { data = await r.json() } catch { /* not json */ }
  return { status: r.status, data, setCookie: r.headers.get('set-cookie') }
}

async function signIn(browser, slug, login) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await page.goto(`${BASE}/c/${slug}/login`, { waitUntil: 'domcontentloaded' })
  const user = page.locator('input[type="email"], input[name="email"], input[autocomplete="username"]').first()
  await user.fill(login)
  await page.locator('input[type="password"]').first().fill(PASSWORD)
  await page.locator('button[type="submit"]').first().click()
  await page.waitForURL((u) => !u.toString().includes('/login'), { timeout: 30000 })
  await page.close()
  return context
}

async function visit(context, url, isOwner) {
  const page = await context.newPage()
  const problems = []
  const warnings = []
  page.on('pageerror', (e) => problems.push(`crash: ${e.message.slice(0, 200)}`))
  page.on('response', (r) => {
    const u = r.url()
    if (!u.startsWith(BASE)) return
    if (r.status() >= 500) problems.push(`${r.status()} ${u.replace(BASE, '')}`)
    else if (r.status() === 403 && u.includes('/api/')) warnings.push(`403 ${u.replace(BASE, '').split('?')[0]}`)
  })
  let links = []
  try {
    const res = await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).catch(async (e) => {
      problems.push(`timeout: ${e.message.split('\n')[0].slice(0, 120)}`)
      return null
    })
    if (res && res.status() >= 400) problems.push(`page ${res.status()}`)
    await page.waitForTimeout(400)
    const text = await page.locator('body').innerText().catch(() => '')
    if (/Something went wrong|Application error/i.test(text)) problems.push('error screen')
    if (/This page could not be found|404/.test(text.slice(0, 300))) problems.push('not found')
    const landed = new URL(page.url()).pathname
    if (/\/(login|setup|locked)(\/|$)/.test(landed)) problems.push(`redirected to ${landed}`)
    const blocked = /No access to this page/.test(text)
    if (blocked && isOwner) problems.push('owner sees "No access to this page"')
    links = await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href'))).catch(() => [])
    return { problems: [...new Set(problems)], warnings: blocked ? [] : [...new Set(warnings)], blocked, finalUrl: page.url().replace(BASE, ''), links }
  } finally {
    await page.close().catch(() => {})
  }
}

async function pool(items, n, fn) {
  const out = []
  let i = 0
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k) } }))
  return out
}

;(async () => {
  const uid = crypto.randomBytes(3).toString('hex')
  const adm = await api('POST', '/api/sys-control/auth/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })
  if (adm.status !== 200) throw new Error(`admin login failed: ${adm.status} ${JSON.stringify(adm.data)}`)
  const adminCookie = (adm.setCookie || '').split(';')[0]
  const pages = staticPages()
  console.log(`${pages.length} pages, types: ${types.join(', ')}`)
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true })
  const report = { base: BASE, startedAt: new Date().toISOString(), runs: [] }
  const out = process.env.OUT || 'crawl-result.json'
  // Written after every run so a long crawl keeps its results if it is interrupted
  const save = () => fs.writeFileSync(out, JSON.stringify(report, null, 2))

  for (const type of types) {
    const slug = `crawl-${type.replace('_', '')}-${uid}`
    const v = await api('POST', '/api/sys-control/vendors', {
      name: `Crawl ${type} ${uid}`, slug, email: `${slug}@example.test`, phone: '+94771234567', address: 'Colombo',
      businessType: type, plan: 'trial', country: 'LK', currency: 'LKR', ownerName: `Crawl Owner ${type}`, ownerPassword: PASSWORD,
    }, adminCookie)
    if (v.status !== 200) { console.log(`FAIL create vendor ${type}: ${v.status} ${JSON.stringify(v.data)}`); report.runs.push({ type, error: `create vendor ${v.status}` }); continue }
    const vendorId = v.data.vendor.id
    const ownerLogin = v.data.owner.email

    const owner = await signIn(browser, slug, ownerLogin)
    const setup = await owner.request.post(`${BASE}/api/c/${slug}/setup/complete`, { data: {}, headers: { Origin: BASE } })
    if (!setup.ok() && setup.status() !== 400) console.log(`  setup/complete ${setup.status()} ${(await setup.text()).slice(0, 200)}`)

    const roles = ['owner', ...(TYPE_ROLES[type] || [])].filter((r) => !roleFilter || roleFilter.has(r))
    for (const role of roles) {
      let context = owner
      if (role !== 'owner') {
        const login = `${role.replace('_', '')}${uid}@example.test`
        const s = await api('POST', `/api/sys-control/vendors/${vendorId}/staff`, { fullName: `Crawl ${role}`, role, email: login, password: PASSWORD, pin: '4321' }, adminCookie)
        if (s.status !== 200 && s.status !== 201) { console.log(`  FAIL add ${role}: ${s.status} ${JSON.stringify(s.data)}`); continue }
        context = await signIn(browser, slug, login).catch((e) => { console.log(`  FAIL sign in ${role}: ${e.message.split('\n')[0]}`); return null })
        if (!context) { report.runs.push({ type, role, error: 'sign-in failed' }); continue }
      }
      const isOwner = role === 'owner'
      const seenDetail = new Set()
      const results = await pool(pages, CONCURRENCY, (p) => visit(context, `${BASE}/c/${slug}${p}`, isOwner).then((r) => ({ page: p, ...r })))
      // Detail pages: follow one link per route shape found on the list pages (where data exists)
      const detail = []
      for (const r of results) {
        for (const href of r.links || []) {
          if (!href || !href.startsWith(`/c/${slug}/`) || !UUID.test(href)) continue
          const shape = href.replace(`/c/${slug}`, '').replace(new RegExp(UUID.source, 'gi'), '[id]').split('?')[0]
          if (seenDetail.has(shape)) continue
          seenDetail.add(shape)
          detail.push(href.split('#')[0])
        }
      }
      const detailResults = await pool(detail, CONCURRENCY, (h) => visit(context, BASE + h, isOwner).then((r) => ({ page: h.replace(`/c/${slug}`, ''), ...r })))
      const all = [...results, ...detailResults].map(({ links, ...r }) => r) // eslint-disable-line no-unused-vars
      const failed = all.filter((r) => r.problems.length)
      const warned = all.filter((r) => !r.problems.length && r.warnings.length)
      const blocked = all.filter((r) => r.blocked).length
      console.log(`${type} / ${role}: ${all.length} pages, ${failed.length} failed, ${warned.length} with refused data, ${blocked} blocked by role`)
      for (const f of failed) console.log(`   FAIL ${f.page} → ${f.problems.join(' | ')}`)
      report.runs.push({ type, role, pages: all.length, failed, warned, blocked })
      save()
      if (context !== owner) await context.close()
    }
    await owner.close()
  }
  await browser.close()
  save()
  const totalFailed = report.runs.reduce((s, r) => s + (r.failed?.length || 0) + (r.error ? 1 : 0), 0)
  console.log(`\nDone: ${report.runs.length} runs, ${totalFailed} failures → ${out}`)
  process.exit(totalFailed ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(2) })
