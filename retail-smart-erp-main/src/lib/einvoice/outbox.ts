/**
 * E-invoice outbox (H2): back-fill one row per fiscal document of e-invoice-enabled tenants and
 * transmit pending rows with exponential backoff. Driven by POST /api/cron/einvoice-sync, so the
 * sales / notes code paths need no changes.
 *
 *   pending ──transmit ok──▶ sent ──(authority ack)──▶ acknowledged
 *      │ retryable failure: attempts++, next_attempt_at = now + backoff
 *      └ non-retryable / MAX_ATTEMPTS ──▶ failed (reset to pending by hand to retry)
 */
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm'
import { db as ownerDb, withTenantTransaction } from '@/lib/db'
import { creditNotes, debitNotes, einvoiceOutbox, sales, tenants } from '@/lib/db/schema'
import { buildNotePayload, buildSalePayload } from './payload'
import { getTransmitter, type EInvoiceTransmitter } from './transmitter'
import type { EInvoiceSourceType } from './types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbOrTx = any

export const MAX_ATTEMPTS = 10
const BACKFILL_BATCH = 200
const SEND_BATCH = 50

/** Delay before attempt n+1 after n failed attempts: 1 min · 2^(n-1), capped at 12 h. */
export function backoffMs(attempts: number): number {
  return Math.min(12 * 60 * 60_000, 60_000 * 2 ** Math.max(0, attempts - 1))
}

const rowsOf = <T>(res: unknown): T[] => ((res as { rows?: T[] }).rows ?? (res as T[]))

/** Insert outbox rows for documents issued since the tenant enabled e-invoicing. Returns rows added. */
export async function backfillOutbox(db: DbOrTx, tenantId: string, since: Date): Promise<number> {
  const sinceIso = since.toISOString()
  const candidates: Array<{ source_type: EInvoiceSourceType; id: string }> = [
    ...rowsOf<{ source_type: EInvoiceSourceType; id: string }>(await db.execute(sql`
      SELECT CASE WHEN s.is_return THEN 'sale_return' ELSE 'sale' END AS source_type, s.id
      FROM sales s
      WHERE s.tenant_id = ${tenantId} AND s.status <> 'void' AND s.created_at >= ${sinceIso}
        AND NOT EXISTS (SELECT 1 FROM einvoice_outbox o WHERE o.tenant_id = s.tenant_id AND o.document_id = s.id
                        AND o.source_type IN ('sale', 'sale_return'))
      ORDER BY s.created_at LIMIT ${BACKFILL_BATCH}
    `)),
    ...rowsOf<{ source_type: EInvoiceSourceType; id: string }>(await db.execute(sql`
      SELECT 'credit_note' AS source_type, n.id FROM credit_notes n
      WHERE n.tenant_id = ${tenantId} AND n.status IN ('issued', 'applied') AND n.created_at >= ${sinceIso}
        AND NOT EXISTS (SELECT 1 FROM einvoice_outbox o WHERE o.tenant_id = n.tenant_id AND o.source_type = 'credit_note' AND o.document_id = n.id)
      ORDER BY n.created_at LIMIT ${BACKFILL_BATCH}
    `)),
    ...rowsOf<{ source_type: EInvoiceSourceType; id: string }>(await db.execute(sql`
      SELECT 'debit_note' AS source_type, n.id FROM debit_notes n
      WHERE n.tenant_id = ${tenantId} AND n.status = 'issued' AND n.created_at >= ${sinceIso}
        AND NOT EXISTS (SELECT 1 FROM einvoice_outbox o WHERE o.tenant_id = n.tenant_id AND o.source_type = 'debit_note' AND o.document_id = n.id)
      ORDER BY n.created_at LIMIT ${BACKFILL_BATCH}
    `)),
  ]

  let added = 0
  for (const c of candidates) {
    const payload = c.source_type === 'sale' || c.source_type === 'sale_return'
      ? await buildSalePayload(db, tenantId, c.id)
      : await buildNotePayload(db, tenantId, c.source_type, c.id)
    const inserted = await db.insert(einvoiceOutbox).values({
      tenantId,
      documentType: payload.documentType,
      sourceType: c.source_type,
      documentId: c.id,
      documentNo: payload.documentNo,
      documentDate: payload.issueDate,
      status: 'pending',
      payload,
    }).onConflictDoNothing().returning({ id: einvoiceOutbox.id })
    added += inserted.length
  }
  return added
}

/** Is the source document still a live fiscal document (not voided / cancelled)? */
async function sourceStillValid(db: DbOrTx, sourceType: EInvoiceSourceType, id: string): Promise<boolean> {
  if (sourceType === 'sale' || sourceType === 'sale_return') {
    const s = await db.query.sales.findFirst({ where: eq(sales.id, id), columns: { status: true } })
    return !!s && s.status !== 'void'
  }
  if (sourceType === 'credit_note') {
    const n = await db.query.creditNotes.findFirst({ where: eq(creditNotes.id, id), columns: { status: true } })
    return !!n && (n.status === 'issued' || n.status === 'applied')
  }
  const n = await db.query.debitNotes.findFirst({ where: eq(debitNotes.id, id), columns: { status: true } })
  return !!n && n.status === 'issued'
}

export interface ProcessResult { sent: number; acknowledged: number; failed: number; retried: number; dropped: number; skipped: number }

/** Attempt transmission of the tenant's due pending rows. */
export async function processOutbox(db: DbOrTx, tenantId: string, transmitter: EInvoiceTransmitter, now = new Date()): Promise<ProcessResult> {
  const res: ProcessResult = { sent: 0, acknowledged: 0, failed: 0, retried: 0, dropped: 0, skipped: 0 }
  const due = await db.select().from(einvoiceOutbox)
    .where(and(eq(einvoiceOutbox.tenantId, tenantId), eq(einvoiceOutbox.status, 'pending'), lte(einvoiceOutbox.nextAttemptAt, now)))
    .orderBy(asc(einvoiceOutbox.createdAt))
    .limit(SEND_BATCH)
    .for('update', { skipLocked: true })
  if (!transmitter.enabled) {
    res.skipped = due.length
    return res
  }
  for (const row of due) {
    if (!(await sourceStillValid(db, row.sourceType, row.documentId))) {
      // Voided / cancelled before it was ever transmitted: nothing to report
      await db.delete(einvoiceOutbox).where(eq(einvoiceOutbox.id, row.id))
      res.dropped++
      continue
    }
    let result
    try {
      result = await transmitter.transmit(row.payload, { tenantId, outboxId: row.id })
    } catch (err) {
      result = { ok: false as const, retryable: true, error: err instanceof Error ? err.message : String(err) }
    }
    const attempts = row.attempts + 1
    if (result.ok) {
      await db.update(einvoiceOutbox).set({
        status: result.acknowledged ? 'acknowledged' : 'sent',
        attempts,
        irn: result.irn || null,
        response: (result.response ?? null) as unknown,
        lastError: null,
        sentAt: now,
        acknowledgedAt: result.acknowledged ? now : null,
        updatedAt: now,
      }).where(eq(einvoiceOutbox.id, row.id))
      if (result.acknowledged) res.acknowledged++
      else res.sent++
    } else {
      const giveUp = !result.retryable || attempts >= MAX_ATTEMPTS
      await db.update(einvoiceOutbox).set({
        status: giveUp ? 'failed' : 'pending',
        attempts,
        lastError: result.error.slice(0, 2000),
        response: (result.response ?? null) as unknown,
        nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)),
        updatedAt: now,
      }).where(eq(einvoiceOutbox.id, row.id))
      if (giveUp) res.failed++
      else res.retried++
    }
  }
  return res
}

export interface EinvoiceSyncSummary extends ProcessResult { tenants: number; queued: number; transmitter: string; errors: number }

/** Cron entry point: every active tenant with e-invoicing enabled. */
export async function runEinvoiceSync(opts: { tenantIds?: string[]; transmitter?: EInvoiceTransmitter; now?: Date } = {}): Promise<EinvoiceSyncSummary> {
  const transmitter = opts.transmitter || getTransmitter()
  const conds = [eq(tenants.einvoiceEnabled, true), eq(tenants.status, 'active')]
  if (opts.tenantIds?.length) conds.push(inArray(tenants.id, opts.tenantIds))
  const list = await ownerDb.select({ id: tenants.id, enabledAt: tenants.einvoiceEnabledAt, createdAt: tenants.createdAt }).from(tenants).where(and(...conds))
  const summary: EinvoiceSyncSummary = { tenants: 0, queued: 0, transmitter: transmitter.name, errors: 0, sent: 0, acknowledged: 0, failed: 0, retried: 0, dropped: 0, skipped: 0 }
  for (const t of list) {
    summary.tenants++
    try {
      const queued = await withTenantTransaction(t.id, (tx) => backfillOutbox(tx, t.id, t.enabledAt || t.createdAt))
      summary.queued += queued
      const r = await withTenantTransaction(t.id, (tx) => processOutbox(tx, t.id, transmitter, opts.now))
      for (const k of ['sent', 'acknowledged', 'failed', 'retried', 'dropped', 'skipped'] as const) summary[k] += r[k]
    } catch (err) {
      summary.errors++
      console.error(`[einvoice] tenant ${t.id}:`, err instanceof Error ? err.message : err)
    }
  }
  return summary
}
