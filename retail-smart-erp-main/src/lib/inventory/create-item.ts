import { sql } from 'drizzle-orm'
import { items } from '@/lib/db/schema'
import { DuplicateError, getPgError } from '@/lib/db/errors'
import { withSavepoint, type DbTx } from './db-types'
import { bumpItemCodeSequence, bumpSequence, generateItemCode, generateUniqueBarcode } from './item-codes'
import { recordItemChange, type ItemChangeSource } from './item-audit'
import { applyStockChange, type StockChangeResult } from './apply-stock-change'

type ItemInsert = typeof items.$inferInsert
export type ItemRow = typeof items.$inferSelect

export type CreateItemData = Omit<ItemInsert, 'id' | 'tenantId' | 'itemCode' | 'barcode' | 'createdBy' | 'updatedBy' | 'version' | 'createdAt' | 'updatedAt'> & {
  /** Optional user-supplied code; auto-generated (ITM-000123) when blank. */
  itemCode?: string | null
  /** Optional user-supplied barcode; a unique in-store EAN-13 is generated when blank. */
  barcode?: string | null
}

export interface OpeningStockLine {
  warehouseId: string
  qty: number
  minStock?: number | null
  reorderQty?: number | null
  binLocation?: string | null
}

export interface CreateItemInput {
  tenantId: string
  userId?: string | null
  source: ItemChangeSource
  data: CreateItemData
  openingStock?: OpeningStockLine[]
  importJobId?: string | null
  intakeBatchId?: string | null
  notes?: string | null
}

export interface CreateItemResult {
  item: ItemRow
  stock: StockChangeResult[]
}

const MAX_ATTEMPTS = 3

const FIELD_BY_CONSTRAINT: Record<string, 'itemCode' | 'barcode' | 'sku' | 'pluCode'> = {
  items_tenant_item_code_unique: 'itemCode',
  items_tenant_barcode_unique: 'barcode',
  items_tenant_sku_unique: 'sku',
  items_tenant_plu_unique: 'pluCode',
}

const COLUMN_BY_FIELD = {
  itemCode: sql.raw('item_code'),
  barcode: sql.raw('barcode'),
  sku: sql.raw('sku'),
  pluCode: sql.raw('plu_code'),
} as const

const blankToNull = (v: string | null | undefined): string | null => {
  const t = typeof v === 'string' ? v.trim() : v
  return t ? t : null
}

async function findExistingId(tx: DbTx, tenantId: string, field: keyof typeof COLUMN_BY_FIELD, value: string): Promise<string | null> {
  const res = await tx.execute<{ id: string }>(sql`
    SELECT id FROM items WHERE tenant_id = ${tenantId} AND ${COLUMN_BY_FIELD[field]} = ${value} LIMIT 1
  `)
  const row = res.rows[0]
  return row?.id ?? null
}

/** Move the item_code sequence past the highest ITM code in use (self-heal after manual codes). */
async function resyncItemCodeSequence(tx: DbTx, tenantId: string): Promise<void> {
  const res = await tx.execute<{ max_no: string }>(sql`
    SELECT COALESCE(MAX(substring(item_code FROM '^ITM-(\\d{1,15})$')::bigint), 0) AS max_no
    FROM items WHERE tenant_id = ${tenantId}
  `)
  const max = Number(res.rows[0]?.max_no || 0)
  if (max > 0) await bumpSequence(tx, tenantId, 'item_code', max)
}

/**
 * The single item creator. Allocates item code + barcode right before INSERT,
 * inserts inside a savepoint and retries (up to 3x) when an auto-generated
 * code/barcode collides. User-supplied sku / barcode / PLU / item code
 * duplicates throw DuplicateError(field, existingItemId).
 * Writes item_change_log 'create' and optional opening stock through the ledger.
 */
export async function createItem(tx: DbTx, input: CreateItemInput): Promise<CreateItemResult> {
  const { tenantId, userId, source, data } = input
  const suppliedCode = blankToNull(data.itemCode)?.toUpperCase() ?? null
  const suppliedBarcode = blankToNull(data.barcode)
  const sku = blankToNull(data.sku ?? null)
  const pluCode = blankToNull(data.pluCode ?? null)

  if (suppliedCode) await bumpItemCodeSequence(tx, tenantId, suppliedCode)

  let item: ItemRow | undefined
  for (let attempt = 1; attempt <= MAX_ATTEMPTS && !item; attempt++) {
    const itemCode = suppliedCode ?? await generateItemCode(tx, tenantId)
    const barcode = suppliedBarcode ?? await generateUniqueBarcode(tx, tenantId)
    try {
      item = await withSavepoint(tx, async (sp) => {
        const [row] = await sp.insert(items).values({
          ...data,
          tenantId,
          itemCode,
          barcode,
          sku,
          pluCode,
          createdBy: userId || null,
          updatedBy: userId || null,
          version: 1,
        }).returning()
        return row
      })
    } catch (err) {
      const pg = getPgError(err)
      if (pg?.code !== '23505') throw err
      const field = pg.constraint ? FIELD_BY_CONSTRAINT[pg.constraint] : undefined
      if (!field) throw err
      if (field === 'itemCode' && !suppliedCode && attempt < MAX_ATTEMPTS) {
        await resyncItemCodeSequence(tx, tenantId)
        continue
      }
      if (field === 'barcode' && !suppliedBarcode && attempt < MAX_ATTEMPTS) continue
      const value = field === 'itemCode' ? itemCode : field === 'barcode' ? barcode : field === 'sku' ? sku : pluCode
      const existingId = value ? await findExistingId(tx, tenantId, field, value) : null
      throw new DuplicateError(field, existingId, value)
    }
  }
  if (!item) throw new Error('ITEM_CREATE_FAILED')

  await recordItemChange(tx, {
    tenantId,
    itemId: item.id,
    userId,
    source,
    action: 'create',
    before: null,
    after: item as unknown as Record<string, unknown>,
    importJobId: input.importJobId,
    intakeBatchId: input.intakeBatchId,
    notes: input.notes,
  })

  const stock: StockChangeResult[] = []
  for (const line of input.openingStock || []) {
    const qty = Number(line.qty) || 0
    if (qty !== 0) {
      stock.push(await applyStockChange(tx, {
        tenantId,
        warehouseId: line.warehouseId,
        itemId: item.id,
        mode: 'delta',
        qty,
        type: 'in',
        referenceType: 'opening_stock',
        referenceId: item.id,
        notes: 'Opening stock',
        userId,
        source,
        allowNegative: false,
        idempotencyKey: `opening:${item.id}:${line.warehouseId}`,
      }))
    }
    if (line.minStock != null || line.reorderQty != null || line.binLocation != null) {
      // Ensure the row exists even when no opening quantity was given
      await tx.execute(sql`
        INSERT INTO warehouse_stock (tenant_id, warehouse_id, item_id, current_stock, min_stock, reorder_qty, bin_location)
        VALUES (${tenantId}, ${line.warehouseId}, ${item.id}, 0,
                ${String(line.minStock ?? 0)}::numeric, ${line.reorderQty != null ? String(line.reorderQty) : null}::numeric,
                ${line.binLocation ?? null})
        ON CONFLICT (warehouse_id, item_id, tenant_id) DO UPDATE
          SET min_stock = CASE WHEN ${line.minStock != null} THEN EXCLUDED.min_stock ELSE warehouse_stock.min_stock END,
              reorder_qty = COALESCE(EXCLUDED.reorder_qty, warehouse_stock.reorder_qty),
              bin_location = COALESCE(EXCLUDED.bin_location, warehouse_stock.bin_location),
              updated_at = now()
      `)
    }
  }

  return { item, stock }
}
