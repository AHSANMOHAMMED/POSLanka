/**
 * W5 alerts & reminders integration test.
 *
 *   DATABASE_URL=postgresql://postgres:poslanka@127.0.0.1:5433/poslanka_c1 \
 *   DATABASE_APP_ROLE=app_user npx tsx scripts/tests/w5-alerts.ts
 *
 * Creates two throw-away tenants, stubs the Expo push API (global fetch), drives the
 * notify pipeline, stock listener, cron functions and trigger-name normalisation, prints
 * PASS/FAIL per check and exits non-zero on failure. Test tenants are removed at the end
 * unless KEEP_TEST_DATA=1.
 */
import { Client } from 'pg'
import { randomUUID } from 'crypto'
import { sql } from 'drizzle-orm'
import { withTenant, withTenantTransaction, closeAllPools } from '@/lib/db'
import { createItem } from '@/lib/inventory/create-item'
import { applyStockChange, notifyStockDecreased, type StockChangeInput } from '@/lib/inventory/apply-stock-change'
import { deliverAlert } from '@/lib/notifications/notify'
import { handleStockDecrease } from '@/lib/notifications/stock-alerts'
import { handleReturnAlerts } from '@/lib/notifications/sales-alerts'
import { clearAlertSettingsCache, inQuietHours, localParts } from '@/lib/notifications/alert-settings'
import { runImportMaintenance, runStockAlerts, runSubscriptionReminders } from '@/lib/notifications/scheduled'
import { normalizeTriggerEvent } from '@/lib/notifications/types'
import { findTriggerTemplates } from '@/lib/notifications/auto-trigger'
import { getEntityConfig } from '@/lib/import-export/entity-config'
import { mapColumns } from '@/lib/import-export/import-utils'
import { validateImport } from '@/lib/import-export/import-validate'
import { createImportJob } from '@/lib/import-export/import-job-store'
import { runImportJob } from '@/lib/import-export/run-import-job'

const results: Array<{ name: string; ok: boolean; detail?: string }> = []
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}
async function step(name: string, fn: () => Promise<void>) {
  try {
    await fn()
  } catch (err) {
    check(name, false, err instanceof Error ? `${err.message}\n${err.stack}` : String(err))
  }
}

// ---------------------------------------------------------------- push stub
const pushCalls: Array<{ to: string; title: string }> = []
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url.includes('exp.host')) {
    const msgs = JSON.parse(String(init?.body || '[]')) as Array<{ to: string; title: string }>
    pushCalls.push(...msgs.map((m) => ({ to: m.to, title: m.title })))
    return new Response(JSON.stringify({ data: msgs.map(() => ({ status: 'ok' })) }), { status: 200 })
  }
  return realFetch(input, init)
}) as typeof fetch

interface Tenant { tenantId: string; warehouseId: string; users: Record<string, string>; tokens: Record<string, string> }

async function makeTenant(admin: Client, label: string, roles: string[]): Promise<Tenant> {
  const tenantId = randomUUID()
  const warehouseId = randomUUID()
  const slug = `w5t-${label}-${tenantId.slice(0, 8)}`
  await admin.query(`INSERT INTO tenants (id, name, slug, email) VALUES ($1, $2, $3, $4)`, [tenantId, `W5 test ${label}`, slug, `${slug}@example.test`])
  await admin.query(`INSERT INTO warehouses (id, tenant_id, name, code, is_default) VALUES ($1, $2, 'Main', 'MAIN', true)`, [warehouseId, tenantId])
  const users: Record<string, string> = {}
  const tokens: Record<string, string> = {}
  for (const role of roles) {
    const id = randomUUID()
    users[role] = id
    tokens[role] = `ExponentPushToken[w5-${label}-${role}-${id.slice(0, 6)}]`
    await admin.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, 'x', $4, $5)`,
      [id, tenantId, `${role}-${slug}@example.test`, `${role} ${label}`, role])
    await admin.query(`INSERT INTO user_devices (tenant_id, user_id, push_token, platform) VALUES ($1, $2, $3, 'android')`, [tenantId, id, tokens[role]])
  }
  return { tenantId, warehouseId, users, tokens }
}

async function q<T = Record<string, unknown>>(admin: Client, text: string, params: unknown[] = []): Promise<T[]> {
  return (await admin.query(text, params)).rows as T[]
}
async function countInApp(admin: Client, tenantId: string, type: string, userId?: string): Promise<number> {
  const r = await q<{ n: number }>(admin, `SELECT count(*)::int n FROM in_app_notifications WHERE tenant_id=$1 AND type=$2 ${userId ? 'AND user_id=$3' : ''}`,
    userId ? [tenantId, type, userId] : [tenantId, type])
  return r[0].n
}
async function waitFor(fn: () => Promise<boolean>, ms = 4000): Promise<boolean> {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (await fn()) return true
    await new Promise((r) => setTimeout(r, 100))
  }
  return false
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
  const admin = new Client({ connectionString: process.env.DATABASE_URL })
  await admin.connect()
  const A = await makeTenant(admin, 'a', ['owner', 'manager', 'stock_manager', 'cashier'])
  const B = await makeTenant(admin, 'b', ['owner'])
  let accountId: string | null = null

  const newItem = (name: string) => withTenantTransaction(A.tenantId, async (tx) => (await createItem(tx, {
    tenantId: A.tenantId, userId: A.users.owner, source: 'manual', data: { name, sellingPrice: '100', costPrice: '50' },
  })).item)
  const change = async (itemId: string, qty: number) => {
    const input: StockChangeInput = {
      tenantId: A.tenantId, warehouseId: A.warehouseId, itemId, mode: 'delta', qty,
      referenceType: 'test', source: 'system', userId: A.users.owner,
    }
    const result = await withTenantTransaction(A.tenantId, (tx) => applyStockChange(tx, input))
    return { result, input }
  }

  try {
    // ------------------------------------------------------------ 1. low stock via the registered listener
    let itemId = ''
    await step('low_stock listener', async () => {
      const item = await newItem('Anchor Milk 400g')
      itemId = item.id
      await change(itemId, 10)
      await admin.query(`UPDATE warehouse_stock SET min_stock = 5 WHERE tenant_id=$1 AND item_id=$2`, [A.tenantId, itemId])
      pushCalls.length = 0
      const c = await change(itemId, -6) // 10 → 4 crosses min 5
      check('applyStockChange reports crossedMin', c.result.crossedMin === true)
      notifyStockDecreased([c])
      const ok = await waitFor(async () => (await countInApp(admin, A.tenantId, 'low_stock')) >= 3)
      const rows = await q<{ user_id: string }>(admin, `SELECT user_id FROM in_app_notifications WHERE tenant_id=$1 AND type='low_stock'`, [A.tenantId])
      const got = new Set(rows.map((r) => r.user_id))
      check('listener fired: low_stock stored for manageInventory holders', ok && rows.length === 3
        && got.has(A.users.owner) && got.has(A.users.manager) && got.has(A.users.stock_manager), `rows=${rows.length}`)
      check('cashier (no manageInventory) not notified', !got.has(A.users.cashier))
      await waitFor(async () => pushCalls.length >= 3, 2000)
      const tos = new Set(pushCalls.map((p) => p.to))
      check('push sent to recipients only (not cashier, not tenant B)',
        tos.has(A.tokens.stock_manager) && !tos.has(A.tokens.cashier) && !tos.has(B.tokens.owner), [...tos].join(','))

      // back above min and down again the same day → de-duplicated
      await change(itemId, 6)
      const again = await change(itemId, -6)
      const out = await handleStockDecrease(again.result, again.input)
      check('second crossing within 24h is de-duplicated', out?.skipped === 'deduped', JSON.stringify(out))
      check('still exactly 3 low_stock rows', (await countInApp(admin, A.tenantId, 'low_stock')) === 3)
    })

    // ------------------------------------------------------------ 2. out of stock
    await step('out_of_stock', async () => {
      const c = await change(itemId, -4) // 4 → 0
      const out = await handleStockDecrease(c.result, c.input)
      check('out_of_stock fires at 0', !!out && !out.skipped && out.inApp.length === 3, JSON.stringify(out?.inApp))
      await change(itemId, 2)
      const c2 = await change(itemId, -2)
      const out2 = await handleStockDecrease(c2.result, c2.input)
      check('out_of_stock de-duplicated within 12h', out2?.skipped === 'deduped')
    })

    // ------------------------------------------------------------ 3. tenant defaultMinStock
    await step('defaultMinStock', async () => {
      const item = await newItem('Sunlight Soap')
      await change(item.id, 5)
      const before = await handleStockDecrease((await change(item.id, -3)).result, { tenantId: A.tenantId, warehouseId: A.warehouseId, itemId: item.id, mode: 'delta', qty: -3, referenceType: 'test', source: 'system' })
      check('no alert without minimum configured', before === null)
      await admin.query(`UPDATE tenants SET settings = jsonb_set(COALESCE(settings,'{}'::jsonb), '{alerts}', '{"defaultMinStock": 3, "largeRefundAmount": 1000}'::jsonb) WHERE id=$1`, [A.tenantId])
      clearAlertSettingsCache()
      await change(item.id, 3) // 2 → 5
      const c = await change(item.id, -3) // 5 → 2 crosses default 3
      const out = await handleStockDecrease(c.result, c.input)
      check('tenant defaultMinStock used when branch minimum is 0', !!out && !out.skipped && out.inApp.length === 3, JSON.stringify(out))
    })

    // ------------------------------------------------------------ 4. muted type + quiet hours
    await step('preferences', async () => {
      await admin.query(`INSERT INTO notification_preferences (user_id, tenant_id, muted_types) VALUES ($1, $2, '{large_refund}')`, [A.users.owner, A.tenantId])
      const local = localParts(new Date(), 'Asia/Colombo')
      const pad = (h: number) => `${String((h + 24) % 24).padStart(2, '0')}:00`
      await admin.query(`INSERT INTO notification_preferences (user_id, tenant_id, quiet_start, quiet_end, timezone) VALUES ($1, $2, $3, $4, 'Asia/Colombo')`,
        [A.users.manager, A.tenantId, pad(local.hour - 1), pad(local.hour + 1)])
      check('inQuietHours helper', inQuietHours({ quietStart: '22:00', quietEnd: '06:00' }, new Date('2026-01-01T20:00:00Z'), 'Asia/Colombo') // 01:30 local
        && !inQuietHours({ quietStart: '22:00', quietEnd: '06:00' }, new Date('2026-01-01T06:30:00Z'), 'Asia/Colombo')) // 12:00 local

      pushCalls.length = 0
      const outs = await handleReturnAlerts(A.tenantId, {
        returnId: randomUUID(), returnNo: 'RTN-T1', manual: true, refundTotal: 1500, actorUserId: A.users.cashier, actorName: 'Cashier',
      })
      const [large, manual] = outs
      check('large_refund + manual_return both raised', outs.length === 2)
      check('muted type (owner/large_refund) not delivered', !!large && !large.inApp.includes(A.users.owner) && large.recipients.includes(A.users.owner))
      check('owner still receives non-muted manual_return', !!manual && manual.inApp.includes(A.users.owner))
      check('quiet hours: manager gets in-app but no push', !!manual && manual.inApp.includes(A.users.manager) && !manual.pushed.includes(A.users.manager))
      check('quiet hours: no push call for manager token', !pushCalls.some((p) => p.to === A.tokens.manager) && pushCalls.some((p) => p.to === A.tokens.owner))
      check('actor excluded from return alerts', !!manual && !manual.recipients.includes(A.users.cashier))
    })

    // ------------------------------------------------------------ 5. recipients isolation
    await step('isolation', async () => {
      const out = await deliverAlert(A.tenantId, 'sale_void', { title: 'x', body: 'y', userIds: [B.users.owner, A.users.cashier] })
      check('explicit userIds from another tenant are ignored', out.recipients.length === 1 && out.recipients[0] === A.users.cashier, JSON.stringify(out.recipients))
      const out2 = await deliverAlert(A.tenantId, 'sale_void', { title: 'x', body: 'y', permission: 'manageSales' })
      check('permission recipients = manageSales holders only', out2.recipients.length === 2
        && out2.recipients.includes(A.users.owner) && out2.recipients.includes(A.users.manager), JSON.stringify(out2.recipients))
      const [{ n }] = await q<{ n: number }>(admin, `SELECT count(*)::int n FROM in_app_notifications WHERE tenant_id=$1`, [B.tenantId])
      check('tenant B received nothing', n === 0)
      const visible = await withTenant(B.tenantId, (tdb) => tdb.execute(sql`SELECT count(*)::int AS n FROM in_app_notifications`))
      check('RLS: tenant B context sees 0 inbox rows', Number((visible as unknown as { rows: { n: number }[] }).rows[0].n) === 0)
    })

    // ------------------------------------------------------------ 6. stock-alerts cron (digest + expiring)
    await step('stock-alerts cron', async () => {
      const now = new Date()
      const h = localParts(now, 'Asia/Colombo').hour
      await admin.query(`INSERT INTO notification_preferences (user_id, tenant_id, digest_hour) VALUES ($1, $2, $3)`, [A.users.stock_manager, A.tenantId, h])
      await admin.query(`UPDATE notification_preferences SET digest_hour=$3 WHERE user_id=ANY($1) AND tenant_id=$2`, [[A.users.owner, A.users.manager], A.tenantId, (h + 2) % 24])
      const exp = await newItem('Yoghurt cup')
      await change(exp.id, 4)
      await admin.query(`UPDATE items SET expiry_date = (now() AT TIME ZONE 'Asia/Colombo')::date + 3 WHERE id=$1`, [exp.id])
      const bItem = await newItem('Panadol 500mg')
      await admin.query(`INSERT INTO item_batches (tenant_id, item_id, batch_number, warehouse_id, expiry_date, initial_quantity, current_quantity, status)
        VALUES ($1, $2, 'B-001', $3, (now() AT TIME ZONE 'Asia/Colombo')::date + 5, 10, 10, 'active'),
               ($1, $2, 'B-FAR', $3, (now() AT TIME ZONE 'Asia/Colombo')::date + 60, 10, 10, 'active')`, [A.tenantId, bItem.id, A.warehouseId])

      const s = await runStockAlerts({ tenantIds: [A.tenantId], now })
      const digest = s.outcomes.find((o) => o.type === 'stock_digest')
      const expiring = s.outcomes.find((o) => o.type === 'expiring_stock')
      check('digest only for the user whose local hour == digest_hour', s.dueUsers === 1 && !!digest && digest.userId === A.users.stock_manager, JSON.stringify({ due: s.dueUsers }))
      check('digest delivered in-app', !!digest && digest.outcome.inApp.length === 1)
      const [row] = await q<{ title: string; data: { count: number; items: { name: string }[] } }>(admin,
        `SELECT title, data FROM in_app_notifications WHERE tenant_id=$1 AND type='stock_digest'`, [A.tenantId])
      check('digest lists the low items', !!row && row.data.count >= 2 && row.data.items.some((i) => i.name === 'Sunlight Soap'), row?.title)
      const [er] = await q<{ data: { items: { name: string; batchNumber: string | null }[] } }>(admin,
        `SELECT data FROM in_app_notifications WHERE tenant_id=$1 AND type='expiring_stock'`, [A.tenantId])
      const names = (er?.data.items || []).map((i) => `${i.name}:${i.batchNumber || ''}`)
      check('expiring_stock selects item + near batch, not the far batch', !!expiring && names.includes('Yoghurt cup:') && names.includes('Panadol 500mg:B-001') && !names.includes('Panadol 500mg:B-FAR'), names.join(','))
      const s2 = await runStockAlerts({ tenantIds: [A.tenantId], now })
      check('second run the same day is de-duplicated', s2.outcomes.every((o) => o.outcome.skipped === 'deduped'), JSON.stringify(s2.outcomes.map((o) => o.outcome.skipped)))
    })

    // ------------------------------------------------------------ 7. subscription reminders
    await step('subscription reminders', async () => {
      const [acc] = await q<{ id: string }>(admin, `INSERT INTO accounts (email, password_hash, full_name, phone) VALUES ($1, 'x', 'W5 Owner', '0770000000') RETURNING id`, [`w5-${A.tenantId.slice(0, 8)}@example.test`])
      accountId = acc.id
      const [tier] = await q<{ id: string }>(admin, `SELECT id FROM pricing_tiers ORDER BY created_at LIMIT 1`)
      const now = new Date()
      await admin.query(`INSERT INTO subscriptions (tenant_id, billing_account_id, tier_id, status, trial_ends_at) VALUES ($1, $2, $3, 'trial', $4)`,
        [A.tenantId, accountId, tier.id, new Date(now.getTime() + 6.5 * 86400000)])
      const s7 = await runSubscriptionReminders({ tenantIds: [A.tenantId], now })
      check('7-day reminder to owner', s7.sent.length === 1 && s7.sent[0].daysLeft === 7 && s7.sent[0].outcome.inApp.length === 1
        && s7.sent[0].outcome.inApp[0] === A.users.owner, JSON.stringify(s7.sent.map((x) => [x.daysLeft, x.outcome.inApp])))
      const again = await runSubscriptionReminders({ tenantIds: [A.tenantId], now })
      check('7-day reminder not repeated', again.sent.every((x) => x.outcome.skipped === 'deduped'))
      await admin.query(`UPDATE subscriptions SET trial_ends_at=$2 WHERE tenant_id=$1`, [A.tenantId, new Date(now.getTime() + 0.5 * 86400000)])
      const s1 = await runSubscriptionReminders({ tenantIds: [A.tenantId], now })
      check('1-day reminder', s1.sent.length === 1 && s1.sent[0].daysLeft === 1 && !s1.sent[0].outcome.skipped)
      await admin.query(`UPDATE subscriptions SET trial_ends_at=$2 WHERE tenant_id=$1`, [A.tenantId, new Date(now.getTime() + 3 * 86400000)])
      const s3 = await runSubscriptionReminders({ tenantIds: [A.tenantId], now })
      check('no reminder at 3 days', s3.sent.length === 0)
    })

    // ------------------------------------------------------------ 8. import maintenance
    await step('import maintenance', async () => {
      const cfg = getEntityConfig('items')!
      const raw = Array.from({ length: 5 }, (_, i) => ({ Name: `W5 import ${i}`, SKU: `W5-${i}`, 'Selling Price': '10' }))
      const mapping = mapColumns(Object.keys(raw[0]), cfg)
      const v = await withTenant(A.tenantId, (db) => validateImport(db, {
        tenantId: A.tenantId, entityConfig: cfg, rawRows: raw, columnMapping: mapping, mode: 'insert', options: {},
      }))
      const created = await createImportJob({
        tenantId: A.tenantId, userId: A.users.owner, entityName: 'items', mode: 'insert',
        options: { matchBy: v.matchBy, headers: Object.keys(raw[0]), columnMapping: mapping, blankPolicy: 'keep' },
        fileName: 'w5.csv', fileHash: randomUUID().replace(/-/g, ''), rows: v.rows,
      })
      if (!created.ok) throw new Error('job conflict')
      const jobId = created.job.id
      await runImportJob({ jobId, tenantId: A.tenantId, maxChunks: 1, chunkSize: 2 }) // "crash" after 2 rows
      await admin.query(`UPDATE import_jobs SET heartbeat_at = now() - interval '10 minutes' WHERE id=$1`, [jobId])
      const [mid] = await q<{ status: string; processed: number }>(admin, `SELECT status, processed FROM import_jobs WHERE id=$1`, [jobId])
      check('job interrupted mid-way', mid.status === 'processing' && mid.processed === 2, JSON.stringify(mid))

      // an old finished job → removed by retention
      const [old] = await q<{ id: string }>(admin, `INSERT INTO import_jobs (tenant_id, user_id, entity_name, status, completed_at, created_at)
        VALUES ($1, $2, 'items', 'done', now() - interval '40 days', now() - interval '41 days') RETURNING id`, [A.tenantId, A.users.owner])
      await admin.query(`INSERT INTO import_job_rows (job_id, tenant_id, row_index, status) VALUES ($1, $2, 1, 'done')`, [old.id, A.tenantId])
      const [recent] = await q<{ id: string }>(admin, `INSERT INTO import_jobs (tenant_id, user_id, entity_name, status, completed_at)
        VALUES ($1, $2, 'items', 'done', now() - interval '5 days') RETURNING id`, [A.tenantId, A.users.owner])

      const s = await runImportMaintenance({ tenantIds: [A.tenantId], awaitRuns: true })
      const [after] = await q<{ status: string; processed: number; inserted: number }>(admin, `SELECT status, processed, inserted FROM import_jobs WHERE id=$1`, [jobId])
      check('interrupted job resumed to done', s.resumed.includes(jobId) && after.status === 'done' && after.processed === 5 && after.inserted === 5, JSON.stringify(after))
      const [{ n }] = await q<{ n: number }>(admin, `SELECT count(*)::int n FROM items WHERE tenant_id=$1 AND sku LIKE 'W5-%'`, [A.tenantId])
      check('all 5 items imported exactly once', n === 5)
      check('import_finished in-app for the job owner', (await countInApp(admin, A.tenantId, 'import_finished', A.users.owner)) === 1)
      const left = await q(admin, `SELECT id FROM import_jobs WHERE id = ANY($1)`, [[old.id, recent.id]])
      const leftRows = await q(admin, `SELECT 1 FROM import_job_rows WHERE job_id=$1`, [old.id])
      check('job finished > 30 days ago deleted (rows too), recent kept', s.deletedJobs === 1 && left.length === 1 && leftRows.length === 0, JSON.stringify(s))
    })

    // ------------------------------------------------------------ 9. template trigger names
    await step('trigger names', async () => {
      check('normalize dotted → underscore', normalizeTriggerEvent('work_order.completed') === 'work_order_completed'
        && normalizeTriggerEvent('appointment.confirmed') === 'appointment_confirmed'
        && normalizeTriggerEvent('estimate.approved') === 'estimate_approved')
      check('normalize alias work_order.invoice_created → work_order_invoiced', normalizeTriggerEvent('work_order.invoice_created') === 'work_order_invoiced')
      check('canonical unchanged / empty → null', normalizeTriggerEvent('sale_completed') === 'sale_completed' && normalizeTriggerEvent('') === null)
      await admin.query(`INSERT INTO notification_templates (tenant_id, name, channel, trigger_event, is_auto_trigger, sms_content, is_active)
        VALUES ($1, 'legacy', 'sms', 'work_order.completed', true, 'Done', true),
               ($1, 'canonical', 'sms', 'work_order_completed', true, 'Done', true),
               ($1, 'invoice', 'sms', 'work_order.invoice_created', true, 'Inv', true),
               ($1, 'inactive', 'sms', 'work_order_completed', true, 'x', false)`, [A.tenantId])
      const t1 = await findTriggerTemplates(A.tenantId, 'work_order_completed')
      check('legacy dotted + canonical templates both match the fired event', t1.length === 2, t1.map((t) => t.name).join(','))
      const t2 = await findTriggerTemplates(A.tenantId, 'work_order_invoiced')
      check('work_order.invoice_created template matches work_order_invoiced', t2.length === 1 && t2[0].name === 'invoice')
      const t3 = await findTriggerTemplates(B.tenantId, 'work_order_completed')
      check('templates are tenant-isolated', t3.length === 0)
    })
  } finally {
    if (process.env.KEEP_TEST_DATA !== '1') {
      await admin.query(`SET session_replication_role = replica`)
      const tables = await q<{ table_name: string }>(admin, `SELECT table_name FROM information_schema.columns
        WHERE table_schema='public' AND column_name='tenant_id' AND table_name IN (SELECT tablename FROM pg_tables WHERE schemaname='public')`)
      for (const t of [A.tenantId, B.tenantId]) {
        for (const { table_name } of tables) {
          await admin.query(`DELETE FROM "${table_name}" WHERE tenant_id=$1`, [t]).catch(() => undefined)
        }
        await admin.query(`DELETE FROM tenants WHERE id=$1`, [t]).catch((e) => console.warn('cleanup tenant:', e.message))
      }
      if (accountId) await admin.query(`DELETE FROM accounts WHERE id=$1`, [accountId]).catch(() => undefined)
      await admin.query(`SET session_replication_role = DEFAULT`)
    }
    await admin.end()
    await closeAllPools()
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  process.exit(failed.length ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(2)
})
