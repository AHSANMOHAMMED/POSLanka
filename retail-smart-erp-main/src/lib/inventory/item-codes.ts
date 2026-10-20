import { sql } from 'drizzle-orm'
import type { DbTx } from './db-types'
import { ean13CheckDigit } from './barcode-generate'

/**
 * Per-tenant counters backed by the `tenant_sequences` table.
 * Allocation is a single upsert, so concurrent callers serialise on the row lock
 * and never receive the same value. Values are only "burned" if the surrounding
 * transaction commits (a rollback releases them), so gaps are possible but
 * duplicates are not.
 */
export type SequenceKey = 'item_code' | 'item_barcode' | 'invoice' | 'return' | (string & {})

export const ITEM_CODE_PREFIX = 'ITM-'
const ITEM_CODE_RE = /^ITM-(\d{1,15})$/

function firstRow<T>(res: unknown): T | undefined {
  const rows = (res as { rows?: T[] }).rows
  return rows?.[0]
}

/**
 * Allocate `n` consecutive values for `key` and return the first one.
 * The allocated range is [first, first + n - 1].
 */
export async function nextSequence(tx: DbTx, tenantId: string, key: SequenceKey, n = 1): Promise<number> {
  if (!Number.isInteger(n) || n < 1) throw new Error('nextSequence: n must be a positive integer')
  const res = await tx.execute(sql`
    INSERT INTO tenant_sequences (tenant_id, seq_key, next_value, updated_at)
    VALUES (${tenantId}, ${key}, ${1 + n}, now())
    ON CONFLICT (tenant_id, seq_key) DO UPDATE
      SET next_value = tenant_sequences.next_value + ${n}, updated_at = now()
    RETURNING (next_value - ${n})::bigint AS first_value
  `)
  const row = firstRow<{ first_value: string | number }>(res)
  if (!row) throw new Error(`nextSequence: no value returned for ${key}`)
  return Number(row.first_value)
}

/** Ensure the sequence for `key` is strictly greater than `value` (used when users supply codes). */
export async function bumpSequence(tx: DbTx, tenantId: string, key: SequenceKey, value: number): Promise<void> {
  await tx.execute(sql`
    INSERT INTO tenant_sequences (tenant_id, seq_key, next_value, updated_at)
    VALUES (${tenantId}, ${key}, ${value + 1}, now())
    ON CONFLICT (tenant_id, seq_key) DO UPDATE
      SET next_value = GREATEST(tenant_sequences.next_value, ${value + 1}), updated_at = now()
  `)
}

export function formatItemCode(n: number): string {
  return ITEM_CODE_PREFIX + String(n).padStart(6, '0')
}

/** Parse the numeric part of an `ITM-000123` style code (null for any other format). */
export function parseItemCode(code: string | null | undefined): number | null {
  if (!code) return null
  const m = code.trim().toUpperCase().match(ITEM_CODE_RE)
  return m ? Number(m[1]) : null
}

/** Next auto item code for the tenant: ITM-000001, ITM-000002, … (grows past 6 digits). */
export async function generateItemCode(tx: DbTx, tenantId: string): Promise<string> {
  return formatItemCode(await nextSequence(tx, tenantId, 'item_code'))
}

/**
 * When a user supplies a code in the auto format (ITM-<digits>), move the
 * sequence past it so a later auto code cannot collide.
 */
export async function bumpItemCodeSequence(tx: DbTx, tenantId: string, code: string): Promise<void> {
  const n = parseItemCode(code)
  if (n !== null) await bumpSequence(tx, tenantId, 'item_code', n)
}

/** Build the in-store EAN-13 for a sequence number: '2' + 11-digit seq + check digit. */
export function formatGeneratedBarcode(seq: number): string {
  const body = '2' + String(seq).padStart(11, '0').slice(-11)
  return body + ean13CheckDigit(body)
}

/**
 * Allocate a tenant-unique in-store EAN-13 barcode. Skips values that are
 * already used by an item (e.g. typed in manually) — up to 5 attempts.
 */
export async function generateUniqueBarcode(tx: DbTx, tenantId: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = formatGeneratedBarcode(await nextSequence(tx, tenantId, 'item_barcode'))
    const res = await tx.execute(sql`
      SELECT 1 FROM items WHERE tenant_id = ${tenantId} AND barcode = ${code} LIMIT 1
    `)
    if (!firstRow(res)) return code
  }
  throw new Error('BARCODE_GENERATION_FAILED')
}

export type DocumentKind = 'invoice' | 'return'

const DOCUMENT_PREFIX: Record<DocumentKind, string> = {
  invoice: 'INV',
  return: 'RTN',
}

/** Next sales document number for the tenant, e.g. INV-000123 / RTN-000004. */
export async function nextDocumentNumber(tx: DbTx, tenantId: string, kind: DocumentKind): Promise<string> {
  const n = await nextSequence(tx, tenantId, kind)
  return `${DOCUMENT_PREFIX[kind]}-${String(n).padStart(6, '0')}`
}
