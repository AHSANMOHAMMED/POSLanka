/**
 * J2 — pharmacy completion (drizzle/0194): substitutes, controlled-drug register, allergy warning,
 * patient medication history, prescription scans, dispensing dose instructions, expiry alert window,
 * return-to-supplier list, pharmacy reports and branch isolation (K4) on all of them.
 *
 *   DATABASE_URL=postgresql://postgres:<pw>@127.0.0.1:5433/poslanka_verify DATABASE_APP_ROLE=app_user \
 *   npx tsx --tsconfig scripts/tests/w8-harness/tsconfig.json scripts/tests/j2-pharmacy-complete.ts
 *
 * Real route handlers on a throw-away pharmacy tenant with two branches (auth via the w8 harness).
 */
import { Client } from 'pg'
import { randomUUID } from 'crypto'
import { NextRequest } from 'next/server'
import { setTestSession } from './w8-harness/auth-mock'
import { closeAllPools, withTenantTransaction } from '@/lib/db'
import { applyStockChange } from '@/lib/inventory/apply-stock-change'
import { clearBranchScopeCache } from '@/lib/auth/branch-access'
import { featureForApiPath, featureForHref } from '@/lib/features/flags'
import { POST as postSale } from '@/app/api/sales/route'
import { GET as register } from '@/app/api/prescriptions/route'
import { GET as substitutes } from '@/app/api/pharmacy/substitutes/route'
import { GET as controlled } from '@/app/api/pharmacy/controlled-register/route'
import { GET as getPatient, PATCH as patchPatient } from '@/app/api/pharmacy/patients/[id]/route'
import { GET as searchPatients } from '@/app/api/pharmacy/patients/route'
import { GET as history } from '@/app/api/pharmacy/patients/history/route'
import { GET as listScans, POST as addScan, DELETE as deleteScan } from '@/app/api/pharmacy/prescriptions/[id]/attachments/route'
import { GET as viewScan } from '@/app/api/pharmacy/prescriptions/[id]/attachments/[fileId]/route'
import { GET as getDispensing, PATCH as patchDispensing } from '@/app/api/pharmacy/sales/[id]/dispensing/route'
import { GET as getSettings, PUT as putSettings } from '@/app/api/pharmacy/settings/route'
import { GET as returnList } from '@/app/api/pharmacy/return-list/route'
import { GET as reports } from '@/app/api/pharmacy/reports/route'

type J = Record<string, unknown> & { [k: string]: any } // eslint-disable-line @typescript-eslint/no-explicit-any
interface Fx { tenantId: string; slug: string; whA: string; whB: string; owner: string; cashierA: string; customerId: string; supplierId: string }

const DB_GUARD = /@(127\.0\.0\.1|localhost)(:\d+)?\/poslanka_[a-z0-9_]+$/i

const results: Array<{ name: string; ok: boolean }> = []
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `  — ${detail}` : ''}`)
}
async function step(name: string, fn: () => Promise<void>) {
  try { await fn() } catch (err) { check(name, false, err instanceof Error ? err.stack : String(err)) }
}

function as(f: Fx, who: 'owner' | 'cashierA') {
  const isOwner = who === 'owner'
  setTestSession({
    user: {
      id: isOwner ? f.owner : f.cashierA, accountId: null, email: `${who}-${f.slug}@example.test`, name: who, role: isOwner ? 'owner' : 'cashier',
      tenantId: f.tenantId, tenantSlug: f.slug, tenantName: 'J2', businessType: 'pharmacy',
      aiEnabled: false, isSuperAdmin: false, isOwner, mode: 'company',
    },
  } as unknown as Parameters<typeof setTestSession>[0])
}
function req(method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' },
  })
}
const ctx = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) })
async function json(res: Response | undefined): Promise<{ status: number; body: J; text: string }> {
  if (!res) return { status: 0, body: { error: 'no response' }, text: '' }
  const text = await res.text()
  let body: J = {}
  try { body = JSON.parse(text) } catch { body = { raw: text.slice(0, 200) } }
  return { status: res.status, body, text }
}
const short = (b: unknown) => JSON.stringify(b).slice(0, 400)
const denied = (r: { status: number; body: J }) => r.status === 403 && r.body.code === 'BRANCH_ACCESS_DENIED'
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)

async function makeTenant(admin: Client): Promise<Fx> {
  const tenantId = randomUUID()
  const slug = `j2-${tenantId.slice(0, 8)}`
  const f: Fx = { tenantId, slug, whA: randomUUID(), whB: randomUUID(), owner: randomUUID(), cashierA: randomUUID(), customerId: randomUUID(), supplierId: randomUUID() }
  await admin.query(`INSERT INTO tenants (id, name, slug, email, business_type) VALUES ($1, 'J2 Pharmacy', $2, $3, 'pharmacy')`, [tenantId, slug, `${slug}@example.test`])
  await admin.query(`INSERT INTO warehouses (id, tenant_id, name, code, is_default) VALUES ($1, $2, 'Colombo', 'CMB', true), ($3, $2, 'Kandy', 'KDY', false)`, [f.whA, tenantId, f.whB])
  await admin.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, 'x', 'Owner', 'owner'), ($4, $2, $5, 'x', 'Cashier A', 'cashier')`,
    [f.owner, tenantId, `owner-${slug}@example.test`, f.cashierA, `cashier-${slug}@example.test`])
  await admin.query(`INSERT INTO user_warehouses (tenant_id, user_id, warehouse_id, is_active) VALUES ($1, $2, $3, true)`, [tenantId, f.cashierA, f.whA])
  await admin.query(`INSERT INTO customers (id, tenant_id, name, phone) VALUES ($1, $2, 'Nimal Perera', '0771234567')`, [f.customerId, tenantId])
  await admin.query(`INSERT INTO suppliers (id, tenant_id, name) VALUES ($1, $2, 'Hemas Pharma')`, [f.supplierId, tenantId])
  clearBranchScopeCache(tenantId)
  return f
}

async function cleanup(admin: Client, tenantId: string) {
  await admin.query(`SET session_replication_role = replica`)
  const tables = await admin.query(
    `SELECT table_name FROM information_schema.columns
     WHERE table_schema='public' AND column_name='tenant_id'
       AND table_name IN (SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE')`)
  for (const t of tables.rows) {
    await admin.query(`DELETE FROM "${t.table_name}" WHERE tenant_id=$1`, [tenantId]).catch(() => undefined)
  }
  await admin.query(`DELETE FROM tenants WHERE id=$1`, [tenantId]).catch((e) => console.warn('cleanup tenant:', e.message))
  await admin.query(`SET session_replication_role = origin`)
}

async function newItem(admin: Client, f: Fx, name: string, price: number, x: { generic?: string; strength?: string; form?: string; schedule?: string; track?: boolean } = {}) {
  const id = randomUUID()
  await admin.query(
    `INSERT INTO items (id, tenant_id, item_code, name, cost_price, selling_price, track_stock, generic_name, strength, dosage_form, drug_schedule)
     VALUES ($1, $2, $3, $4, 10, $5, $6, $7, $8, $9, $10)`,
    [id, f.tenantId, `J2-${id.slice(0, 8)}`, name, price, x.track ?? true, x.generic ?? null, x.strength ?? null, x.form ?? null, x.schedule ?? null])
  return id
}
const stock = (f: Fx, wh: string, itemId: string, qty: number, referenceType: string, reasonCode?: string) =>
  withTenantTransaction(f.tenantId, (tx) => applyStockChange(tx, {
    tenantId: f.tenantId, warehouseId: wh, itemId, mode: 'delta', qty, referenceType, source: 'system', userId: f.owner, reasonCode: reasonCode ?? null,
  }))
const sale = async (f: Fx, wh: string, body: Record<string, unknown>) =>
  json(await postSale(req('POST', '/api/sales', { warehouseId: wh, discount: 0, tax: 0, creditAmount: 0, paymentMethod: 'cash', ...body })))
const oneLine = (itemId: string, name: string, price: number, qty = 1) =>
  ({ cartItems: [{ itemId, name, quantity: qty, unitPrice: price }], subtotal: price * qty, total: price * qty, amountPaid: price * qty })

// 1×1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

async function main() {
  const url = process.env.DATABASE_URL || ''
  if (!DB_GUARD.test(url)) throw new Error(`Refusing to run against ${url}: use a local poslanka_* scratch database`)
  const admin = new Client({ connectionString: url })
  await admin.connect()
  const tenants: string[] = []
  try {
    const f = await makeTenant(admin)
    tenants.push(f.tenantId)
    as(f, 'owner')
    const panadol = await newItem(admin, f, 'Panadol 500mg', 50, { generic: 'Paracetamol', strength: '500 mg', form: 'Tablet', schedule: 'otc' })
    const calpol = await newItem(admin, f, 'Calpol 500', 40, { generic: 'paracetamol', strength: '500MG', form: 'tablet', schedule: 'otc' })
    const noForm = await newItem(admin, f, 'Paracetamol (SPC) 500mg', 20, { generic: 'Paracetamol', strength: '500mg' })
    const syrup = await newItem(admin, f, 'Calpol syrup', 300, { generic: 'Paracetamol', strength: '500 mg', form: 'Syrup' })
    const strong = await newItem(admin, f, 'Panadol 1g', 90, { generic: 'Paracetamol', strength: '1 g', form: 'Tablet' })
    const valium = await newItem(admin, f, 'Valium 5mg', 80, { generic: 'Diazepam', strength: '5 mg', form: 'Tablet', schedule: 'controlled' })
    const amox = await newItem(admin, f, 'Amoxil 250mg', 120, { generic: 'Amoxicillin', strength: '250 mg', form: 'Capsule', schedule: 'prescription', track: false })
    await stock(f, f.whA, calpol, 30, 'test_seed')
    await stock(f, f.whB, noForm, 7, 'test_seed')

    await step('substitutes', async () => {
      const r = await json(await substitutes(req('GET', `/api/pharmacy/substitutes?itemId=${panadol}&warehouseId=${f.whA}`)))
      const ids = (r.body.substitutes || []).map((s: J) => s.id)
      check('same generic + strength (case / spaces ignored) are substitutes', r.status === 200 && ids.includes(calpol) && ids.includes(noForm), short(r.body))
      check('other strength and other dosage form are not', !ids.includes(strong) && !ids.includes(syrup) && !ids.includes(panadol), short(ids))
      const c = r.body.substitutes.find((s: J) => s.id === calpol)
      check('substitute carries branch stock and price; in-stock first', c?.availableStock === 30 && Number(c?.sellingPrice) === 40 && ids[0] === calpol, short({ c, ids }))
      const nf = r.body.substitutes.find((s: J) => s.id === noForm)
      check('stock is per branch (Kandy stock not counted at Colombo)', nf?.availableStock === 0, short(nf))
      const none = await json(await substitutes(req('GET', `/api/pharmacy/substitutes?itemId=${amox}&warehouseId=${f.whA}`)))
      check('no other brand → empty list', none.status === 200 && none.body.substitutes.length === 0, short(none.body))
      const bad = await json(await substitutes(req('GET', '/api/pharmacy/substitutes')))
      check('itemId required → 400', bad.status === 400)
    })

    // Controlled drug: 100 received at Colombo 10 days ago, 20 at Kandy; today 3 dispensed with a prescription and 2 written off
    let valiumSaleId = ''
    let rxA = ''
    await step('controlled drug register', async () => {
      const recv = await stock(f, f.whA, valium, 100, 'purchase')
      await admin.query(`UPDATE stock_movements SET created_at = now() - interval '10 days' WHERE id = $1`, [recv.movementId])
      await stock(f, f.whB, valium, 20, 'purchase')
      const s = await sale(f, f.whA, { ...oneLine(valium, 'Valium 5mg', 80, 3), customerId: f.customerId,
        prescription: { doctorName: 'Dr. N. Perera', doctorRegNo: 'SLMC 12345', patientName: 'Nimal Perera', prescriptionNo: 'RX-77', patientPhone: '077 123 4567' } })
      check('controlled sale with prescription → 200', s.status === 200, short(s.body))
      valiumSaleId = s.body.id
      rxA = (await admin.query(`SELECT id FROM prescriptions WHERE sale_id = $1`, [valiumSaleId])).rows[0]?.id
      await stock(f, f.whA, valium, -2, 'manual_adjustment', 'damage')

      const r = await json(await controlled(req('GET', `/api/pharmacy/controlled-register?from=${day(-5)}&to=${day(0)}&warehouseId=${f.whA}`)))
      const d = (r.body.data || []).find((x: J) => x.itemId === valium)
      check('only controlled medicines are listed', r.status === 200 && r.body.data.length === 1 && !!d, short(r.body))
      check('Colombo, last 5 days: opening 100, dispensed 3, adjustment −2, closing 95',
        d?.opening === 100 && d?.dispensed === 3 && d?.adjustments === -2 && d?.received === 0 && d?.closing === 95, short(d && { ...d, lines: undefined }))
      const disp = d?.lines?.find((l: J) => l.category === 'dispensed')
      check('dispensing line has bill, doctor, SLMC no., patient, Rx no. and running balance',
        disp?.referenceNo === s.body.invoiceNo && disp?.doctorName === 'Dr. N. Perera' && disp?.doctorRegNo === 'SLMC 12345'
        && disp?.patientName === 'Nimal Perera' && disp?.prescriptionNo === 'RX-77' && disp?.qtyOut === 3 && disp?.balance === 97, short(disp))
      const onHand = Number((await admin.query(`SELECT current_stock FROM warehouse_stock WHERE item_id = $1 AND warehouse_id = $2`, [valium, f.whA])).rows[0]?.current_stock)
      check('closing balance = stock on hand', onHand === d?.closing, `${onHand}`)

      const wide = await json(await controlled(req('GET', `/api/pharmacy/controlled-register?from=${day(-15)}&to=${day(0)}`)))
      const w = wide.body.data?.[0]
      check('all branches, 15 days: opening 0, received 120, closing 115', w?.opening === 0 && w?.received === 120 && w?.closing === 115, short(w && { ...w, lines: undefined }))
      const before = await json(await controlled(req('GET', `/api/pharmacy/controlled-register?from=${day(-15)}&to=${day(-3)}&warehouseId=${f.whA}`)))
      check('range ending before today: closing 100 (later movements excluded)', before.body.data?.[0]?.closing === 100 && before.body.data?.[0]?.lines.length === 1, short(before.body.data?.[0]))
      const csv = await json(await controlled(req('GET', `/api/pharmacy/controlled-register?from=${day(-5)}&to=${day(0)}&warehouseId=${f.whA}&format=csv`)))
      check('CSV export with opening / closing rows', csv.status === 200 && csv.text.includes('Opening balance') && csv.text.includes('Closing balance') && csv.text.includes('SLMC 12345'), csv.text.slice(0, 300))
    })

    await step('allergy warning', async () => {
      const set = await json(await patchPatient(req('PATCH', `/api/pharmacy/patients/${f.customerId}`, { allergies: 'Penicillin', medicalNotes: 'Diabetic' }), ctx({ id: f.customerId })))
      check('save allergies / notes', set.status === 200 && set.body.allergies === 'Penicillin', short(set.body))
      const g = await json(await getPatient(req('GET', `/api/pharmacy/patients/${f.customerId}`), ctx({ id: f.customerId })))
      check('POS lookup returns the warning', g.body.hasWarning === true && g.body.allergies === 'Penicillin' && g.body.medicalNotes === 'Diabetic', short(g.body))
      const clr = await json(await patchPatient(req('PATCH', `/api/pharmacy/patients/${f.customerId}`, { medicalNotes: '' }), ctx({ id: f.customerId })))
      check("'' clears one field, the other stays", clr.body.medicalNotes === null && clr.body.allergies === 'Penicillin', short(clr.body))
      const s = await json(await searchPatients(req('GET', '/api/pharmacy/patients?q=4567')))
      check('patient search by phone digits', s.body.customers?.some((c: J) => c.id === f.customerId && c.allergies === 'Penicillin'), short(s.body))
      const other = await json(await getPatient(req('GET', `/api/pharmacy/patients/${randomUUID()}`), ctx({ id: randomUUID() })))
      check('unknown customer → 404', other.status === 404)
    })

    // A walk-in at Kandy (prescription, no customer) and a sale to the same customer at Kandy
    let rxB = ''
    let kandySaleId = ''
    await step('patient history', async () => {
      const w = await sale(f, f.whB, { ...oneLine(amox, 'Amoxil', 120), prescription: { doctorName: 'Dr. K. Silva', patientName: 'Sunil Fernando', patientPhone: '0719998877' } })
      check('walk-in prescription sale at Kandy → 200', w.status === 200, short(w.body))
      rxB = (await admin.query(`SELECT id FROM prescriptions WHERE sale_id = $1`, [w.body.id])).rows[0]?.id
      const k = await sale(f, f.whB, { ...oneLine(amox, 'Amoxil', 120, 2), customerId: f.customerId, prescription: { doctorName: 'Dr. K. Silva' } })
      kandySaleId = k.body.id
      await sale(f, f.whA, { ...oneLine(calpol, 'Calpol', 40), customerId: f.customerId })

      const h = await json(await history(req('GET', `/api/pharmacy/patients/history?customerId=${f.customerId}`)))
      const names = (h.body.data || []).map((l: J) => l.itemName)
      check('customer history: medicines from both branches, newest first', h.status === 200 && names.includes('Valium 5mg') && names.includes('Amoxil') && names.includes('Calpol'), short(names))
      const v = h.body.data.find((l: J) => l.itemName === 'Valium 5mg')
      check('history line has doctor and quantity', v?.doctorName === 'Dr. N. Perera' && v?.quantity === 3, short(v))
      const ph = await json(await history(req('GET', '/api/pharmacy/patients/history?phone=071-999-8877')))
      check('walk-in history by phone (formatting ignored)', ph.body.data?.length === 1 && ph.body.data[0].patientName === 'Sunil Fernando', short(ph.body))
      const nm = await json(await history(req('GET', '/api/pharmacy/patients/history?name=sunil fernando')))
      check('walk-in history by name', nm.body.data?.length === 1, short(nm.body))
      const walk = await json(await searchPatients(req('GET', '/api/pharmacy/patients?q=Sunil')))
      check('walk-in patients found from prescriptions', walk.body.walkIns?.some((p: J) => p.patientName === 'Sunil Fernando'), short(walk.body))
    })

    await step('dispensing dose instructions', async () => {
      const g = await json(await getDispensing(req('GET', `/api/pharmacy/sales/${valiumSaleId}/dispensing`), ctx({ id: valiumSaleId })))
      const line = g.body.lines?.[0]
      check('label data: pharmacy, patient, doctor, medicine', g.status === 200 && g.body.pharmacy?.name === 'J2 Pharmacy' && g.body.prescription?.patientName === 'Nimal Perera' && line?.genericName === 'Diazepam', short(g.body))
      const p = await json(await patchDispensing(req('PATCH', `/api/pharmacy/sales/${valiumSaleId}/dispensing`, { lines: [{ saleItemId: line.saleItemId, dosageInstructions: '1 tablet at night' }] }), ctx({ id: valiumSaleId })))
      check('dose instructions saved on the line', p.status === 200 && p.body.lines[0].dosageInstructions === '1 tablet at night', short(p.body))
      const h = await json(await history(req('GET', `/api/pharmacy/patients/history?customerId=${f.customerId}`)))
      check('dose shows in the medication history', h.body.data.some((l: J) => l.dosageInstructions === '1 tablet at night'), short(h.body.data))
      const foreign = await json(await patchDispensing(req('PATCH', `/api/pharmacy/sales/${valiumSaleId}/dispensing`, { lines: [{ saleItemId: randomUUID(), dosageInstructions: 'x' }] }), ctx({ id: valiumSaleId })))
      check('a line of another bill → 400', foreign.status === 400, short(foreign.body))
    })

    let scanId = ''
    await step('prescription scans', async () => {
      const form = new FormData()
      form.append('file', new File([PNG], 'rx.png', { type: 'image/png' }))
      const up = await json(await addScan(new NextRequest(`http://localhost/api/pharmacy/prescriptions/${rxA}/attachments`, { method: 'POST', body: form }), ctx({ id: rxA })))
      check('upload a prescription photo → 201', up.status === 201 && !!up.body.id, short(up.body))
      scanId = up.body.id
      const row = (await admin.query(`SELECT is_private, attached_to_type FROM files WHERE id = $1`, [scanId])).rows[0]
      check('stored private, attached to the prescription', row?.is_private === true && row?.attached_to_type === 'prescription', JSON.stringify(row))
      const list = await json(await listScans(req('GET', `/api/pharmacy/prescriptions/${rxA}/attachments`), ctx({ id: rxA })))
      check('listed', list.body.data?.length === 1, short(list.body))
      const v = await viewScan(req('GET', `/api/pharmacy/prescriptions/${rxA}/attachments/${scanId}`), ctx({ id: rxA, fileId: scanId }))
      const bytes = Buffer.from(await v.arrayBuffer())
      check('served inline as the image', v.status === 200 && v.headers.get('content-type') === 'image/png' && bytes.equals(PNG), `${v.status} ${v.headers.get('content-type')}`)
      const reg = await json(await register(req('GET', '/api/prescriptions')))
      check('register shows the scan count', reg.body.data?.find((p: J) => p.id === rxA)?.attachments === 1, short(reg.body.data))
      const bad = new FormData()
      bad.append('file', new File([Buffer.from('not an image')], 'rx.exe', { type: 'application/x-msdownload' }))
      const refused = await json(await addScan(new NextRequest(`http://localhost/x`, { method: 'POST', body: bad }), ctx({ id: rxA })))
      check('other file types refused → 400', refused.status === 400, short(refused.body))
    })

    await step('expiry window and return-to-supplier list', async () => {
      const g = await json(await getSettings())
      check('expiry alert window defaults to 90 days', g.body.expiryAlertDays === 90, short(g.body))
      const ins = (item: string, wh: string, batch: string, exp: string, qty: number) => admin.query(
        `INSERT INTO item_batches (tenant_id, item_id, batch_number, warehouse_id, expiry_date, initial_quantity, current_quantity, supplier_id) VALUES ($1,$2,$3,$4,$5,$6,$6,$7)`,
        [f.tenantId, item, batch, wh, exp, qty, f.supplierId])
      await ins(calpol, f.whA, 'C-OLD', day(-3), 4)
      await ins(calpol, f.whA, 'C-SOON', day(20), 6)
      await ins(calpol, f.whA, 'C-60', day(60), 8)
      await ins(noForm, f.whB, 'K-SOON', day(10), 5)
      const all = await json(await returnList(req('GET', '/api/pharmacy/return-list')))
      const batches = (all.body.suppliers || []).flatMap((s: J) => s.batches.map((b: J) => b.batchNumber))
      check('default window (90 days): expired + 20 d + 60 d, grouped by supplier', all.status === 200 && all.body.days === 90 && all.body.suppliers[0]?.supplierName === 'Hemas Pharma'
        && ['C-OLD', 'C-SOON', 'C-60', 'K-SOON'].every((b) => batches.includes(b)), short(all.body))
      const put = await json(await putSettings(req('PUT', '/api/pharmacy/settings', { expiryAlertDays: 30 })))
      check('alert window saved', put.status === 200 && put.body.expiryAlertDays === 30, short(put.body))
      const kept = (await admin.query(`SELECT settings FROM tenants WHERE id = $1`, [f.tenantId])).rows[0]?.settings
      check('other tenant settings untouched (merge, not overwrite)', kept?.pharmacy?.expiryAlertDays === 30, JSON.stringify(kept))
      const short30 = await json(await returnList(req('GET', '/api/pharmacy/return-list')))
      const b30 = (short30.body.suppliers || []).flatMap((s: J) => s.batches.map((b: J) => b.batchNumber))
      check('30-day window drops the 60-day batch', short30.body.days === 30 && !b30.includes('C-60') && b30.includes('C-SOON'), short(b30))
      const bad = await json(await putSettings(req('PUT', '/api/pharmacy/settings', { expiryAlertDays: 0 })))
      check('invalid window → 400', bad.status === 400)
    })

    await step('pharmacy reports', async () => {
      const r = await json(await reports(req('GET', `/api/pharmacy/reports?from=${day(-1)}&to=${day(0)}`)))
      check('reports → 200', r.status === 200, short(r.body))
      const dz = r.body.byGeneric?.find((g: J) => g.genericName === 'Diazepam')
      const am = r.body.byGeneric?.find((g: J) => g.genericName === 'Amoxicillin')
      check('sales by generic: Diazepam 3, Amoxicillin 3 (two bills)', dz?.quantity === 3 && dz?.revenue === 240 && am?.quantity === 3 && am?.bills === 2, short(r.body.byGeneric))
      const pr = r.body.prescriptions
      check('prescription-only sales: 3 bills, 3 prescriptions, 1 controlled', pr?.rxBills === 3 && pr?.prescriptions === 3 && pr?.controlledBills === 1 && pr?.controlledPrescriptions === 1, short(pr))
      check('expiry loss: expired batch on hand at cost (4 × 10)', r.body.expiry?.expiredOnHand?.value === 40, short(r.body.expiry))
      await stock(f, f.whA, calpol, -1, 'manual_adjustment', 'expiry')
      const r2 = await json(await reports(req('GET', `/api/pharmacy/reports?from=${day(-1)}&to=${day(0)}`)))
      check('stock written off as expired counts as loss', r2.body.expiry?.writtenOff?.value === 10, short(r2.body.expiry))
    })

    await step('branch isolation (cashier of Colombo)', async () => {
      as(f, 'cashierA')
      const sub = await json(await substitutes(req('GET', `/api/pharmacy/substitutes?itemId=${panadol}&warehouseId=${f.whB}`)))
      check('substitutes with Kandy stock → 403', denied(sub), short(sub.body))
      const own = await json(await substitutes(req('GET', `/api/pharmacy/substitutes?itemId=${panadol}`)))
      check('substitutes default to the own branch', own.status === 200 && own.body.warehouseId === f.whA, short(own.body))
      const reg = await json(await register(req('GET', '/api/prescriptions')))
      const ids = (reg.body.data || []).map((p: J) => p.id)
      check('prescription register: own branch only', ids.includes(rxA) && !ids.includes(rxB), short(ids))
      const scansB = await json(await listScans(req('GET', `/api/pharmacy/prescriptions/${rxB}/attachments`), ctx({ id: rxB })))
      check('scans of a Kandy prescription → 403', denied(scansB), short(scansB.body))
      const h = await json(await history(req('GET', `/api/pharmacy/patients/history?customerId=${f.customerId}`)))
      check('history: Kandy bills hidden', h.status === 200 && !h.body.data.some((l: J) => l.saleId === kandySaleId) && h.body.data.some((l: J) => l.saleId === valiumSaleId), short(h.body))
      const disp = await json(await getDispensing(req('GET', `/api/pharmacy/sales/${kandySaleId}/dispensing`), ctx({ id: kandySaleId })))
      check('dispensing labels of a Kandy bill → 403', denied(disp), short(disp.body))
      const g = await json(await getPatient(req('GET', `/api/pharmacy/patients/${f.customerId}`), ctx({ id: f.customerId })))
      check('cashier sees the allergy warning at the POS', g.status === 200 && g.body.allergies === 'Penicillin')
      const ctl = await json(await controlled(req('GET', `/api/pharmacy/controlled-register?from=${day(-15)}&to=${day(0)}`)))
      check('cashier (no viewReports / manageInventory) cannot open the controlled register', ctl.status === 403, short(ctl.body))
      const rep = await json(await reports(req('GET', '/api/pharmacy/reports')))
      check('cashier cannot open pharmacy reports', rep.status === 403)
      const rl = await json(await returnList(req('GET', '/api/pharmacy/return-list')))
      check('cashier cannot open the return list', rl.status === 403)
      // A branch manager of Colombo: register and return list limited to Colombo
      await admin.query(`UPDATE users SET role = 'manager' WHERE id = $1`, [f.cashierA])
      setTestSession({ user: { id: f.cashierA, accountId: null, email: 'm@example.test', name: 'Manager A', role: 'manager', tenantId: f.tenantId, tenantSlug: f.slug,
        tenantName: 'J2', businessType: 'pharmacy', aiEnabled: false, isSuperAdmin: false, isOwner: false, mode: 'company' } } as unknown as Parameters<typeof setTestSession>[0])
      clearBranchScopeCache(f.tenantId)
      const mc = await json(await controlled(req('GET', `/api/pharmacy/controlled-register?from=${day(-15)}&to=${day(0)}`)))
      const md = mc.body.data?.[0]
      check('branch manager: register covers Colombo only (received 100, closing 95)', mc.status === 200 && md?.received === 100 && md?.closing === 95, short(md && { ...md, lines: undefined }))
      const mk = await json(await controlled(req('GET', `/api/pharmacy/controlled-register?warehouseId=${f.whB}`)))
      check('branch manager: Kandy register → 403', denied(mk), short(mk.body))
      const ml = await json(await returnList(req('GET', '/api/pharmacy/return-list?days=90')))
      const mb = (ml.body.suppliers || []).flatMap((s: J) => s.batches.map((b: J) => b.batchNumber))
      check('branch manager: return list without Kandy batches', ml.status === 200 && mb.includes('C-SOON') && !mb.includes('K-SOON'), short(mb))
      const mr = await json(await reports(req('GET', `/api/pharmacy/reports?from=${day(-1)}&to=${day(0)}`)))
      const mam = mr.body.byGeneric?.find((g: J) => g.genericName === 'Amoxicillin')
      check('branch manager: reports without Kandy sales', mr.status === 200 && !mam && mr.body.prescriptions?.prescriptions === 1, short(mr.body.prescriptions))
      as(f, 'owner')
    })

    await step('cleanup scan + feature switch', async () => {
      const del = await json(await deleteScan(req('DELETE', `/api/pharmacy/prescriptions/${rxA}/attachments?attachmentId=${scanId}`), ctx({ id: rxA })))
      check('remove a scan', del.status === 200 && (await admin.query(`SELECT 1 FROM files WHERE id = $1`, [scanId])).rowCount === 0, short(del.body))
      check('new pharmacy APIs and pages follow the pharmacy switch',
        featureForApiPath('/api/pharmacy/substitutes') === 'pharmacy' && featureForApiPath('/api/pharmacy/controlled-register') === 'pharmacy'
        && featureForApiPath(`/api/pharmacy/patients/${f.customerId}`, 'PATCH') === 'pharmacy'
        && featureForHref('/pharmacy/controlled-register') === 'pharmacy' && featureForHref('/pharmacy/patients') === 'pharmacy'
        && featureForHref('/pharmacy/reports') === 'pharmacy' && featureForHref('/pharmacy/return-list') === 'pharmacy')
    })
  } finally {
    if (process.env.KEEP_TEST_DATA !== '1') for (const t of tenants) await cleanup(admin, t)
    await admin.end()
    await closeAllPools()
  }
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  process.exit(failed.length ? 1 : 0)
}

main().catch(async (err) => {
  console.error(err)
  await closeAllPools().catch(() => undefined)
  process.exit(1)
})
