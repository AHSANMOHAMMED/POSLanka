import { sql, type SQL } from 'drizzle-orm'
import type { DbTx } from './db-types'

export type ItemHistoryKind = 'all' | 'stock' | 'fields' | 'price'

export interface ItemHistoryQuery {
  itemId: string
  kind: ItemHistoryKind
  warehouseId?: string
  /** K4: limit the stock ledger to these branches (branch-restricted users) */
  warehouseIds?: string[] | null
  cursor?: string
  limit: number
}

export type ItemHistoryEntry =
  | {
      id: string; kind: 'stock'; date: string
      user: { id: string; name: string | null } | null
      type: string; qtyChange: number; stockBefore: number | null; stockAfter: number | null
      referenceType: string | null; referenceId: string | null; notes: string | null
      warehouseId: string | null; warehouseName: string | null; source: string | null
    }
  | {
      id: string; kind: 'fields' | 'price'; date: string
      user: { id: string; name: string | null } | null
      action: string; source: string; changes: Record<string, { from: unknown; to: unknown }>; notes: string | null
    }
  | {
      id: string; kind: 'cost'; date: string
      user: { id: string; name: string | null } | null
      source: string; previousCostPrice: number; newCostPrice: number; purchasePrice: number | null
      quantity: number | null; referenceNo: string | null; notes: string | null
    }

export interface ItemHistoryPage {
  data: ItemHistoryEntry[]
  nextCursor: string | null
}

export function encodeHistoryCursor(ts: string, id: string): string {
  return Buffer.from(`${ts}|${id}`, 'utf8').toString('base64url')
}

export function decodeHistoryCursor(cursor?: string): { ts: string; id: string } | null {
  if (!cursor) return null
  try {
    const [ts, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|')
    if (!ts || !id || !/^[0-9a-f-]{36}$/i.test(id) || Number.isNaN(Date.parse(ts.replace(' ', 'T')))) return null
    return { ts, id }
  } catch {
    return null
  }
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

/**
 * Merged, newest-first item timeline: stock ledger + field/price change log +
 * cost history. Keyset pagination on (created_at, id).
 */
export async function getItemHistory(db: DbTx, q: ItemHistoryQuery): Promise<ItemHistoryPage> {
  const parts: SQL[] = []
  const wantStock = q.kind === 'all' || q.kind === 'stock'
  const wantLog = q.kind === 'all' || q.kind === 'fields' || q.kind === 'price'
  const wantCost = q.kind === 'all' || q.kind === 'price'

  if (wantStock) {
    parts.push(sql`
      SELECT sm.id, sm.created_at, 'stock'::text AS kind, sm.created_by AS user_id,
        jsonb_build_object(
          'type', sm.type, 'qtyChange', sm.qty_change, 'stockBefore', sm.stock_before, 'stockAfter', sm.stock_after,
          'referenceType', sm.reference_type, 'referenceId', sm.reference_id, 'notes', sm.notes,
          'warehouseId', sm.warehouse_id, 'warehouseName', w.name, 'source', sm.source
        ) AS data
      FROM stock_movements sm
      LEFT JOIN warehouses w ON w.id = sm.warehouse_id
      WHERE sm.item_id = ${q.itemId}
        AND COALESCE(sm.reference_type, '') <> 'ledger_baseline'
        ${q.warehouseId ? sql`AND sm.warehouse_id = ${q.warehouseId}` : sql``}
        ${q.warehouseIds ? sql`AND sm.warehouse_id IN (${sql.join(q.warehouseIds.map(w => sql`${w}::uuid`), sql`, `)})` : sql``}
    `)
  }
  if (wantLog) {
    parts.push(sql`
      SELECT l.id, l.created_at, CASE WHEN l.price_changed THEN 'price' ELSE 'fields' END AS kind, l.user_id,
        jsonb_build_object('action', l.action, 'source', l.source, 'changes', l.changes, 'notes', l.notes) AS data
      FROM item_change_log l
      WHERE l.item_id = ${q.itemId}
        ${q.kind === 'price' ? sql`AND l.price_changed` : sql``}
    `)
  }
  if (wantCost) {
    // Manual cost edits are already in item_change_log; skip their cost-history twin.
    parts.push(sql`
      SELECT c.id, c.created_at, 'cost'::text AS kind, c.created_by AS user_id,
        jsonb_build_object(
          'source', c.source, 'previousCostPrice', c.previous_cost_price, 'newCostPrice', c.new_cost_price,
          'purchasePrice', c.purchase_price, 'quantity', c.quantity, 'referenceNo', c.reference_no, 'notes', c.notes
        ) AS data
      FROM item_cost_history c
      WHERE c.item_id = ${q.itemId}
        AND NOT EXISTS (
          SELECT 1 FROM item_change_log l2
          WHERE l2.item_id = c.item_id AND l2.changes ? 'costPrice'
            AND abs(extract(epoch FROM (l2.created_at - c.created_at))) < 5
        )
    `)
  }
  if (parts.length === 0) return { data: [], nextCursor: null }

  const cursor = decodeHistoryCursor(q.cursor)
  const union = sql.join(parts, sql` UNION ALL `)
  const res = await db.execute<{
    id: string; created_at: string; created_at_text: string; kind: string; user_id: string | null
    user_name: string | null; data: Record<string, unknown>
  }>(sql`
    SELECT ev.id, ev.created_at, ev.created_at::text AS created_at_text, ev.kind, ev.user_id,
           u.full_name AS user_name, ev.data
    FROM (${union}) ev
    LEFT JOIN users u ON u.id = ev.user_id
    ${cursor ? sql`WHERE (ev.created_at, ev.id) < (${cursor.ts}::timestamp, ${cursor.id}::uuid)` : sql``}
    ORDER BY ev.created_at DESC, ev.id DESC
    LIMIT ${q.limit + 1}
  `)

  const rows = res.rows
  const page = rows.slice(0, q.limit)
  const data: ItemHistoryEntry[] = page.map((r) => {
    const d = r.data || {}
    const user = r.user_id ? { id: r.user_id, name: r.user_name } : null
    const date = new Date(r.created_at_text.replace(' ', 'T') + 'Z').toISOString()
    if (r.kind === 'stock') {
      return {
        id: r.id, kind: 'stock', date, user,
        type: String(d.type), qtyChange: Number(d.qtyChange ?? 0),
        stockBefore: num(d.stockBefore), stockAfter: num(d.stockAfter),
        referenceType: (d.referenceType as string) ?? null, referenceId: (d.referenceId as string) ?? null,
        notes: (d.notes as string) ?? null, warehouseId: (d.warehouseId as string) ?? null,
        warehouseName: (d.warehouseName as string) ?? null, source: (d.source as string) ?? null,
      }
    }
    if (r.kind === 'cost') {
      return {
        id: r.id, kind: 'cost', date, user,
        source: String(d.source), previousCostPrice: Number(d.previousCostPrice ?? 0), newCostPrice: Number(d.newCostPrice ?? 0),
        purchasePrice: num(d.purchasePrice), quantity: num(d.quantity),
        referenceNo: (d.referenceNo as string) ?? null, notes: (d.notes as string) ?? null,
      }
    }
    return {
      id: r.id, kind: r.kind === 'price' ? 'price' : 'fields', date, user,
      action: String(d.action), source: String(d.source),
      changes: (d.changes as Record<string, { from: unknown; to: unknown }>) || {}, notes: (d.notes as string) ?? null,
    }
  })
  const last = page[page.length - 1]
  return {
    data,
    nextCursor: rows.length > q.limit && last ? encodeHistoryCursor(last.created_at_text, last.id) : null,
  }
}
