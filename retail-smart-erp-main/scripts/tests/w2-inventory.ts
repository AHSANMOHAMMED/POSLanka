/**
 * W2 inventory core integration test.
 *
 *   DATABASE_URL=postgresql://postgres:poslanka@127.0.0.1:5433/poslanka_w2 \
 *   DATABASE_APP_ROLE=app_user npx tsx scripts/tests/w2-inventory.ts
 *
 * Creates two throw-away tenants (as the connecting superuser), runs every
 * check through the RLS-enforced tenant helpers, prints PASS/FAIL per check and
 * exits non-zero on any failure. Test tenants are removed at the end unless
 * KEEP_TEST_DATA=1.
 */
import { Client } from 'pg'
import { randomUUID } from 'crypto'
import { sql } from 'drizzle-orm'
import { withTenantTransaction, closeAllPools } from '@/lib/db'
import { createItem } from '@/lib/inventory/create-item'
import { applyStockChange } from '@/lib/inventory/apply-stock-change'
import { nextDocumentNumber } from '@/lib/inventory/item-codes'
import { completeStockTake } from '@/lib/inventory/complete-stock-take'
import { getItemHistory } from '@/lib/inventory/item-history'
import { recordItemChange } from '@/lib/inventory/item-audit'
import { DuplicateError } from '@/lib/db/errors'
import { stockAuditModule } from '@/lib/audit/stock-audit'

const results: Array<{ name: string; ok: boolean; detail?: string }> = []

function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

async function step(name: string, fn: () => Promise<void>) {
  try {
    await fn()
  } catch (err) {
    check(name, false, err instanceof Error ? `${err.message}` : String(err))
  }
}

interface Fixture { tenantId: string; warehouseId: string; userId: string }

async function makeTenant(admin: Client, label: string): Promise<Fixture> {
  const tenantId = randomUUID()
  const warehouseId = randomUUID()
  const userId = randomUUID()
  const slug = `w2t-${label}-${tenantId.slice(0, 8)}`
  await admin.query(`INSERT INTO tenants (id, name, slug, email) VALUES ($1, $2, $3, $4)`,
    [tenantId, `W2 test ${label}`, slug, `${slug}@example.test`])
  await admin.query(`INSERT INTO warehouses (id, tenant_id, name, code, is_default) VALUES ($1, $2, 'Main', 'MAIN', true)`,
    [warehouseId, tenantId])
  await admin.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, 'x', 'Nimal Perera', 'owner')`,
    [userId, tenantId, `owner-${slug}@example.test`])
  return { tenantId, warehouseId, userId }
}

async function stockOf(admin: Client, f: Fixture, itemId: string): Promise<number> {
  const r = await admin.query(`SELECT current_stock FROM warehouse_stock WHERE warehouse_id=$1 AND item_id=$2`, [f.warehouseId, itemId])
  return r.rows[0] ? Number(r.rows[0].current_stock) : 0
}

async function newItem(f: Fixture, name: string, extra: Record<string, unknown> = {}) {
  return withTenantTransaction(f.tenantId, async (tx) => {
    const { item } = await createItem(tx, {
      tenantId: f.tenantId, userId: f.userId, source: 'manual',
      data: { name, sellingPrice: '100', costPrice: '0', ...extra },
    })
    return item
  })
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
  const admin = new Client({ connectionString: process.env.DATABASE_URL })
  await admin.connect()

  const A = await makeTenant(admin, 'a')
  const B = await makeTenant(admin, 'b')

  try {
    // 1. 50 parallel createItem → 50 distinct item codes and barcodes
    await step('parallel createItem: distinct codes/barcodes', async () => {
      const created = await Promise.all(Array.from({ length: 50 }, (_, i) => newItem(A, `Parallel item ${i}`)))
      const codes = new Set(created.map((c) => c.itemCode))
      const barcodes = new Set(created.map((c) => c.barcode))
      const sortedCodes = [...codes].sort()
      check('parallel createItem: 50 distinct item codes', codes.size === 50, `${sortedCodes[0]}..${sortedCodes[49]}`)
      check('parallel createItem: 50 distinct barcodes', barcodes.size === 50)
      check('parallel createItem: codes contiguous ITM-000001..ITM-000050',
        sortedCodes[0] === 'ITM-000001' && sortedCodes[49] === 'ITM-000050')
      check('parallel createItem: generated barcodes are valid 13-digit EAN',
        created.every((c) => /^2\d{12}$/.test(c.barcode || '')))
      const log = await admin.query(`SELECT count(*)::int AS n FROM item_change_log WHERE tenant_id=$1 AND action='create'`, [A.tenantId])
      check('createItem writes item_change_log create rows', log.rows[0].n === 50, `rows=${log.rows[0].n}`)
    })

    // 2. same user barcode twice in parallel → one success, one DuplicateError
    await step('duplicate user barcode', async () => {
      const outcomes = await Promise.allSettled([
        newItem(A, 'Dup barcode 1', { barcode: '4791234567890' }),
        newItem(A, 'Dup barcode 2', { barcode: '4791234567890' }),
      ])
      const ok = outcomes.filter((o) => o.status === 'fulfilled').length
      const dup = outcomes.filter((o) => o.status === 'rejected' && o.reason instanceof DuplicateError && o.reason.field === 'barcode')
      const rej = dup[0] as PromiseRejectedResult | undefined
      check('duplicate user barcode: one success + one DuplicateError(barcode)', ok === 1 && dup.length === 1,
        rej ? `existingId=${(rej.reason as DuplicateError).existingId}` : JSON.stringify(outcomes.map((o) => o.status)))
      const skuDup = await Promise.allSettled([
        newItem(A, 'Sku 1', { sku: 'SKU-W2-1' }),
        newItem(A, 'Sku 2', { sku: 'SKU-W2-1' }),
      ])
      check('duplicate user sku: DuplicateError(sku)',
        skuDup.some((o) => o.status === 'rejected' && o.reason instanceof DuplicateError && o.reason.field === 'sku'))
    })

    // 3. applyStockChange signs/before/after for delta and set + negative policy
    await step('applyStockChange', async () => {
      const item = await newItem(A, 'Ledger item')
      const r1 = await withTenantTransaction(A.tenantId, (tx) => applyStockChange(tx, {
        tenantId: A.tenantId, warehouseId: A.warehouseId, itemId: item.id, mode: 'delta', qty: 10,
        referenceType: 'test', source: 'system', userId: A.userId,
      }))
      const r2 = await withTenantTransaction(A.tenantId, (tx) => applyStockChange(tx, {
        tenantId: A.tenantId, warehouseId: A.warehouseId, itemId: item.id, mode: 'delta', qty: -3,
        referenceType: 'test', source: 'system', userId: A.userId,
      }))
      const r3 = await withTenantTransaction(A.tenantId, (tx) => applyStockChange(tx, {
        tenantId: A.tenantId, warehouseId: A.warehouseId, itemId: item.id, mode: 'set', qty: 5,
        referenceType: 'test', source: 'system', userId: A.userId,
      }))
      check('delta +10: 0 → 10', r1.before === 0 && r1.after === 10 && r1.delta === 10, JSON.stringify([r1.before, r1.after, r1.delta]))
      check('delta -3: 10 → 7', r2.before === 10 && r2.after === 7 && r2.delta === -3)
      check('set 5: 7 → 5 (delta -2)', r3.before === 7 && r3.after === 5 && r3.delta === -2)
      const mv = await admin.query(
        `SELECT type, quantity::float AS q, qty_change::float AS c, stock_before::float AS b, stock_after::float AS a
         FROM stock_movements WHERE item_id=$1 ORDER BY created_at, stock_before DESC`, [item.id])
      const sig = mv.rows.map((r) => `${r.type}:${r.q}:${r.c}:${r.b}->${r.a}`).join(' ')
      check('ledger rows signed (in +10, out -3, adjustment -2; quantity unsigned)',
        sig === 'in:10:10:0->10 out:3:-3:10->7 adjustment:2:-2:7->5', sig)
      let insufficient = ''
      try {
        await withTenantTransaction(A.tenantId, (tx) => applyStockChange(tx, {
          tenantId: A.tenantId, warehouseId: A.warehouseId, itemId: item.id, mode: 'delta', qty: -100,
          referenceType: 'test', source: 'system',
        }))
      } catch (e) { insufficient = e instanceof Error ? e.message : '' }
      check('negative stock blocked with INSUFFICIENT_STOCK', insufficient.startsWith('INSUFFICIENT_STOCK:Ledger item'), insufficient)
      check('stock unchanged after rejected change', await stockOf(admin, A, item.id) === 5)

      // 4. idempotency replay
      const key = `test:${randomUUID()}`
      const i1 = await withTenantTransaction(A.tenantId, (tx) => applyStockChange(tx, {
        tenantId: A.tenantId, warehouseId: A.warehouseId, itemId: item.id, mode: 'delta', qty: 2,
        referenceType: 'test', source: 'system', idempotencyKey: key,
      }))
      const i2 = await withTenantTransaction(A.tenantId, (tx) => applyStockChange(tx, {
        tenantId: A.tenantId, warehouseId: A.warehouseId, itemId: item.id, mode: 'delta', qty: 2,
        referenceType: 'test', source: 'system', idempotencyKey: key,
      }))
      check('idempotency: replay returns skipped with original movement',
        !i1.skipped && i2.skipped && i2.movementId === i1.movementId)
      check('idempotency: stock applied once (5 + 2 = 7)', await stockOf(admin, A, item.id) === 7)
      const par = await Promise.all(Array.from({ length: 5 }, () => withTenantTransaction(A.tenantId, (tx) => applyStockChange(tx, {
        tenantId: A.tenantId, warehouseId: A.warehouseId, itemId: item.id, mode: 'delta', qty: 1,
        referenceType: 'test', source: 'system', idempotencyKey: `${key}:par`,
      }))))
      check('idempotency: 5 parallel same-key calls apply once',
        par.filter((p) => !p.skipped).length === 1 && await stockOf(admin, A, item.id) === 8)
    })

    // 5. stock take is relative: sales during the count are preserved
    await step('stock take relative completion', async () => {
      const itemSame = await newItem(A, 'Count same')
      const itemShort = await newItem(A, 'Count short')
      for (const it of [itemSame, itemShort]) {
        await withTenantTransaction(A.tenantId, (tx) => applyStockChange(tx, {
          tenantId: A.tenantId, warehouseId: A.warehouseId, itemId: it.id, mode: 'delta', qty: 10,
          referenceType: 'purchase', source: 'system',
        }))
      }
      const stId = randomUUID()
      await admin.query(`INSERT INTO stock_takes (id, tenant_id, count_no, warehouse_id, status) VALUES ($1,$2,'SC-W2-1',$3,'in_progress')`,
        [stId, A.tenantId, A.warehouseId])
      const lineSame = randomUUID(); const lineShort = randomUUID()
      // Counts entered while system stock is 10: same=10 (no variance), short=8 (2 missing)
      await admin.query(
        `INSERT INTO stock_take_items (id, tenant_id, stock_take_id, item_id, item_name, expected_quantity, counted_quantity, system_qty_at_count, variance, cost_price)
         VALUES ($1,$3,$4,$5,'Count same',10,10,10,0,0), ($2,$3,$4,$6,'Count short',10,8,10,-2,0)`,
        [lineSame, lineShort, A.tenantId, stId, itemSame.id, itemShort.id])
      // A sale of 3 of each happens after counting, before completion
      for (const it of [itemSame, itemShort]) {
        await withTenantTransaction(A.tenantId, (tx) => applyStockChange(tx, {
          tenantId: A.tenantId, warehouseId: A.warehouseId, itemId: it.id, mode: 'delta', qty: -3,
          referenceType: 'sale', source: 'pos',
        }))
      }
      const done = await withTenantTransaction(A.tenantId, (tx) => completeStockTake(tx, {
        tenantId: A.tenantId, stockTakeId: stId, userId: A.userId,
      }))
      const same = await stockOf(admin, A, itemSame.id)
      const short = await stockOf(admin, A, itemShort.id)
      check('stock take: counted 10 / system 10, sale 3 → stock 7 (sale preserved)', same === 7, `got ${same}`)
      check('stock take: counted 8 / system 10, sale 3 → stock 5 (7 + (8-10))', short === 5, `got ${short}`)
      check('stock take: one adjustment applied', done.adjustmentCount === 1)
      const st = await admin.query(`SELECT status FROM stock_takes WHERE id=$1`, [stId])
      const lines = await admin.query(`SELECT count(*)::int AS n FROM stock_take_items WHERE stock_take_id=$1 AND applied_at IS NOT NULL`, [stId])
      check('stock take: status completed and lines marked applied', st.rows[0].status === 'completed' && lines.rows[0].n === 2)
      let again = ''
      try {
        await withTenantTransaction(A.tenantId, (tx) => completeStockTake(tx, { tenantId: A.tenantId, stockTakeId: stId, userId: A.userId }))
      } catch (e) { again = e instanceof Error ? e.message : '' }
      check('stock take: cannot complete twice', again.includes('Cannot complete') && await stockOf(admin, A, itemShort.id) === 5)
    })

    // 6. concurrent applyStockChange on the same row
    await step('concurrent decrements', async () => {
      const item = await newItem(A, 'Hot item')
      await withTenantTransaction(A.tenantId, (tx) => applyStockChange(tx, {
        tenantId: A.tenantId, warehouseId: A.warehouseId, itemId: item.id, mode: 'delta', qty: 20,
        referenceType: 'purchase', source: 'system',
      }))
      const res = await Promise.allSettled(Array.from({ length: 20 }, () => withTenantTransaction(A.tenantId, (tx) => applyStockChange(tx, {
        tenantId: A.tenantId, warehouseId: A.warehouseId, itemId: item.id, mode: 'delta', qty: -1,
        referenceType: 'sale', source: 'pos',
      }))))
      const fulfilled = res.filter((r) => r.status === 'fulfilled').length
      const stock = await stockOf(admin, A, item.id)
      check('20 parallel -1 on stock 20 → exactly 0', fulfilled === 20 && stock === 0, `ok=${fulfilled} stock=${stock}`)
      const chain = await admin.query(
        `SELECT stock_before::float AS b, stock_after::float AS a FROM stock_movements
         WHERE item_id=$1 AND qty_change < 0 ORDER BY stock_before DESC`, [item.id])
      const contiguous = chain.rows.length === 20 && chain.rows.every((r, i) => r.b === 20 - i && r.a === 19 - i)
      check('ledger before/after chain is contiguous 20→0', contiguous)
      const extra = await withTenantTransaction(A.tenantId, (tx) => applyStockChange(tx, {
        tenantId: A.tenantId, warehouseId: A.warehouseId, itemId: item.id, mode: 'delta', qty: -1,
        referenceType: 'sale', source: 'pos',
      })).then(() => 'ok', (e: Error) => e.message)
      check('21st decrement rejected (no negative stock)', extra.startsWith('INSUFFICIENT_STOCK'))
    })

    // 7. nextDocumentNumber: two tenants in parallel, continuous independent sequences
    await step('document numbers', async () => {
      const calls = [] as Array<Promise<{ t: string; no: string }>>
      for (let i = 0; i < 20; i++) {
        for (const f of [A, B]) {
          calls.push(withTenantTransaction(f.tenantId, async (tx) => ({
            t: f.tenantId, no: await nextDocumentNumber(tx, f.tenantId, 'invoice'),
          })))
        }
      }
      const out = await Promise.all(calls)
      const seq = (t: string) => out.filter((o) => o.t === t).map((o) => o.no).sort()
      const expected = Array.from({ length: 20 }, (_, i) => `INV-${String(i + 1).padStart(6, '0')}`)
      check('tenant A invoices INV-000001..INV-000020', JSON.stringify(seq(A.tenantId)) === JSON.stringify(expected))
      check('tenant B invoices INV-000001..INV-000020 (independent)', JSON.stringify(seq(B.tenantId)) === JSON.stringify(expected))
      const ret = await withTenantTransaction(B.tenantId, (tx) => nextDocumentNumber(tx, B.tenantId, 'return'))
      check('returns use their own sequence (RTN-000001)', ret === 'RTN-000001', ret)
      // rollback does not burn a number permanently? (it does not: the upsert is rolled back)
      await withTenantTransaction(B.tenantId, async (tx) => {
        await nextDocumentNumber(tx, B.tenantId, 'invoice')
        throw new Error('rollback')
      }).catch(() => undefined)
      const after = await withTenantTransaction(B.tenantId, (tx) => nextDocumentNumber(tx, B.tenantId, 'invoice'))
      check('rolled-back allocation is reused (no gap)', after === 'INV-000021', after)
    })

    // 8. history merges stock + field changes with users
    await step('item history', async () => {
      const item = await newItem(A, 'History item')
      await withTenantTransaction(A.tenantId, async (tx) => {
        await applyStockChange(tx, {
          tenantId: A.tenantId, warehouseId: A.warehouseId, itemId: item.id, mode: 'delta', qty: 4,
          referenceType: 'purchase', source: 'manual', userId: A.userId,
        })
        await recordItemChange(tx, {
          tenantId: A.tenantId, itemId: item.id, userId: A.userId, source: 'manual', action: 'update',
          before: { sellingPrice: '100' }, after: { sellingPrice: '120' },
        })
        const noop = await recordItemChange(tx, {
          tenantId: A.tenantId, itemId: item.id, userId: A.userId, source: 'manual', action: 'update',
          before: { sellingPrice: '120', name: 'x' }, after: { sellingPrice: '120.00', name: 'x' },
        })
        check('recordItemChange skips no-op updates', noop === null)
      })
      const page1 = await withTenantTransaction(A.tenantId, (tx) => getItemHistory(tx, { itemId: item.id, kind: 'all', limit: 2 }))
      const page2 = await withTenantTransaction(A.tenantId, (tx) => getItemHistory(tx, { itemId: item.id, kind: 'all', limit: 2, cursor: page1.nextCursor || undefined }))
      const kinds = [...page1.data, ...page2.data].map((e) => e.kind).sort().join(',')
      check('history: 3 entries across 2 pages (create, stock, price)', kinds === 'fields,price,stock' && !page2.nextCursor, kinds)
      const price = [...page1.data, ...page2.data].find((e) => e.kind === 'price')
      check('history: price change shows 100 → 120 by user',
        !!price && 'changes' in price && (price.changes.sellingPrice?.from === 100) && price.changes.sellingPrice?.to === 120 && price.user?.name === 'Nimal Perera')
      const stockOnly = await withTenantTransaction(A.tenantId, (tx) => getItemHistory(tx, { itemId: item.id, kind: 'stock', limit: 10 }))
      const s0 = stockOnly.data[0]
      check('history: stock entry has before → after and warehouse',
        stockOnly.data.length === 1 && s0.kind === 'stock' && s0.stockBefore === 0 && s0.stockAfter === 4 && s0.warehouseName === 'Main')
    })

    // 9. RLS: tenant B cannot see tenant A's sequences or items
    await step('tenant isolation', async () => {
      const seen = await withTenantTransaction(B.tenantId, async (tx) => {
        const r = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM items WHERE tenant_id = ${A.tenantId}`)
        const s = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM tenant_sequences WHERE tenant_id = ${A.tenantId}`)
        const l = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM item_change_log WHERE tenant_id = ${A.tenantId}`)
        return [r, s, l].map((x) => Number(x.rows[0].n))
      })
      check('RLS hides other tenant items / sequences / change log', seen.every((n) => n === 0), JSON.stringify(seen))
    })

    // 10. stock audit: no false mismatches (test tenant + every pre-existing tenant after backfill)
    await step('stock audit', async () => {
      const findA = await stockAuditModule.run(A.tenantId)
      const mismatchA = findA.filter((f) => f.title.startsWith('Stock mismatch'))
      check('stock audit: no mismatch for ledger-written test tenant', mismatchA.length === 0, mismatchA.map((m) => m.message).join('; '))
      const tenants = await admin.query(`SELECT id FROM tenants WHERE id NOT IN ($1, $2)`, [A.tenantId, B.tenantId])
      let total = 0
      for (const t of tenants.rows) {
        const f = await stockAuditModule.run(t.id)
        total += f.filter((x) => x.title.startsWith('Stock mismatch')).length
      }
      check(`stock audit: no mismatch across ${tenants.rows.length} existing tenants after backfill`, total === 0, `mismatches=${total}`)
    })
  } finally {
    if (process.env.KEEP_TEST_DATA !== '1') {
      // Disable usage/storage triggers while removing the throw-away tenants
      await admin.query(`SET session_replication_role = replica`)
      for (const f of [A, B]) {
        const t = f.tenantId
        await admin.query(`DELETE FROM stock_take_items WHERE tenant_id=$1`, [t])
        await admin.query(`DELETE FROM stock_takes WHERE tenant_id=$1`, [t])
        await admin.query(`DELETE FROM stock_movements WHERE tenant_id=$1`, [t])
        await admin.query(`DELETE FROM warehouse_stock WHERE tenant_id=$1`, [t])
        await admin.query(`DELETE FROM item_change_log WHERE tenant_id=$1`, [t])
        await admin.query(`DELETE FROM items WHERE tenant_id=$1`, [t])
        await admin.query(`DELETE FROM tenant_sequences WHERE tenant_id=$1`, [t])
        await admin.query(`DELETE FROM activity_logs WHERE tenant_id=$1`, [t]).catch(() => undefined)
        await admin.query(`DELETE FROM users WHERE tenant_id=$1`, [t])
        await admin.query(`DELETE FROM warehouses WHERE tenant_id=$1`, [t])
        await admin.query(`DELETE FROM tenant_usage WHERE tenant_id=$1`, [t]).catch(() => undefined)
        await admin.query(`DELETE FROM tenants WHERE id=$1`, [t]).catch((e) => console.warn('cleanup tenant:', e.message))
      }
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
  process.exit(1)
})
