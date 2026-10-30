/**
 * L17 — super-admin vendor reports and data export.
 *
 *   NEXTAUTH_SECRET=i3-test-secret \
 *   DATABASE_URL=postgresql://postgres:<pw>@127.0.0.1:5433/poslanka_<db> DATABASE_APP_ROLE=app_user \
 *   npx tsx --tsconfig scripts/tests/i3-harness/tsconfig.json scripts/tests/l17-admin-business.ts
 *
 * Covers: sales, cost, gross profit, stock value, money owed, purchases and expenses of one vendor
 * for a period (voids, returns, tax and other vendors handled; matches ownerDashboard); item report
 * (returns net, removed items, search, sort, CSV); vendor list figures; bulk ZIP and single-table
 * CSV (secrets never present, formulas neutralised, negative numbers kept, other vendors' rows
 * absent, sections); permissions per role; audit rows on the vendor.
 * Throw-away data is removed at the end unless KEEP_TEST_DATA=1.
 */
import { Client } from 'pg'
import zlib from 'zlib'
import { randomBytes, randomUUID } from 'crypto'
import { NextRequest } from 'next/server'
import { setTestCookie, setTestHeader } from './i3-harness/next-headers-mock'
import { closeAllPools, withTenant } from '@/lib/db'
import { ownerDashboard } from '@/lib/dashboard/owner'
import { periodDates, resolvePeriod } from '@/lib/admin/vendor-business'
import { POST as createVendor } from '@/app/api/sys-control/vendors/route'
import { GET as figuresGET } from '@/app/api/sys-control/vendors/figures/route'
import { GET as businessGET } from '@/app/api/sys-control/vendors/[id]/business/route'
import { GET as itemsGET } from '@/app/api/sys-control/vendors/[id]/business/items/route'
import { GET as exportGET } from '@/app/api/sys-control/vendors/[id]/export/route'
import { GET as tableExportGET } from '@/app/api/sys-control/vendors/[id]/data/[table]/export/route'
import { GET as listRows } from '@/app/api/sys-control/vendors/[id]/data/[table]/route'

type J = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const DB_GUARD = /@(127\.0\.0\.1|localhost)(:\d+)?\/poslanka_[a-z0-9_]+$/i
const results: Array<{ name: string; ok: boolean }> = []
function check(name: string, ok: boolean, detail?: unknown) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== undefined ? `  — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`)
}
async function step(name: string, fn: () => Promise<void>) {
  try { await fn() } catch (err) { check(name, false, err instanceof Error ? err.stack : String(err)) }
}

globalThis.__broadcastProcessor = () => undefined
globalThis.__accountBroadcastProcessor = () => undefined

let ip = 1
function req(method: string, url: string, body?: unknown): NextRequest {
  const addr = `10.47.${Math.floor(ip / 250)}.${ip++ % 250}`
  setTestHeader('x-forwarded-for', addr)
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': addr },
  })
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const ctxT = (id: string, table: string) => ({ params: Promise.resolve({ id, table }) })
async function json(res: Response): Promise<{ status: number; body: J }> {
  return { status: res.status, body: await res.json().catch(() => ({})) as J }
}

function unzip(buf: Buffer): Map<string, string> {
  const out = new Map<string, string>()
  let eocd = buf.length - 22
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--
  if (eocd < 0) throw new Error('no end of central directory')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10)
    const crc = buf.readUInt32LE(p + 16)
    const csize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    const lNameLen = buf.readUInt16LE(local + 26)
    const lExtra = buf.readUInt16LE(local + 28)
    const data = buf.subarray(local + 30 + lNameLen + lExtra, local + 30 + lNameLen + lExtra + csize)
    const raw = method === 8 ? zlib.inflateRawSync(data) : data
    if ((zlib.crc32(raw) >>> 0) !== crc) throw new Error(`crc mismatch for ${name}`)
    out.set(name, raw.toString('utf8'))
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url || !DB_GUARD.test(url)) throw new Error('Refusing to run: DATABASE_URL must point at a local poslanka_<name> test database')
  if (!process.env.NEXTAUTH_SECRET) process.env.NEXTAUTH_SECRET = 'i3-test-secret'
  const pg = new Client({ connectionString: url })
  await pg.connect()

  const tag = randomBytes(3).toString('hex')
  const tenantIds: string[] = []
  const adminIds: string[] = []
  const session = async (role: string) => {
    const id = randomUUID()
    const token = randomBytes(32).toString('hex')
    await pg.query(`INSERT INTO super_admins (id, email, password_hash, full_name, role) VALUES ($1, $2, 'x', 'L17 Admin', $3)`, [id, `l17-${role}-${tag}@example.test`, role])
    await pg.query(`INSERT INTO admin_sessions (super_admin_id, session_token, last_activity_at, expires_at) VALUES ($1, $2, now(), now() + interval '1 hour')`, [id, token])
    adminIds.push(id)
    return { id, use: () => setTestCookie('admin_session', token) }
  }

  const tiers = (await pg.query(`SELECT id, name, price_monthly FROM pricing_tiers WHERE is_active ORDER BY sort_order, price_monthly`)).rows
  const tier = tiers.find((t) => Number(t.price_monthly) > 0 && !String(t.name).startsWith('gf-')) ?? tiers[0]
  const owner = await session('owner')
  const support = await session('support')
  const viewer = await session('viewer')

  const makeVendor = async (n: number) => {
    owner.use()
    const res = await json(await createVendor(req('POST', '/api/sys-control/vendors', {
      name: `L17 Shop ${n} ${tag}`, slug: `l17-shop-${n}-${tag}`, email: `l17-shop-${n}-${tag}@example.test`,
      phone: `+9476${String(Date.now() + n).slice(-7)}`, address: 'Colombo', businessType: 'retail',
      tierId: tier.id, billingCycle: 'monthly', ownerName: 'L17 Owner', ownerEmail: `l17-owner-${n}-${tag}@example.test`, ownerPassword: 'Owner@12345',
    })))
    if (res.status !== 200) throw new Error(`create vendor failed: ${JSON.stringify(res.body)}`)
    tenantIds.push(res.body.vendor.id)
    return res.body.vendor.id as string
  }

  try {
    const vendorId = await makeVendor(1)
    const otherId = await makeVendor(2)
    const wh = (await pg.query(`SELECT id FROM warehouses WHERE tenant_id = $1 ORDER BY is_default DESC LIMIT 1`, [vendorId])).rows[0].id
    const whOther = (await pg.query(`SELECT id FROM warehouses WHERE tenant_id = $1 ORDER BY is_default DESC LIMIT 1`, [otherId])).rows[0].id

    const item = async (t: string, name: string, cost: number, price: number, barcode: string) =>
      (await pg.query(`INSERT INTO items (tenant_id, name, barcode, cost_price, selling_price, track_stock) VALUES ($1, $2, $3, $4, $5, true) RETURNING id`, [t, name, barcode, cost, price])).rows[0].id as string
    const A = await item(vendorId, `Blue Shirt ${tag}`, 100, 200, `L17A${tag}`)
    const Z = await item(vendorId, `Free Sample ${tag}`, 0, 50, `L17Z${tag}`)
    const O = await item(otherId, `Other Shop Secret Item ${tag}`, 999, 1999, `L17O${tag}`)
    await pg.query(`INSERT INTO warehouse_stock (tenant_id, warehouse_id, item_id, current_stock) VALUES ($1, $2, $3, 5), ($1, $2, $4, 3)`, [vendorId, wh, A, Z])
    await pg.query(`INSERT INTO warehouse_stock (tenant_id, warehouse_id, item_id, current_stock) VALUES ($1, $2, $3, 7)`, [otherId, whOther, O])

    let invoice = 0
    const sale = async (t: string, w: string, o: { total: number; tax: number; status?: string; isReturn?: boolean; paid?: number; daysAgo?: number; customerName?: string }, lines: Array<{ item: string | null; name: string; qty: number; total: number }>) => {
      const id = (await pg.query(
        `INSERT INTO sales (tenant_id, invoice_no, warehouse_id, subtotal, tax_amount, total, paid_amount, status, is_return, customer_name, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now() - make_interval(days => $11::int)) RETURNING id`,
        [t, `L17-${tag}-${++invoice}`, w, o.total - o.tax, o.tax, o.total, o.paid ?? o.total, o.status ?? 'completed', o.isReturn ?? false, o.customerName ?? null, o.daysAgo ?? 0],
      )).rows[0].id as string
      for (const l of lines) {
        await pg.query(
          `INSERT INTO sale_items (tenant_id, sale_id, item_id, item_name, quantity, unit_price, total) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [t, id, l.item, l.name, l.qty, l.qty ? Math.abs(l.total / l.qty) : 0, l.total],
        )
      }
      return id
    }
    // revenue 900 (540 + 360), cost 300; return takes back 180 revenue and 100 cost
    await sale(vendorId, wh, { total: 1000, tax: 100, status: 'pending', paid: 0, customerName: `=cmd|calc ${tag}` }, [
      { item: A, name: `Blue Shirt ${tag}`, qty: 3, total: 600 },
      { item: Z, name: `Free Sample ${tag}`, qty: 1, total: 400 },
    ])
    await sale(vendorId, wh, { total: -200, tax: -20, isReturn: true, paid: -200 }, [{ item: A, name: `Blue Shirt ${tag}`, qty: -1, total: -200 }])
    await sale(vendorId, wh, { total: 5000, tax: 0, status: 'void' }, [{ item: A, name: `Blue Shirt ${tag}`, qty: 50, total: 5000 }])
    await sale(vendorId, wh, { total: 300, tax: 0, daysAgo: 60 }, [{ item: A, name: `Blue Shirt ${tag}`, qty: 1, total: 300 }])
    await sale(vendorId, wh, { total: 40, tax: 0 }, [{ item: null, name: `Deleted Hat ${tag}`, qty: 2, total: 40 }])
    await sale(otherId, whOther, { total: 7777, tax: 0 }, [{ item: O, name: `Other Shop Secret Item ${tag}`, qty: 1, total: 7777 }])

    await pg.query(`INSERT INTO suppliers (tenant_id, name, balance) VALUES ($1, $2, 250), ($1, $3, -40)`, [vendorId, `Owed Co ${tag}`, `Advance Co ${tag}`])
    await pg.query(`INSERT INTO expenses (tenant_id, expense_no, status, expense_date, amount) VALUES ($1, $2, 'paid', CURRENT_DATE, 75), ($1, $3, 'void', CURRENT_DATE, 9000)`, [vendorId, `E1-${tag}`, `E2-${tag}`])
    await pg.query(
      `INSERT INTO email_settings (tenant_id, smtp_password, sendgrid_api_key) VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id) DO UPDATE SET smtp_password = EXCLUDED.smtp_password, sendgrid_api_key = EXCLUDED.sendgrid_api_key`,
      [vendorId, `smtp-pass-${tag}`, `sendgrid-key-${tag}`],
    )

    await step('periods', async () => {
      const today = '2026-10-30'
      check('30 days counts today', periodDates({ period: '30d' }, today)?.fromDate === '2026-10-01')
      check('this month', periodDates({ period: 'month' }, today)?.fromDate === '2026-10-01')
      check('this year', periodDates({ period: 'year' }, today)?.fromDate === '2026-01-01')
      check('custom needs both dates in order', periodDates({ period: 'custom', fromDate: '2026-10-02', toDate: '2026-10-01' }, today) === null)
    })

    await step('permissions', async () => {
      setTestCookie('admin_session', null)
      const a = await businessGET(req('GET', `/api/sys-control/vendors/${vendorId}/business`), ctx(vendorId))
      check('no session → refused', a.status === 401, a.status)
      viewer.use()
      const calls = [
        await businessGET(req('GET', `/api/sys-control/vendors/${vendorId}/business`), ctx(vendorId)),
        await itemsGET(req('GET', `/api/sys-control/vendors/${vendorId}/business/items`), ctx(vendorId)),
        await figuresGET(req('GET', `/api/sys-control/vendors/figures?ids=${vendorId}`)),
        await exportGET(req('GET', `/api/sys-control/vendors/${vendorId}/export`), ctx(vendorId)),
        await tableExportGET(req('GET', `/api/sys-control/vendors/${vendorId}/data/items/export`), ctxT(vendorId, 'items')),
      ]
      check('viewer gets no reports or exports', calls.every((r) => r.status === 401 || r.status === 403), calls.map((r) => r.status))
      support.use()
      const b = await businessGET(req('GET', `/api/sys-control/vendors/${vendorId}/business`), ctx(vendorId))
      check('support can open the report', b.status === 200, b.status)
      const c = await exportGET(req('GET', `/api/sys-control/vendors/${vendorId}/export`), ctx(vendorId))
      check('support cannot bulk-export a vendor', c.status === 401 || c.status === 403, c.status)
      const d = await tableExportGET(req('GET', `/api/sys-control/vendors/${vendorId}/data/items/export`), ctxT(vendorId, 'items'))
      check('support can export a table it can already view', d.status === 200, d.status)
      await d.arrayBuffer()
    })

    await step('summary', async () => {
      owner.use()
      const { status, body: s } = await json(await businessGET(req('GET', `/api/sys-control/vendors/${vendorId}/business?period=30d`), ctx(vendorId)))
      check('report loads', status === 200, s)
      check('net sales: returns off, voids and older sales left out', s.sales?.netSales === 840 && s.sales.grossSales === 1040 && s.sales.returns === 200, s.sales)
      check('receipts and returns counted apart', s.sales?.receipts === 2 && s.sales.returnCount === 1, s.sales)
      check('tax nets the return', s.sales?.tax === 80, s.sales)
      check('revenue without tax', s.profit?.revenue === 760, s.profit)
      check('cost of goods nets the return', s.profit?.costOfGoods === 200, s.profit)
      check('gross profit', s.profit?.grossProfit === 560, s.profit)
      check('no ledger postings → no net profit figure', s.profit?.netProfit === null, s.profit)
      check('stock at cost and at selling price', s.stock?.atCost === 500 && s.stock.atSellingPrice === 1150 && s.stock.units === 8, s.stock)
      check('items counted, stock without a cost flagged', s.catalog?.active === 2 && s.catalog.inStock === 2 && s.catalog.inStockWithoutCost === 1, s.catalog)
      check('customers owe the unpaid invoice', s.money?.receivable === 1000, s.money)
      check('owed to suppliers leaves out advances', s.money?.payable === 250, s.money)
      check('expenses leave out voids', s.money?.expenses === 75, s.money)
      check('branch row carries sales and stock', s.branches?.length === 1 && s.branches[0].grossProfit === 560 && s.branches[0].atCost === 500, s.branches)

      const period = await resolvePeriod(vendorId, { period: '30d' })
      const own = await withTenant(vendorId, (tx) => ownerDashboard(tx, { tenantId: vendorId, from: period!.from, to: period!.to, today: period!.today }))
      check('same gross profit and stock value as the vendor’s own dashboard', own.profit.grossProfit === s.profit.grossProfit && own.stock.atCost === s.stock.atCost, own.profit)

      const all = await json(await businessGET(req('GET', `/api/sys-control/vendors/${vendorId}/business?period=all`), ctx(vendorId)))
      check('all time adds the older sale', all.body.sales?.netSales === 1140, all.body.sales)
      const bad = await json(await businessGET(req('GET', `/api/sys-control/vendors/${vendorId}/business?period=custom&fromDate=2026-10-05`), ctx(vendorId)))
      check('custom period without an end date → 400', bad.status === 400, bad)
      const none = await json(await businessGET(req('GET', `/api/sys-control/vendors/${randomUUID()}/business`), ctx(randomUUID())))
      check('unknown vendor → 404', none.status === 404, none)
    })

    await step('item by item', async () => {
      owner.use()
      const { status, body } = await json(await itemsGET(req('GET', `/api/sys-control/vendors/${vendorId}/business/items?period=30d`), ctx(vendorId)))
      check('report loads', status === 200 && body.total === 3, body)
      const a = body.rows?.find((r: J) => r.itemId === A)
      check('quantity sold nets the return', a?.soldQty === 2, a)
      check('revenue, cost and profit nets the return', a?.revenue === 360 && a.costOfGoods === 200 && a.profit === 160, a)
      check('margin', a?.marginPercent === 44.44, a)
      check('stock on hand and at cost', a?.onHand === 5 && a.stockAtCost === 500 && a.stockAtSellingPrice === 1000, a)
      const z = body.rows?.find((r: J) => r.itemId === Z)
      check('a line costed at zero is all profit', z?.profit === 360 && z.onHand === 3, z)
      const hat = body.rows?.find((r: J) => r.name === `Deleted Hat ${tag}`)
      check('sale of a removed item still shows', hat && hat.inCatalog === false && hat.soldQty === 2 && hat.revenue === 40, hat)
      check('profit adds up to the summary', body.rows.reduce((s: number, r: J) => s + r.profit, 0) === 560, body.rows)
      check('default order: most profit first', body.rows[0].profit >= body.rows[1].profit && body.rows[1].profit >= body.rows[2].profit)
      check('other vendor’s items not listed', !body.rows.some((r: J) => r.itemId === O))

      const found = await json(await itemsGET(req('GET', `/api/sys-control/vendors/${vendorId}/business/items?q=L17A${tag}`), ctx(vendorId)))
      check('search by barcode', found.body.total === 1 && found.body.rows[0].itemId === A, found.body)
      const paged = await json(await itemsGET(req('GET', `/api/sys-control/vendors/${vendorId}/business/items?pageSize=1&page=2&sort=name&dir=asc`), ctx(vendorId)))
      check('paging keeps the total', paged.body.total === 3 && paged.body.rows.length === 1, paged.body)
      const bad = await json(await itemsGET(req('GET', `/api/sys-control/vendors/${vendorId}/business/items?sort=password`), ctx(vendorId)))
      check('unknown sort refused', bad.status === 400, bad)

      const csv = await itemsGET(req('GET', `/api/sys-control/vendors/${vendorId}/business/items?period=30d&format=csv`), ctx(vendorId))
      const text = await csv.text()
      check('CSV download with every item', csv.status === 200 && text.split('\r\n').length === 5 && text.includes('Quantity sold') && (csv.headers.get('content-disposition') ?? '').includes('attachment'), text.slice(0, 300))
    })

    await step('vendor list figures', async () => {
      owner.use()
      const { status, body } = await json(await figuresGET(req('GET', `/api/sys-control/vendors/figures?ids=${vendorId},${otherId}`)))
      const f = body.figures?.[vendorId]
      check('figures per vendor', status === 200 && f?.stockAtCost === 500 && f.netSales === 840 && f.grossProfit === 560, body)
      check('each vendor keeps its own', body.figures?.[otherId]?.netSales === 7777 && body.figures[otherId].stockAtCost === 6993, body.figures?.[otherId])
      const bad = await json(await figuresGET(req('GET', '/api/sys-control/vendors/figures?ids=nope')))
      check('bad ids → 400', bad.status === 400, bad)
    })

    await step('secret columns', async () => {
      support.use()
      const r = await json(await listRows(req('GET', `/api/sys-control/vendors/${vendorId}/data/email_settings`), ctxT(vendorId, 'email_settings')))
      const row = r.body.rows?.[0]
      check('SMTP password masked in the data console', row?.smtp_password === '••••••', row?.smtp_password)
    })

    await step('bulk export', async () => {
      owner.use()
      const res = await exportGET(req('GET', `/api/sys-control/vendors/${vendorId}/export`), ctx(vendorId))
      check('ZIP streams', res.status === 200 && res.headers.get('content-type') === 'application/zip', res.status)
      const buf = Buffer.from(await res.arrayBuffer())
      const files = unzip(buf)
      const names = [...files.keys()]
      check('README and reports inside', ['README.txt', 'reports/summary.csv', 'reports/items-stock-and-profit.csv'].every((n) => files.has(n)), names.slice(0, 10))
      check('tables sorted into section folders', files.has('tables/items-and-stock/items.csv') && files.has('tables/sales/sale_items.csv'), names)
      check('business profile included', [...files.entries()].some(([n, t]) => n.endsWith('/business_profile.csv') && t.includes(`L17 Shop 1 ${tag}`)), names.filter((n) => n.includes('business')))
      check('empty tables left out', !names.some((n) => n.endsWith('/work_orders.csv')), names)

      const everything = [...files.values()].join('\n')
      check('no secret value anywhere', !everything.includes(`smtp-pass-${tag}`) && !everything.includes(`sendgrid-key-${tag}`), 'secret found')
      const users = [...files.entries()].find(([n]) => n.endsWith('/users.csv'))?.[1] ?? ''
      check('password columns dropped', users.length > 0 && !/password_hash|pin_hash/.test(users.split('\r\n')[0]), users.slice(0, 200))
      check('no sign-in sessions', !names.some((n) => n.endsWith('/account_sessions.csv')), names)
      check('other vendor’s rows absent', !everything.includes(`Other Shop Secret Item ${tag}`) && !everything.includes(`L17 Shop 2 ${tag}`), 'leak')

      const salesCsv = files.get('tables/sales/sales.csv') ?? ''
      check('spreadsheet formulas neutralised', salesCsv.includes(`'=cmd|calc ${tag}`), salesCsv.slice(0, 400))
      const linesCsv = files.get('tables/sales/sale_items.csv') ?? ''
      check('negative numbers stay numbers', /,-1(\.0+)?,/.test(linesCsv) && !linesCsv.includes(`'-1`), linesCsv.slice(0, 400))
      check('file opens as UTF-8 in Excel', salesCsv.charCodeAt(0) === 0xFEFF)
      const summary = files.get('reports/summary.csv') ?? ''
      check('summary holds all-time figures', summary.includes('Net sales (with tax),1140'), summary)
      const itemsCsv = files.get('reports/items-stock-and-profit.csv') ?? ''
      check('item report inside', itemsCsv.includes(`Blue Shirt ${tag}`), itemsCsv.slice(0, 300))

      const part = await exportGET(req('GET', `/api/sys-control/vendors/${vendorId}/export?groups=${encodeURIComponent('Items & stock')}`), ctx(vendorId))
      const partNames = [...unzip(Buffer.from(await part.arrayBuffer())).keys()]
      check('a chosen section only', partNames.includes('tables/items-and-stock/items.csv') && !partNames.some((n) => n.startsWith('tables/sales/')), partNames)
      const bad = await json(await exportGET(req('GET', `/api/sys-control/vendors/${vendorId}/export?groups=Nope`), ctx(vendorId)))
      check('unknown section → 400', bad.status === 400, bad)
    })

    await step('one table', async () => {
      owner.use()
      const res = await tableExportGET(req('GET', `/api/sys-control/vendors/${vendorId}/data/items/export`), ctxT(vendorId, 'items'))
      const text = await res.text()
      check('all rows with a header', res.status === 200 && text.split('\r\n').filter(Boolean).length === 3 && text.includes(`Blue Shirt ${tag}`), text.slice(0, 200))
      const profile = await tableExportGET(req('GET', `/api/sys-control/vendors/${vendorId}/data/business_profile/export`), ctxT(vendorId, 'business_profile'))
      check('business profile exports', (await profile.text()).includes(`L17 Shop 1 ${tag}`))
      const empty = await tableExportGET(req('GET', `/api/sys-control/vendors/${vendorId}/data/work_orders/export`), ctxT(vendorId, 'work_orders'))
      const emptyText = await empty.text()
      check('an empty table gives just the header', emptyText.split('\r\n').filter(Boolean).length === 1 && emptyText.includes('order_no'), emptyText.slice(0, 200))
      const secret = await tableExportGET(req('GET', `/api/sys-control/vendors/${vendorId}/data/email_settings/export`), ctxT(vendorId, 'email_settings'))
      const secretText = await secret.text()
      check('secret columns dropped from a table too', !secretText.includes(`smtp-pass-${tag}`) && !secretText.split('\r\n')[0].includes('smtp_password'), secretText.slice(0, 300))
      const sessions = await tableExportGET(req('GET', `/api/sys-control/vendors/${vendorId}/data/account_sessions/export`), ctxT(vendorId, 'account_sessions'))
      check('sessions cannot be exported', sessions.status === 404, sessions.status)
    })

    await step('audit', async () => {
      const rows = (await pg.query(`SELECT details FROM admin_audit_logs WHERE resource = 'vendor_data_export' AND resource_id = $1`, [vendorId])).rows
      const ops = rows.map((r) => r.details.op)
      check('every download is on the vendor’s activity', ops.includes('data_export') && ops.includes('table_export') && ops.includes('items_export'), ops)
      check('the section is recorded', rows.some((r) => Array.isArray(r.details.groups) && r.details.groups[0] === 'Items & stock'), rows.map((r) => r.details))
    })
  } finally {
    if (!process.env.KEEP_TEST_DATA) await cleanup(pg, tenantIds, adminIds).catch((e) => console.error('cleanup:', e.message))
    await pg.end()
    await closeAllPools()
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  if (failed.length) process.exit(1)
}

async function cleanup(pg: Client, tenantIds: string[], adminIds: string[]) {
  if (tenantIds.length) {
    const { rows } = await pg.query(`SELECT table_name FROM information_schema.columns c JOIN information_schema.tables t USING (table_schema, table_name)
      WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE'`)
    let pending = rows.map((r) => r.table_name as string)
    for (let pass = 0; pass < 8 && pending.length; pass++) {
      const next: string[] = []
      for (const t of pending) {
        try {
          await pg.query(`DELETE FROM "${t}" WHERE tenant_id = ANY($1::uuid[])`, [tenantIds])
        } catch {
          next.push(t)
        }
      }
      pending = next
    }
    await pg.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [tenantIds])
  }
  for (const id of adminIds) {
    await pg.query(`DELETE FROM admin_audit_logs WHERE super_admin_id = $1`, [id])
    await pg.query(`DELETE FROM admin_sessions WHERE super_admin_id = $1`, [id])
    await pg.query(`DELETE FROM super_admins WHERE id = $1`, [id])
  }
}

main().catch(async (err) => {
  console.error(err)
  await closeAllPools().catch(() => undefined)
  process.exit(1)
})
