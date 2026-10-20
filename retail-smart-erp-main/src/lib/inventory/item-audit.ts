import { itemChangeLog } from '@/lib/db/schema'
import type { DbTx } from './db-types'

export type ItemChangeAction = 'create' | 'update' | 'delete' | 'deactivate' | 'activate' | (string & {})
export type ItemChangeSource = 'manual' | 'import' | 'intake' | 'api' | 'system' | 'pos' | (string & {})

/** Fields whose changes are recorded in item_change_log. */
export const AUDITED_ITEM_FIELDS = [
  'name', 'sku', 'barcode', 'pluCode', 'itemCode', 'categoryId', 'brand', 'unit',
  'costPrice', 'sellingPrice', 'taxTemplateId', 'trackStock', 'isActive', 'isWeighable',
  'supplierId', 'description', 'imageUrl',
] as const

export type AuditedItemField = (typeof AUDITED_ITEM_FIELDS)[number]

const PRICE_FIELDS = new Set<string>(['costPrice', 'sellingPrice'])
const NUMERIC_FIELDS = new Set<string>(['costPrice', 'sellingPrice'])

type ItemLike = Partial<Record<AuditedItemField, unknown>> & Record<string, unknown>

function normalise(field: string, v: unknown): unknown {
  if (v === undefined || v === null || v === '') return null
  if (NUMERIC_FIELDS.has(field)) {
    const n = Number(v)
    return Number.isFinite(n) ? n : v
  }
  if (v instanceof Date) return v.toISOString()
  return v
}

export type ItemChanges = Record<string, { from: unknown; to: unknown }>

/** Diff two item snapshots over the audited allowlist. */
export function diffItem(before: ItemLike | null | undefined, after: ItemLike | null | undefined): ItemChanges {
  const changes: ItemChanges = {}
  for (const f of AUDITED_ITEM_FIELDS) {
    const a = normalise(f, before?.[f])
    const b = normalise(f, after?.[f])
    if (a !== b) changes[f] = { from: a, to: b }
  }
  return changes
}

export interface RecordItemChangeInput {
  tenantId: string
  itemId: string
  userId?: string | null
  source: ItemChangeSource
  action: ItemChangeAction
  before?: ItemLike | null
  after?: ItemLike | null
  notes?: string | null
  importJobId?: string | null
  intakeBatchId?: string | null
}

/**
 * Write an item_change_log row. For 'update' actions nothing is written when
 * no audited field changed. Returns the log id (or null when skipped).
 */
export async function recordItemChange(tx: DbTx, input: RecordItemChangeInput): Promise<string | null> {
  const changes = diffItem(input.before, input.after)
  if (input.action === 'update' && Object.keys(changes).length === 0) return null
  // Creating/deleting an item is not a "price change" even though the prices appear in the diff
  const priceChanged = input.action !== 'create' && input.action !== 'delete'
    && Object.keys(changes).some((k) => PRICE_FIELDS.has(k))
  const [row] = await tx.insert(itemChangeLog).values({
    tenantId: input.tenantId,
    itemId: input.itemId,
    userId: input.userId || null,
    action: input.action,
    source: input.source,
    changes,
    priceChanged,
    importJobId: input.importJobId || null,
    intakeBatchId: input.intakeBatchId || null,
    notes: input.notes || null,
  }).returning({ id: itemChangeLog.id })
  return row?.id ?? null
}
