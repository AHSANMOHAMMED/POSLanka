/**
 * L14 — creating products by hand: the shop's item form (POST /api/items) and the super-admin
 * vendor data console (POST /api/sys-control/vendors/[id]/data/items).
 *
 *   NEXTAUTH_SECRET=i3-test-secret \
 *   DATABASE_URL=postgresql://postgres:<pw>@127.0.0.1:5433/poslanka_<db> DATABASE_APP_ROLE=app_user \
 *   npx tsx --tsconfig scripts/tests/i3-harness/tsconfig.json scripts/tests/l14-item-create.ts
 *
 * Posts the exact body ItemFormModal builds (empty optional fields, nulls, '' ids, opening stock)
 * for a retail and a pharmacy shop, a shop whose branches have no default flag, and a branch-bound
 * stock keeper; checks validation errors carry field details; and adds an item row from the vendor
 * console with only name + price (item_code is filled by the database trigger).
 * Throw-away vendors are removed at the end unless KEEP_TEST_DATA=1.
 */
import { Client } from 'pg'
import { randomBytes, randomUUID } from 'crypto'
import { NextRequest } from 'next/server'
import { setTestCookie, setTestHeader } from './i3-harness/next-headers-mock'
import { setTestSession } from './w8-harness/auth-mock'
import { closeAllPools } from '@/lib/db'
import { clearBranchScopeCache } from '@/lib/auth/branch-access'
import { POST as createVendor } from '@/app/api/sys-control/vendors/route'
import { GET as listRowsApi, POST as insertRowApi } from '@/app/api/sys-control/vendors/[id]/data/[table]/route'
import { PATCH as patchRowApi } from '@/app/api/sys-control/vendors/[id]/data/[table]/[rowId]/route'
import { POST as createItemApi } from '@/app/api/items/route'

type J = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const DB_GUARD = /@(127\.0\.0\.1|localhost)(:\d+)?\/poslanka_[a-z0-9_]+$/i
const results: Array<{ name: string; ok: boolean }> = []
function check(name: string, ok: boolean, detail?: unknown) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== undefined ? `  — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 600)}` : ''}`)
}
async function step(name: string, fn: () => Promise<void>) {
  try { await fn() } catch (err) { check(name, false, err instanceof Error ? err.stack : String(err)) }
}

globalThis.__broadcastProcessor = () => undefined
globalThis.__accountBroadcastProcessor = () => undefined

let ip = 1
function req(method: string, url: string, body?: unknown): NextRequest {
  const addr = `10.41.${Math.floor(ip / 250)}.${ip++ % 250}`
  setTestHeader('x-forwarded-for', addr)
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': addr },
  })
}
const ctx = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) })
async function json(res: Response): Promise<{ status: number; body: J }> {
  return { status: res.status, body: await res.json().catch(() => ({})) as J }
}

/** The form state ItemFormModal starts with (src/components/modals/ItemFormModal.tsx) */
function blankForm(isPharmacy = false) {
  return {
    name: '', sku: '', barcode: '', categoryId: '', costPrice: '', sellingPrice: '', unit: 'pcs', trackStock: true,
    productType: 'stockable' as 'stockable' | 'consumable' | 'service', trackBatches: isPharmacy, trackSerialNumbers: false,
    openingStock: '', minStock: '', oemPartNumber: '', alternatePartNumbers: '', brand: '', condition: 'new',
    supplierId: '', supplierPartNumber: '', leadTimeDays: '', weight: '', dimensions: '', warrantyMonths: '', imageUrl: '',
    supersededBy: '', preparationTime: '', allergens: '', calories: '', isVegetarian: false, isVegan: false, isGlutenFree: false,
    spiceLevel: '', availableFrom: '', availableTo: '', pluCode: '', shelfLifeDays: '', storageTemp: '', expiryDate: '',
    binLocation: '', genericName: '', strength: '', dosageForm: '', drugSchedule: '', pricingMode: 'unit', areaUnit: 'sqft',
    minChargeArea: '', isGiftCard: false, taxTemplateId: '',
  }
}
type Form = ReturnType<typeof blankForm>

/** The request body ItemFormModal.handleSubmit sends for a NEW item */
function formBody(f: Form, isPharmacy = false) {
  return {
    ...f,
    categoryId: f.categoryId || null,
    costPrice: parseFloat(f.costPrice) || 0,
    sellingPrice: parseFloat(f.sellingPrice) || 0,
    trackStock: f.productType === 'stockable',
    productType: f.productType,
    trackBatches: f.trackBatches,
    trackSerialNumbers: f.trackSerialNumbers,
    openingStock: undefined,
    minStock: undefined,
    ...(f.productType === 'stockable' && !f.trackBatches && !f.trackSerialNumbers
      ? { currentStock: parseFloat(f.openingStock) || 0, minStock: parseFloat(f.minStock) || 0 }
      : {}),
    oemPartNumber: f.oemPartNumber || null,
    alternatePartNumbers: f.alternatePartNumbers ? f.alternatePartNumbers.split(',').map(s => s.trim()).filter(Boolean) : null,
    brand: f.brand || null,
    condition: f.condition || 'new',
    supplierId: f.supplierId || null,
    supplierPartNumber: f.supplierPartNumber || null,
    leadTimeDays: f.leadTimeDays ? parseInt(f.leadTimeDays) : null,
    weight: f.weight ? parseFloat(f.weight) : null,
    dimensions: f.dimensions || null,
    warrantyMonths: f.warrantyMonths ? parseInt(f.warrantyMonths) : null,
    imageUrl: f.imageUrl || null,
    supersededBy: f.supersededBy || null,
    preparationTime: f.preparationTime ? parseInt(f.preparationTime) : null,
    allergens: f.allergens ? f.allergens.split(',').map(s => s.trim()).filter(Boolean) : null,
    calories: f.calories ? parseInt(f.calories) : null,
    isVegetarian: f.isVegetarian, isVegan: f.isVegan, isGlutenFree: f.isGlutenFree,
    spiceLevel: f.spiceLevel || null,
    availableFrom: f.availableFrom || null,
    availableTo: f.availableTo || null,
    pluCode: f.pluCode || null,
    shelfLifeDays: f.shelfLifeDays ? parseInt(f.shelfLifeDays) : null,
    storageTemp: f.storageTemp || null,
    expiryDate: f.expiryDate || null,
    binLocation: f.binLocation || null,
    ...(isPharmacy ? { genericName: f.genericName, strength: f.strength, dosageForm: f.dosageForm, drugSchedule: f.drugSchedule } : {}),
    pricingMode: f.pricingMode,
    areaUnit: f.areaUnit,
    minChargeArea: parseFloat(f.minChargeArea) || 0,
    isGiftCard: f.isGiftCard,
    taxTemplateId: f.taxTemplateId || null,
  }
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

  const adminId = randomUUID()
  const token = randomBytes(32).toString('hex')
  await pg.query(`INSERT INTO super_admins (id, email, password_hash, full_name, role) VALUES ($1, $2, 'x', 'L14 Admin', 'owner')`, [adminId, `l14-owner-${tag}@example.test`])
  await pg.query(`INSERT INTO admin_sessions (super_admin_id, session_token, last_activity_at, expires_at) VALUES ($1, $2, now(), now() + interval '1 hour')`, [adminId, token])
  adminIds.push(adminId)
  const asAdmin = () => setTestCookie('admin_session', token)

  const tiers = (await pg.query(`SELECT id, name, price_monthly FROM pricing_tiers WHERE is_active ORDER BY sort_order, price_monthly`)).rows
  const tier = tiers.find((t) => Number(t.price_monthly) > 0 && !String(t.name).startsWith('gf-')) ?? tiers[0]

  const makeVendor = async (n: number, businessType: string) => {
    asAdmin()
    const res = await json(await createVendor(req('POST', '/api/sys-control/vendors', {
      name: `L14 Shop ${n} ${tag}`, slug: `l14-shop-${n}-${tag}`, email: `l14-shop-${n}-${tag}@example.test`,
      phone: `+9477${String(Date.now() + n).slice(-7)}`, address: 'Colombo', businessType,
      tierId: tier.id, billingCycle: 'monthly', ownerName: 'L14 Owner', ownerEmail: `l14-owner-${n}-${tag}@example.test`, ownerPassword: 'Owner@12345',
    })))
    if (res.status !== 200) throw new Error(`create vendor failed: ${JSON.stringify(res.body)}`)
    const tenantId = res.body.vendor.id as string
    tenantIds.push(tenantId)
    const owner = (await pg.query(`SELECT id FROM users WHERE tenant_id = $1 AND role = 'owner' LIMIT 1`, [tenantId])).rows[0].id as string
    return { tenantId, owner, slug: `l14-shop-${n}-${tag}`, businessType }
  }
  type Shop = Awaited<ReturnType<typeof makeVendor>>
  const asUser = (s: Shop, userId: string, role: string) => {
    clearBranchScopeCache(s.tenantId)
    setTestSession({
      user: {
        id: userId, accountId: null, email: `${role}-${s.slug}@example.test`, name: role, role,
        tenantId: s.tenantId, tenantSlug: s.slug, tenantName: 'L14', businessType: s.businessType,
        aiEnabled: false, isSuperAdmin: false, isOwner: role === 'owner', mode: 'company',
      },
    } as unknown as Parameters<typeof setTestSession>[0])
  }
  const post = async (body: unknown) => json(await createItemApi(req('POST', '/api/items', body)))
  const stockRows = async (itemId: string) =>
    (await pg.query(`SELECT warehouse_id, current_stock::float AS qty, min_stock::float AS min FROM warehouse_stock WHERE item_id = $1`, [itemId])).rows

  try {
    const retail = await makeVendor(1, 'retail')
    const pharmacy = await makeVendor(2, 'pharmacy')
    const multi = await makeVendor(3, 'retail')
    const mainWh = (await pg.query(`SELECT id FROM warehouses WHERE tenant_id = $1 AND is_default`, [retail.tenantId])).rows[0]?.id

    await step('retail: only name + price, every optional field empty', async () => {
      asUser(retail, retail.owner, 'owner')
      const f = { ...blankForm(), name: `Soap ${tag}`, sellingPrice: '120' }
      const r = await post(formBody(f))
      check('created (200)', r.status === 200 && !!r.body.id, r)
      check('item code auto-generated, price saved', /^ITM-\d+/.test(r.body.itemCode ?? '') && Number(r.body.sellingPrice) === 120, r.body)
      check('no stock row for 0 opening stock', r.body.id ? (await stockRows(r.body.id)).length === 0 : false)
    })

    await step('retail: cost, category-less, opening stock + low stock alert', async () => {
      asUser(retail, retail.owner, 'owner')
      const f = { ...blankForm(), name: `Shampoo ${tag}`, sellingPrice: '450.50', costPrice: '300', openingStock: '24', minStock: '5', sku: `SKU-${tag}`, brand: 'Sunsilk' }
      const r = await post(formBody(f))
      check('created (200)', r.status === 200 && !!r.body.id, r)
      const rows = r.body.id ? await stockRows(r.body.id) : []
      check('opening stock 24 in the default branch, min 5', rows.length === 1 && rows[0].warehouse_id === mainWh && rows[0].qty === 24 && rows[0].min === 5, rows)
    })

    await step('retail: service item and a gift card', async () => {
      asUser(retail, retail.owner, 'owner')
      const s = await post(formBody({ ...blankForm(), name: `Gift wrap ${tag}`, sellingPrice: '50', productType: 'service', openingStock: '5' }))
      check('service created, no stock', s.status === 200 && s.body.trackStock === false && (await stockRows(s.body.id)).length === 0, s)
      const g = await post(formBody({ ...blankForm(), name: `Gift card ${tag}`, sellingPrice: '1000', productType: 'consumable', isGiftCard: true }))
      check('gift card created', g.status === 200 && g.body.isGiftCard === true, g)
    })

    await step('retail: decimal price as text, zero price', async () => {
      asUser(retail, retail.owner, 'owner')
      const r = await post({ ...formBody({ ...blankForm(), name: `Free bag ${tag}` }), sellingPrice: '0' })
      check('price 0 accepted', r.status === 200, r)
    })

    await step('validation errors name the field', async () => {
      asUser(retail, retail.owner, 'owner')
      const r = await post(formBody({ ...blankForm(), sellingPrice: '10' }))
      check('missing name → 400 with details.field = name', r.status === 400 && Array.isArray(r.body.details) && r.body.details.some((d: J) => d.field === 'name'), r)
    })

    await step('mobile app "Add product" (apps/mobile/app/item-new.tsx)', async () => {
      asUser(retail, retail.owner, 'owner')
      const base = { unit: 'pcs', productType: 'stockable', trackStock: true }
      const a = await post({ ...base, name: `App quick ${tag}`, sellingPrice: 0 })
      check('app: name only → 200 with auto item ID code + EAN-13 barcode', a.status === 200 && /^ITM-\d+/.test(a.body.itemCode ?? '') && /^\d{13}$/.test(a.body.barcode ?? ''), a)
      const b = await post({ ...base, unit: 'm', name: `App fabric ${tag}`, sku: `APP-${tag}`, barcode: `479${String(Date.now()).slice(-10)}`, sellingPrice: 1000, costPrice: 650, currentStock: 60, minStock: 5, expiryDate: '2027-12-31' })
      const rows = b.body.id ? await stockRows(b.body.id) : []
      check('app: every optional field → 200, 60 m in the default branch, expiry saved', b.status === 200 && b.body.unit === 'm' && b.body.sku === `APP-${tag}` && rows.length === 1 && rows[0].qty === 60 && String(b.body.expiryDate ?? '').startsWith('2027-12-31'), { b, rows })
      const dup = await post({ ...base, name: `App dup ${tag}`, sku: `APP-${tag}`, sellingPrice: 10 })
      check('app: an ID already used → 409/400 DUPLICATE naming the field', dup.body.code === 'DUPLICATE' && dup.body.field === 'sku', dup)
    })

    await step('pharmacy: batch-tracked medicine with empty pharmacy fields', async () => {
      asUser(pharmacy, pharmacy.owner, 'owner')
      const f = { ...blankForm(true), name: `Panadol ${tag}`, sellingPrice: '25', genericName: 'Paracetamol' }
      const r = await post(formBody(f, true))
      check('created (200)', r.status === 200 && r.body.trackBatches === true && r.body.genericName === 'Paracetamol', r)
      const plain = await post(formBody({ ...blankForm(true), name: `Plaster ${tag}`, sellingPrice: '15', trackBatches: false, openingStock: '10', drugSchedule: 'otc' }, true))
      check('non-batch pharmacy item with opening stock', plain.status === 200 && (await stockRows(plain.body.id))[0]?.qty === 10, plain)
    })

    await step('shop with two branches and no default branch flag', async () => {
      const wh2 = randomUUID()
      await pg.query(`INSERT INTO warehouses (id, tenant_id, name, code, is_default) VALUES ($1, $2, 'Kandy', 'KDY', false)`, [wh2, multi.tenantId])
      await pg.query(`UPDATE warehouses SET is_default = false WHERE tenant_id = $1`, [multi.tenantId])
      asUser(multi, multi.owner, 'owner')
      const r = await post(formBody({ ...blankForm(), name: `Rice ${tag}`, sellingPrice: '220', openingStock: '7' }))
      check('opening stock still booked (to the first active branch)', r.status === 200 && (await stockRows(r.body.id))[0]?.qty === 7, r)

      // A stock keeper assigned to Kandy only: opening stock goes to Kandy
      const keeper = randomUUID()
      await pg.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, 'x', 'Keeper', 'stock_manager')`, [keeper, multi.tenantId, `keeper-${multi.slug}@example.test`])
      await pg.query(`INSERT INTO user_warehouses (tenant_id, user_id, warehouse_id, is_active) VALUES ($1, $2, $3, true)`, [multi.tenantId, keeper, wh2])
      asUser(multi, keeper, 'stock_manager')
      const k = await post(formBody({ ...blankForm(), name: `Dhal ${tag}`, sellingPrice: '300', openingStock: '3' }))
      const rows = k.status === 200 ? await stockRows(k.body.id) : []
      check('branch-bound keeper: opening stock in their branch', k.status === 200 && rows[0]?.warehouse_id === wh2 && rows[0]?.qty === 3, { k, rows })

      // No active branch at all: clear error, not a 500
      await pg.query(`UPDATE warehouses SET is_active = false WHERE tenant_id = $1`, [multi.tenantId])
      asUser(multi, multi.owner, 'owner')
      const none = await post(formBody({ ...blankForm(), name: `Sugar ${tag}`, sellingPrice: '200', openingStock: '2' }))
      check('no active branch + opening stock → 400 NO_DEFAULT_WAREHOUSE', none.status === 400 && none.body.code === 'NO_DEFAULT_WAREHOUSE', none)
      const noStock = await post(formBody({ ...blankForm(), name: `Salt ${tag}`, sellingPrice: '80' }))
      check('no active branch, no opening stock → still created', noStock.status === 200, noStock)
      await pg.query(`UPDATE warehouses SET is_active = true WHERE tenant_id = $1`, [multi.tenantId])
    })

    await step('vendor console: add an items row', async () => {
      asAdmin()
      const list = await json(await listRowsApi(req('GET', `/api/sys-control/vendors/${retail.tenantId}/data/items?pageSize=1`), ctx({ id: retail.tenantId, table: 'items' })))
      const itemCode = list.body.columns?.find((c: J) => c.name === 'item_code')
      check('item_code is not marked required (the database fills it)', list.status === 200 && itemCode && itemCode.required === false, itemCode)
      const add = async (values: J) => json(await insertRowApi(req('POST', `/api/sys-control/vendors/${retail.tenantId}/data/items`, { values }), ctx({ id: retail.tenantId, table: 'items' })))
      const a = await add({ name: `Console item ${tag}`, selling_price: '99.5', sku: '', barcode: '', category_id: null, is_active: true })
      check('name + price only → 201, item code filled', a.status === 201 && /^ITM-/.test(a.body.row?.item_code ?? ''), a)
      check('empty barcode / sku stored as no value (NULL), not \'\'', a.body.row?.sku === null && a.body.row?.barcode === null, a.body.row)
      const b = await add({ name: `Console item 2 ${tag}`, selling_price: '10', item_code: `ADM-${tag}`, cost_price: '', sku: '', barcode: '', track_stock: false })
      check('second row with empty sku / barcode + own item code → 201 (no unique clash on \'\')', b.status === 201 && b.body.row?.item_code === `ADM-${tag}` && b.body.row?.cost_price === '0.00', b)
      const c = await add({ selling_price: '10' })
      check('missing name → 400 naming the field', c.status === 400 && c.body.field === 'name', c)
      const blankName = await add({ name: '  ', selling_price: '10' })
      check('blank name → 400 (not an item called "")', blankName.status === 400 && blankName.body.field === 'name', blankName)

      // Editing: clearing a field reaches the database (null / '' are not dropped on the way)
      const id = a.body.row?.id as string
      const patch = async (values: J) => json(await patchRowApi(req('PATCH', `/api/sys-control/vendors/${retail.tenantId}/data/items/${id}`, { values }), ctx({ id: retail.tenantId, table: 'items', rowId: id })))
      const set = await patch({ brand: 'Anchor', min_charge_area: '2' })
      check('PATCH sets brand', set.status === 200 && set.body.row?.brand === 'Anchor', set)
      const clearNull = await patch({ brand: null })
      check('PATCH brand: null clears it', clearNull.status === 200 && clearNull.body.row?.brand === null, clearNull)
      const clearEmpty = await patch({ min_charge_area: '' })
      check('PATCH min_charge_area: \'\' clears it', clearEmpty.status === 200 && clearEmpty.body.row?.min_charge_area === null, clearEmpty)
      const noName = await patch({ name: null })
      check('PATCH name: null → 400 required', noName.status === 400 && noName.body.field === 'name', noName)
      const noCode = await patch({ item_code: '' })
      check('PATCH item_code: \'\' → 400 required (trigger only fills new rows)', noCode.status === 400 && noCode.body.field === 'item_code', noCode)
    })
  } finally {
    if (!process.env.KEEP_TEST_DATA) await cleanup(pg, tenantIds, adminIds).catch((e) => console.error('cleanup:', e.message))
    await pg.end()
    await closeAllPools()
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  process.exit(failed.length ? 1 : 0)
}

/** Remove the throw-away vendors: every tenant-scoped row first (retrying in FK order), then the globals. */
async function cleanup(pg: Client, tenantIds: string[], adminIds: string[]) {
  if (tenantIds.length) {
    const tables = (await pg.query(
      `SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t
         ON t.table_name = c.table_name AND t.table_schema = c.table_schema
       WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE' AND c.table_name <> 'tenants'`,
    )).rows.map((r) => r.table_name as string)
    const accountIds = (await pg.query(`SELECT DISTINCT account_id FROM account_tenants WHERE tenant_id = ANY($1::uuid[])`, [tenantIds])).rows.map((r) => r.account_id)
    let pending = tables
    for (let pass = 0; pass < 8 && pending.length; pass++) {
      const next: string[] = []
      for (const t of pending) {
        try { await pg.query(`DELETE FROM "${t}" WHERE tenant_id = ANY($1::uuid[])`, [tenantIds]) } catch { next.push(t) }
      }
      pending = next
    }
    await pg.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [tenantIds])
    if (accountIds.length) {
      await pg.query(`DELETE FROM account_sessions WHERE account_id = ANY($1::uuid[])`, [accountIds]).catch(() => undefined)
      await pg.query(`DELETE FROM accounts WHERE id = ANY($1::uuid[]) AND email LIKE '%@example.test'`, [accountIds]).catch((e) => console.error('accounts cleanup:', e.message))
    }
  }
  for (const id of adminIds) {
    await pg.query(`DELETE FROM admin_audit_logs WHERE super_admin_id = $1`, [id]).catch(() => undefined)
    await pg.query(`DELETE FROM admin_sessions WHERE super_admin_id = $1`, [id]).catch(() => undefined)
    await pg.query(`DELETE FROM super_admins WHERE id = $1`, [id]).catch(() => undefined)
  }
}

main().catch(async (err) => {
  console.error(err)
  await closeAllPools().catch(() => undefined)
  process.exit(1)
})
