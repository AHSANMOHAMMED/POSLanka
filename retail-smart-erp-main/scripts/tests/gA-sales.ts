/**
 * Audit A — sales & POS checkout integration test.
 *
 *   DATABASE_URL=postgresql://postgres:poslanka@127.0.0.1:5433/poslanka_audit_a DATABASE_APP_ROLE=app_user \
 *   npx tsx --tsconfig scripts/tests/w8-harness/tsconfig.json scripts/tests/gA-sales.ts
 *
 * Calls the real route handlers (auth mocked via the w8 harness) on throw-away tenants, prints
 * PASS/FAIL per check and exits non-zero on failure. KEEP_TEST_DATA=1 keeps the tenants.
 */
import { Client } from 'pg'
import { randomUUID } from 'crypto'
import { NextRequest } from 'next/server'
import { setTestSession } from './w8-harness/auth-mock'
import { closeAllPools, withTenantTransaction } from '@/lib/db'
import { applyStockChange } from '@/lib/inventory/apply-stock-change'
import { POST as postSale } from '@/app/api/sales/route'
import { PUT as voidSale } from '@/app/api/sales/[id]/route'
import { POST as addPayment } from '@/app/api/sales/[id]/payments/route'
import { POST as closeShift } from '@/app/api/pos-opening-entries/[id]/close/route'
import { GET as getShift } from '@/app/api/pos-opening-entries/[id]/route'
import { GET as dailySummary } from '@/app/api/pos-daily-summary/route'

type J = Record<string, unknown> & { [k: string]: any } // eslint-disable-line @typescript-eslint/no-explicit-any
interface Fx { tenantId: string; slug: string; wh: string; userId: string; customerId: string }

const DB_GUARD = /@(127\.0\.0\.1|localhost)(:\d+)?\/poslanka_[a-z0-9_]+$/i

const results: Array<{ name: string; ok: boolean }> = []
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `  — ${detail}` : ''}`)
}
async function step(name: string, fn: () => Promise<void>) {
  try { await fn() } catch (err) { check(name, false, err instanceof Error ? err.stack : String(err)) }
}

function session(f: Fx) {
  return {
    user: {
      id: f.userId, accountId: null, email: `owner-${f.slug}@example.test`, name: 'Owner', role: 'owner',
      tenantId: f.tenantId, tenantSlug: f.slug, tenantName: 'GA', businessType: 'retail',
      aiEnabled: false, isSuperAdmin: false, isOwner: true, mode: 'company',
    },
  } as unknown as Parameters<typeof setTestSession>[0]
}
function req(method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' },
  })
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
async function json(res: Response | undefined): Promise<{ status: number; body: J }> {
  if (!res) return { status: 0, body: { error: 'no response' } }
  const text = await res.text()
  let body: J = {}
  try { body = JSON.parse(text) } catch { body = { raw: text } }
  return { status: res.status, body }
}
const short = (b: unknown) => JSON.stringify(b).slice(0, 300)

async function makeTenant(admin: Client, label: string): Promise<Fx> {
  const tenantId = randomUUID()
  const slug = `ga-${label}-${tenantId.slice(0, 8)}`
  const f: Fx = { tenantId, slug, wh: randomUUID(), userId: randomUUID(), customerId: randomUUID() }
  await admin.query(`INSERT INTO tenants (id, name, slug, email) VALUES ($1, 'GA test', $2, $3)`, [tenantId, slug, `${slug}@example.test`])
  await admin.query(`INSERT INTO warehouses (id, tenant_id, name, code, is_default) VALUES ($1, $2, 'Main', 'MAIN', true)`, [f.wh, tenantId])
  await admin.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, 'x', 'Owner', 'owner')`,
    [f.userId, tenantId, `owner-${slug}@example.test`])
  await admin.query(`INSERT INTO customers (id, tenant_id, name) VALUES ($1, $2, 'Nimal Perera')`, [f.customerId, tenantId])
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

async function newItem(admin: Client, f: Fx, name: string, price: number, opts: { stock?: number; giftCard?: boolean; trackStock?: boolean } = {}) {
  const id = randomUUID()
  await admin.query(
    `INSERT INTO items (id, tenant_id, item_code, name, cost_price, selling_price, track_stock, is_gift_card)
     VALUES ($1, $2, $3, $4, 0, $5, $6, $7)`,
    [id, f.tenantId, `GA-${id.slice(0, 8)}`, name, price, opts.trackStock ?? !opts.giftCard, !!opts.giftCard])
  if (opts.stock) {
    await withTenantTransaction(f.tenantId, (tx) => applyStockChange(tx, {
      tenantId: f.tenantId, warehouseId: f.wh, itemId: id, mode: 'delta', qty: opts.stock!, referenceType: 'test_seed', source: 'system', userId: f.userId,
    }))
  }
  return id
}
async function stockOf(admin: Client, wh: string, itemId: string) {
  const r = await admin.query(`SELECT current_stock FROM warehouse_stock WHERE warehouse_id=$1 AND item_id=$2`, [wh, itemId])
  return r.rows[0] ? Number(r.rows[0].current_stock) : 0
}
async function newGiftCard(admin: Client, f: Fx, balance: number) {
  const id = randomUUID()
  await admin.query(`INSERT INTO gift_cards (id, tenant_id, card_number, initial_balance, current_balance, status) VALUES ($1,$2,$3,$4,$4,'active')`,
    [id, f.tenantId, `GC-T-${id.slice(0, 8)}`, balance])
  return id
}
async function cardBalance(admin: Client, id: string) {
  const r = await admin.query(`SELECT current_balance::float b, status FROM gift_cards WHERE id=$1`, [id])
  return r.rows[0] as { b: number; status: string }
}
const sale = async (f: Fx, body: Record<string, unknown>) => json(await postSale(req('POST', '/api/sales', { warehouseId: f.wh, discount: 0, tax: 0, creditAmount: 0, ...body })))

async function main() {
  const url = process.env.DATABASE_URL || ''
  if (!DB_GUARD.test(url)) throw new Error(`Refusing to run against ${url}: use a local poslanka_* scratch database`)
  const admin = new Client({ connectionString: url })
  await admin.connect()
  const tenants: string[] = []
  try {
    const f = await makeTenant(admin, 'main')
    tenants.push(f.tenantId)
    setTestSession(session(f))
    const A = await newItem(admin, f, 'Dhal 1kg', 400, { stock: 50 })
    const B = await newItem(admin, f, 'Sugar 1kg', 300, { stock: 50 })

    // ---------- 1. same item on two lines
    await step('two lines of one item', async () => {
      const r = await sale(f, {
        cartItems: [
          { itemId: A, name: 'Dhal', quantity: 2, unitPrice: 400 },
          { itemId: A, name: 'Dhal (promo)', quantity: 1, unitPrice: 350 },
        ],
        paymentMethod: 'cash', subtotal: 1150, total: 1150, amountPaid: 1150,
      })
      check('same item on two lines (e.g. edited price) → 200', r.status === 200, short(r.body))
      check('both lines recorded and stock −3', r.status === 200 && (await stockOf(admin, f.wh, A)) === 47, String(await stockOf(admin, f.wh, A)))
    })

    // ---------- 2. negative line on a normal sale
    await step('negative quantity', async () => {
      const before = await stockOf(admin, f.wh, B)
      const r = await sale(f, {
        cartItems: [
          { itemId: A, name: 'Dhal', quantity: 2, unitPrice: 400 },
          { itemId: B, name: 'Sugar', quantity: -1, unitPrice: 300 },
        ],
        paymentMethod: 'cash', subtotal: 500, total: 500, amountPaid: 500,
      })
      check('negative line on a normal sale (hidden return) → 400', r.status === 400, short(r.body))
      check('stock of the "returned" item unchanged', (await stockOf(admin, f.wh, B)) === before)
    })

    // ---------- 3. total must follow from lines / discount / tax
    await step('total validation', async () => {
      const r = await sale(f, {
        cartItems: [{ itemId: B, name: 'Sugar', quantity: 2, unitPrice: 300 }],
        paymentMethod: 'cash', subtotal: 600, total: 60, amountPaid: 60,
      })
      check('total 60 for 600 of goods → 400 TOTAL_MISMATCH', r.status === 400 && r.body.code === 'TOTAL_MISMATCH', short(r.body))
      const ok = await sale(f, {
        cartItems: [{ itemId: B, name: 'Sugar', quantity: 2, unitPrice: 300 }],
        paymentMethod: 'cash', subtotal: 600, discount: 50, discountType: 'fixed', total: 550, amountPaid: 1000,
      })
      check('discounted total 550, cash 1000 → 200 completed, cash row 550 (change not revenue)', ok.status === 200 && ok.body.status === 'completed', short(ok.body))
      const pay = await admin.query(`SELECT amount::float a FROM payments WHERE sale_id=$1`, [ok.body.id])
      check('payment row = 550', pay.rows.length === 1 && pay.rows[0].a === 550, JSON.stringify(pay.rows))
    })

    // ---------- 4. store credit
    await step('store credit', async () => {
      await admin.query(`UPDATE customers SET balance = 100 WHERE id=$1`, [f.customerId])
      const noCust = await sale(f, {
        cartItems: [{ itemId: B, name: 'Sugar', quantity: 1, unitPrice: 300 }],
        paymentMethod: 'cash', subtotal: 300, total: 300, amountPaid: 200, creditAmount: 100,
      })
      check('store credit without a customer → 400', noCust.status === 400, short(noCust.body))
      const tooMuch = await sale(f, {
        customerId: f.customerId,
        cartItems: [{ itemId: B, name: 'Sugar', quantity: 1, unitPrice: 50 }],
        paymentMethod: 'cash', subtotal: 50, total: 50, amountPaid: 0, creditAmount: 80,
      })
      check('store credit above the total → 400 (credit not silently lost)', tooMuch.status === 400, short(tooMuch.body))

      // two concurrent sales each spending 80 of a 100 balance: exactly one wins
      const mk = () => sale(f, {
        customerId: f.customerId,
        cartItems: [{ itemId: B, name: 'Sugar', quantity: 1, unitPrice: 300 }],
        paymentMethod: 'cash', subtotal: 300, total: 300, amountPaid: 220, creditAmount: 80,
      })
      const [r1, r2] = await Promise.all([mk(), mk()])
      const okCount = [r1, r2].filter((r) => r.status === 200).length
      const bal = Number((await admin.query(`SELECT balance FROM customers WHERE id=$1`, [f.customerId])).rows[0].balance)
      check('concurrent store-credit spends: one succeeds, one 400', okCount === 1 && [r1, r2].some((r) => r.status === 400), `${r1.status}/${r2.status} ${short(r1.body)} ${short(r2.body)}`)
      check('balance 100 → 20, never negative', bal === 20, String(bal))
    })

    // ---------- 5. split tender
    await step('split tender', async () => {
      const r = await sale(f, {
        customerId: f.customerId,
        cartItems: [{ itemId: B, name: 'Sugar', quantity: 1, unitPrice: 300 }],
        paymentMethod: 'credit', paymentSplits: [{ method: 'credit', amount: 200 }, { method: 'cash', amount: 100 }],
        subtotal: 300, total: 300, amountPaid: 300,
      })
      check('split on-account 200 + cash 100 → 200, status partial', r.status === 200 && r.body.status === 'partial' && Number(r.body.paidAmount) === 100, short(r.body))
      const pay = await admin.query(`SELECT method::text m, amount::float a FROM payments WHERE sale_id=$1`, [r.body.id])
      check('only the cash 100 is a payment row (on-account part stays due)', pay.rows.length === 1 && pay.rows[0].m === 'cash' && pay.rows[0].a === 100, JSON.stringify(pay.rows))
      const due = await json(await addPayment(req('POST', `/api/sales/${r.body.id}/payments`, { amount: 200, method: 'cash' }), ctx(r.body.id)))
      check('customer can later pay the 200 due → completed', due.status === 200 && due.body.status === 'completed', short(due.body))

      const over = await sale(f, {
        cartItems: [{ itemId: B, name: 'Sugar', quantity: 1, unitPrice: 300 }],
        paymentMethod: 'cash', paymentSplits: [{ method: 'cash', amount: 200 }, { method: 'card', amount: 300 }],
        subtotal: 300, total: 300, amountPaid: 500,
      })
      check('splits adding up to more than the total → 400', over.status === 400 && over.body.code === 'SPLIT_OVERPAYMENT', short(over.body))
    })

    // ---------- 6. gift cards
    await step('gift card redemption + void', async () => {
      const noCard = await sale(f, {
        cartItems: [{ itemId: B, name: 'Sugar', quantity: 1, unitPrice: 300 }],
        paymentMethod: 'gift_card', subtotal: 300, total: 300, amountPaid: 300,
      })
      check('gift-card tender without a card → 400', noCard.status === 400, short(noCard.body))

      const card = await newGiftCard(admin, f, 1000)
      const r = await sale(f, {
        cartItems: [{ itemId: B, name: 'Sugar', quantity: 1, unitPrice: 300 }],
        paymentMethod: 'gift_card', giftCardId: card, subtotal: 300, total: 300, amountPaid: 500,
      })
      check('gift card pays 300 (tendered 500) → 200', r.status === 200, short(r.body))
      check('card drawn by the sale total only (1000 → 700)', (await cardBalance(admin, card)).b === 700, JSON.stringify(await cardBalance(admin, card)))
      const v = await json(await voidSale(req('PUT', `/api/sales/${r.body.id}`, { voidReason: 'ga' }), ctx(r.body.id)))
      check('void → 200 and gift card balance restored (700 → 1000)', v.status === 200 && (await cardBalance(admin, card)).b === 1000, `${v.status} ${JSON.stringify(await cardBalance(admin, card))}`)

      const G = await newItem(admin, f, 'Gift card 500', 500, { giftCard: true })
      const g = await sale(f, {
        cartItems: [{ itemId: G, name: 'Gift card', quantity: 1, unitPrice: 500 }],
        paymentMethod: 'cash', subtotal: 500, total: 500, amountPaid: 500,
      })
      const issued = (await admin.query(`SELECT id FROM gift_cards WHERE purchase_sale_id=$1`, [g.body.id])).rows
      check('selling a gift card item issues a card', g.status === 200 && issued.length === 1, short(g.body))
      const vg = await json(await voidSale(req('PUT', `/api/sales/${g.body.id}`, { voidReason: 'ga' }), ctx(g.body.id)))
      const after = issued[0] ? await cardBalance(admin, issued[0].id) : null
      check('voiding the gift-card sale blocks the unused card (balance 0)', vg.status === 200 && after?.status === 'blocked' && after.b === 0, `${vg.status} ${JSON.stringify(after)}`)

      const g2 = await sale(f, {
        cartItems: [{ itemId: G, name: 'Gift card', quantity: 1, unitPrice: 500 }],
        paymentMethod: 'cash', subtotal: 500, total: 500, amountPaid: 500,
      })
      const c2 = (await admin.query(`SELECT id FROM gift_cards WHERE purchase_sale_id=$1`, [g2.body.id])).rows[0].id
      const spend = await sale(f, {
        cartItems: [{ itemId: B, name: 'Sugar', quantity: 1, unitPrice: 300 }],
        paymentMethod: 'gift_card', giftCardId: c2, subtotal: 300, total: 300, amountPaid: 300,
      })
      check('issued card spent 300', spend.status === 200, short(spend.body))
      const vg2 = await json(await voidSale(req('PUT', `/api/sales/${g2.body.id}`, { voidReason: 'ga' }), ctx(g2.body.id)))
      const s2 = (await admin.query(`SELECT status FROM sales WHERE id=$1`, [g2.body.id])).rows[0].status
      check('voiding a gift-card sale whose card was already used → 400, sale not voided', vg2.status === 400 && vg2.body.code === 'GIFT_CARD_USED' && s2 !== 'void', `${vg2.status} ${s2}`)
    })

    // ---------- 7. loyalty redemption
    await step('loyalty', async () => {
      await admin.query(`INSERT INTO loyalty_programs (tenant_id, name, collection_factor, conversion_factor, status) VALUES ($1,'Points',0,1,'active')`, [f.tenantId])
      await admin.query(`UPDATE customers SET loyalty_points = 50 WHERE id=$1`, [f.customerId])
      const tooMany = await sale(f, {
        customerId: f.customerId,
        cartItems: [{ itemId: B, name: 'Sugar', quantity: 1, unitPrice: 300 }],
        paymentMethod: 'cash', subtotal: 300, total: 200, amountPaid: 200, loyaltyPointsRedeemed: 100,
      })
      check('redeeming 100 points with only 50 → 400', tooMany.status === 400, short(tooMany.body))
      const ok = await sale(f, {
        customerId: f.customerId,
        cartItems: [{ itemId: B, name: 'Sugar', quantity: 1, unitPrice: 300 }],
        paymentMethod: 'cash', subtotal: 300, total: 260, amountPaid: 260, loyaltyPointsRedeemed: 40,
      })
      const pts = Number((await admin.query(`SELECT loyalty_points FROM customers WHERE id=$1`, [f.customerId])).rows[0].loyalty_points)
      check('redeeming 40 points (value 40) on 300 → total 260 accepted, points 50 → 10', ok.status === 200 && pts === 10, `${short(ok.body)} pts=${pts}`)
      const wrong = await sale(f, {
        customerId: f.customerId,
        cartItems: [{ itemId: B, name: 'Sugar', quantity: 1, unitPrice: 300 }],
        paymentMethod: 'cash', subtotal: 300, total: 100, amountPaid: 100, loyaltyPointsRedeemed: 10,
      })
      check('10 points cannot knock 200 off the total → 400', wrong.status === 400, short(wrong.body))
    })

    // ---------- 8. tax: discount + tax-exempt (server-side recalculation)
    await step('tax recalculation', async () => {
      const t = await makeTenant(admin, 'tax')
      tenants.push(t.tenantId)
      setTestSession(session(t))
      const tpl = randomUUID()
      await admin.query(`INSERT INTO tax_templates (id, tenant_id, name) VALUES ($1,$2,'VAT 18')`, [tpl, t.tenantId])
      await admin.query(`INSERT INTO tax_template_items (tenant_id, tax_template_id, tax_name, rate, included_in_price) VALUES ($1,$2,'VAT',18,false)`, [t.tenantId, tpl])
      await admin.query(`INSERT INTO accounting_settings (tenant_id, default_tax_template_id, auto_post_sales) VALUES ($1,$2,false)`, [t.tenantId, tpl])
      const X = await newItem(admin, t, 'Soap', 1000, { stock: 20 })
      const r = await sale(t, {
        cartItems: [{ itemId: X, name: 'Soap', quantity: 1, unitPrice: 1000 }],
        paymentMethod: 'cash', subtotal: 1000, discount: 100, discountType: 'fixed', tax: 162, total: 1062, amountPaid: 1062,
      })
      check('10% cart discount: VAT on 900 = 162 accepted (server taxes the discounted amount)', r.status === 200 && Number(r.body.taxAmount) === 162, short(r.body))
      await admin.query(`UPDATE customers SET tax_exempt = true WHERE id=$1`, [t.customerId])
      const ex = await sale(t, {
        customerId: t.customerId,
        cartItems: [{ itemId: X, name: 'Soap', quantity: 1, unitPrice: 1000 }],
        paymentMethod: 'cash', subtotal: 1000, tax: 0, total: 1000, amountPaid: 1000,
      })
      check('tax-exempt customer: sale with tax 0 → 200', ex.status === 200 && Number(ex.body.taxAmount) === 0, short(ex.body))
      const under = await sale(t, {
        cartItems: [{ itemId: X, name: 'Soap', quantity: 1, unitPrice: 1000 }],
        paymentMethod: 'cash', subtotal: 1000, tax: 180, taxBreakdown: [{ taxName: 'VAT', rate: 18, amount: 180, includedInPrice: false }],
        total: 1000, amountPaid: 1000,
      })
      check('exclusive VAT left out of the total → 400', under.status === 400 && under.body.code === 'TOTAL_MISMATCH', short(under.body))
      setTestSession(session(f))
    })

    // ---------- 9. payments on a sale
    await step('add payment', async () => {
      const r = await sale(f, {
        customerId: f.customerId,
        cartItems: [{ itemId: B, name: 'Sugar', quantity: 1, unitPrice: 300 }],
        paymentMethod: 'credit', subtotal: 300, total: 300, amountPaid: 0,
      })
      check('credit (on-account) sale → pending', r.status === 200 && r.body.status === 'pending', short(r.body))
      const gc = await json(await addPayment(req('POST', `/api/sales/${r.body.id}/payments`, { amount: 300, method: 'gift_card' }), ctx(r.body.id)))
      check('payment recorded as "gift_card" without a card → 400', gc.status === 400, short(gc.body))
      const v = await json(await voidSale(req('PUT', `/api/sales/${r.body.id}`, { voidReason: 'ga' }), ctx(r.body.id)))
      const p = await json(await addPayment(req('POST', `/api/sales/${r.body.id}/payments`, { amount: 300, method: 'cash' }), ctx(r.body.id)))
      const st = (await admin.query(`SELECT status FROM sales WHERE id=$1`, [r.body.id])).rows[0].status
      check('payment on a voided sale → 400, sale stays void', v.status === 200 && p.status === 400 && st === 'void', `${p.status} ${st}`)

      const w = await sale(f, {
        cartItems: [{ itemId: B, name: 'Sugar', quantity: 1, unitPrice: 300 }],
        paymentMethod: 'cash', subtotal: 300, total: 300, amountPaid: 0,
      })
      const op = await json(await addPayment(req('POST', `/api/sales/${w.body.id}/payments`, { amount: 500, method: 'cash', addOverpaymentToCredit: true }), ctx(w.body.id)))
      check('walk-in overpayment "to credit" (no customer to hold it) → 400', op.status === 400, short(op.body))
    })

    // ---------- 10. shift close: credit / unpaid sales do not create a cash shortage
    await step('shift close', async () => {
      const s = await makeTenant(admin, 'shift')
      tenants.push(s.tenantId)
      setTestSession(session(s))
      const X = await newItem(admin, s, 'Tea', 500, { stock: 20 })
      const prof = randomUUID()
      await admin.query(`INSERT INTO pos_profiles (id, tenant_id, name, warehouse_id) VALUES ($1,$2,'Counter 1',$3)`, [prof, s.tenantId, s.wh])
      const open = randomUUID()
      await admin.query(`INSERT INTO pos_opening_entries (id, tenant_id, entry_number, pos_profile_id, user_id, warehouse_id, status) VALUES ($1,$2,'POS-T-1',$3,$4,$5,'open')`,
        [open, s.tenantId, prof, s.userId, s.wh])
      await admin.query(`INSERT INTO pos_opening_balances (tenant_id, opening_entry_id, payment_method, opening_amount) VALUES ($1,$2,'cash',1000)`, [s.tenantId, open])
      await admin.query(`UPDATE customers SET balance = 200 WHERE id=$1`, [s.customerId])
      const base = { posOpeningEntryId: open, cartItems: [{ itemId: X, name: 'Tea', quantity: 1, unitPrice: 500 }], subtotal: 500, total: 500 }
      const c1 = await sale(s, { ...base, paymentMethod: 'cash', amountPaid: 500 })
      const c2 = await sale(s, { ...base, customerId: s.customerId, paymentMethod: 'credit', amountPaid: 0 })
      const c3 = await sale(s, { ...base, customerId: s.customerId, paymentMethod: 'cash', amountPaid: 300, creditAmount: 200 })
      const c4 = await sale(s, { ...base, paymentMethod: 'cash', amountPaid: 0 })
      check('shift sales created', [c1, c2, c3, c4].every((r) => r.status === 200), [c1, c2, c3, c4].map((r) => r.status).join(','))
      const g = await json(await getShift(req('GET', `/api/pos-opening-entries/${open}`), ctx(open)))
      check('expected cash = 1000 + 500 + 300 = 1800 (unpaid sale adds nothing)', g.status === 200 && g.body.paymentMethodBreakdown.expectedAmounts.cash === 1800, short(g.body.paymentMethodBreakdown))
      const c = await json(await closeShift(req('POST', `/api/pos-opening-entries/${open}/close`, {
        actualAmounts: [{ paymentMethod: 'cash', amount: 1800 }, { paymentMethod: 'credit', amount: 0 }],
      }), ctx(open)))
      check('drawer counted exactly → close 200 with zero variance (store credit is not a drawer shortage)', c.status === 200 && c.body.summary?.totalVariance === 0, short(c.body.summary || c.body))

      // a cancelled closing of the same day is not counted again in the daily summary
      const closing = c.body.closingEntry
      if (closing) {
        await admin.query(`INSERT INTO pos_closing_entries (tenant_id, entry_number, opening_entry_id, pos_profile_id, user_id, opening_time, closing_time, total_sales, total_returns, net_sales, total_transactions, status)
          SELECT tenant_id, 'CLOSE-T-CANCELLED', opening_entry_id, pos_profile_id, user_id, opening_time, closing_time, total_sales, total_returns, net_sales, total_transactions, 'cancelled'
          FROM pos_closing_entries WHERE id=$1`, [closing.id])
      }
      const today = new Date()
      const d = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
      const ds = await json(await dailySummary(req('GET', `/api/pos-daily-summary?date=${d}`)))
      check('daily summary ignores the cancelled closing', ds.status === 200 && ds.body.totalShifts === 1, short(ds.body))
      setTestSession(session(f))
    })
  } finally {
    if (!process.env.KEEP_TEST_DATA) for (const t of tenants) await cleanup(admin, t)
    await admin.end()
    await closeAllPools().catch(() => undefined)
  }
  const passed = results.filter((r) => r.ok).length
  console.log(`\n${passed}/${results.length} checks passed`)
  process.exit(passed === results.length ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
