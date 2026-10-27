/**
 * Recurring invoice generation (drizzle/0185). Used by /api/cron/recurring-invoices (all tenants)
 * and "Run now" / "Post invoice" on a profile.
 *
 * One occurrence at a time, idempotent per profile per scheduled date:
 *  1. claim — under the profile's row lock, INSERT recurring_invoice_runs (profile, run_date)
 *     ON CONFLICT DO NOTHING. A second caller (double cron call, double click) finds the row and
 *     stops; a failed run is re-claimed (cron: up to MAX_ATTEMPTS), a stale 'processing' one after
 *     STALE_MS. Draft profiles finish here: the run is stored as 'draft' and the schedule advances.
 *  2. invoice — POST /api/sales via src/lib/billing/sales-invoice.ts with a clientSaleId derived
 *     from (profile, run date), so even a retry after a crash returns the sale already created.
 *  3. record — run → generated (sale, number, total, due date); profile → next occurrence.
 *     A failure leaves the schedule where it is (the run is retried) and shows the error.
 *
 * Server-only.
 */
import { and, asc, eq, lte, sql } from 'drizzle-orm'
import { withTenant, withoutTenant, type TenantDb } from '@/lib/db'
import { customers, recurringInvoiceItems, recurringInvoiceRuns, recurringInvoices } from '@/lib/db/schema'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { colomboDate } from '@/lib/messaging/service'
import type { CompanySession } from '@/lib/auth'
import { addDays, nextRunDate, type RecurringSchedule } from './schedule'
import { createSalesInvoice, priceInvoiceLines, setInvoiceNotes, stableUuid, systemSessionFor } from '@/lib/billing/sales-invoice'

export const MAX_ATTEMPTS = 3
const STALE_MS = 10 * 60_000
/** occurrences one call catches up per profile (a start date far in the past) */
export const CATCH_UP_LIMIT = 12

type Profile = typeof recurringInvoices.$inferSelect
type Run = typeof recurringInvoiceRuns.$inferSelect

export type OccurrenceOutcome =
  | { kind: 'generated'; runId: string; runDate: string; saleId: string; invoiceNo: string; total: number }
  | { kind: 'draft'; runId: string; runDate: string; total: number }
  | { kind: 'duplicate'; runId: string; runDate: string }
  | { kind: 'in_progress'; runId: string; runDate: string }
  | { kind: 'failed'; runId: string; runDate: string; error: string; code?: string }
  | { kind: 'gave_up'; runId: string; runDate: string }
  | { kind: 'not_due'; nextRunDate: string | null }
  | { kind: 'inactive'; status: string }

export function scheduleOf(p: Pick<Profile, 'frequency' | 'intervalCount' | 'startDate' | 'endType' | 'endAfterCount' | 'endDate'>): RecurringSchedule {
  return {
    frequency: p.frequency, intervalCount: p.intervalCount, startDate: p.startDate,
    endType: p.endType, endAfterCount: p.endAfterCount, endDate: p.endDate,
  }
}

/** Today as a local (Asia/Colombo) date */
export function recurringToday(now = new Date()): string {
  return colomboDate(now)
}

function invoiceNotes(p: Profile, runDate: string, dueDate: string): string | null {
  const parts = [
    `Recurring invoice: ${p.profileName} (${runDate})`,
    p.paymentTermsDays > 0 ? `Due date: ${dueDate} (net ${p.paymentTermsDays} days)` : `Due on receipt`,
    p.notes?.trim() || '',
    p.terms?.trim() ? `Terms & conditions: ${p.terms.trim()}` : '',
  ].filter(Boolean)
  return parts.join('\n')
}

async function loadLines(tenantId: string, profileId: string) {
  return withTenant(tenantId, (db) => db.select().from(recurringInvoiceItems)
    .where(eq(recurringInvoiceItems.recurringInvoiceId, profileId)).orderBy(asc(recurringInvoiceItems.sortOrder)))
}

async function priceProfile(tenantId: string, p: Profile) {
  const lines = await loadLines(tenantId, p.id)
  if (lines.length === 0) throw new Error('The profile has no line items')
  return withTenant(tenantId, (db) => priceInvoiceLines(db, tenantId, {
    customerId: p.customerId,
    lines: lines.map((l) => ({
      itemId: l.itemId, name: l.itemName, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice),
      discount: Number(l.discount) || 0, uom: l.uom,
    })),
  }))
}

type Claim =
  | { kind: 'claimed'; profile: Profile; run: Run; occurrence: number; runDate: string; dueDate: string }
  | Exclude<OccurrenceOutcome, { kind: 'generated' } | { kind: 'failed' }>

/** Step 1 (see header). `force`: "Run now" — the next occurrence even if its date is ahead. */
async function claimNext(tenantId: string, profileId: string, opts: { today: string; force: boolean; triggeredBy: 'cron' | 'manual'; userId?: string | null; expectedRunDate?: string | null }): Promise<Claim> {
  return withTenant(tenantId, async (db) => {
    const [p] = await db.select().from(recurringInvoices).where(eq(recurringInvoices.id, profileId)).for('update')
    if (!p || !p.isActive) return { kind: 'inactive', status: p ? 'deleted' : 'missing' }
    if (p.status !== 'active' && !(opts.force && p.status === 'paused')) return { kind: 'inactive', status: p.status }
    const k = p.occurrencesGenerated
    const runDate = nextRunDate(scheduleOf(p), k)
    if (!runDate) {
      await db.update(recurringInvoices).set({ status: 'completed', nextRunDate: null, updatedAt: new Date() }).where(eq(recurringInvoices.id, p.id))
      return { kind: 'inactive', status: 'completed' }
    }
    if (!opts.force && runDate > opts.today) return { kind: 'not_due', nextRunDate: runDate }
    // "Run now" names the date the user saw: a second click (the schedule has moved on since)
    // gets the invoice of that date back instead of raising the following period too
    if (opts.expectedRunDate && opts.expectedRunDate !== runDate) {
      const [seen] = await db.select().from(recurringInvoiceRuns)
        .where(and(eq(recurringInvoiceRuns.recurringInvoiceId, p.id), eq(recurringInvoiceRuns.runDate, opts.expectedRunDate)))
      if (seen && seen.status === 'processing') return { kind: 'in_progress', runId: seen.id, runDate: seen.runDate }
      if (seen) return { kind: 'duplicate', runId: seen.id, runDate: seen.runDate }
      return { kind: 'not_due', nextRunDate: runDate }
    }
    const dueDate = addDays(runDate, Math.max(0, p.paymentTermsDays))

    const [inserted] = await db.insert(recurringInvoiceRuns).values({
      tenantId, recurringInvoiceId: p.id, runDate, occurrence: k, status: 'processing', dueDate,
      attempts: 1, triggeredBy: opts.triggeredBy, createdBy: opts.userId ?? null,
    }).onConflictDoNothing({ target: [recurringInvoiceRuns.recurringInvoiceId, recurringInvoiceRuns.runDate] }).returning()

    let run: Run | undefined = inserted
    if (!run) {
      const [existing] = await db.select().from(recurringInvoiceRuns)
        .where(and(eq(recurringInvoiceRuns.recurringInvoiceId, p.id), eq(recurringInvoiceRuns.runDate, runDate))).for('update')
      if (!existing) return { kind: 'in_progress', runId: '', runDate }
      if (existing.status === 'generated' || existing.status === 'draft' || existing.status === 'skipped') {
        // Done before (e.g. the profile update was lost): make sure the schedule moved on
        if (p.occurrencesGenerated === k) await advance(db, p, k)
        return { kind: 'duplicate', runId: existing.id, runDate }
      }
      const stale = Date.now() - new Date(existing.updatedAt).getTime() > STALE_MS
      if (existing.status === 'processing' && !stale) return { kind: 'in_progress', runId: existing.id, runDate }
      if (existing.status === 'failed' && opts.triggeredBy === 'cron' && existing.attempts >= MAX_ATTEMPTS) {
        return { kind: 'gave_up', runId: existing.id, runDate }
      }
      ;[run] = await db.update(recurringInvoiceRuns)
        .set({ status: 'processing', attempts: existing.attempts + 1, error: null, triggeredBy: opts.triggeredBy, updatedAt: new Date() })
        .where(eq(recurringInvoiceRuns.id, existing.id)).returning()
    }

    if (p.invoiceAction === 'draft') {
      // Drafts are reviewed and posted later ("Post invoice"): the schedule moves on now
      await db.update(recurringInvoiceRuns).set({ status: 'draft', updatedAt: new Date() }).where(eq(recurringInvoiceRuns.id, run.id))
      await advance(db, p, k)
      return { kind: 'draft', runId: run.id, runDate, total: 0 }
    }
    return { kind: 'claimed', profile: p, run, occurrence: k, runDate, dueDate }
  })
}

async function advance(db: TenantDb, p: Profile, k: number) {
  const next = nextRunDate(scheduleOf(p), k + 1)
  await db.update(recurringInvoices).set({
    occurrencesGenerated: k + 1,
    nextRunDate: next,
    status: next ? p.status : 'completed',
    lastRunAt: new Date(),
    lastError: null,
    updatedAt: new Date(),
  }).where(eq(recurringInvoices.id, p.id))
}

/** Steps 2–3 for a claimed (or draft) run. */
async function invoiceRun(tenantId: string, p: Profile, run: Run, opts: { session?: CompanySession | null; advanceSchedule: boolean }): Promise<OccurrenceOutcome> {
  const runDate = run.runDate
  const dueDate = run.dueDate || addDays(runDate, Math.max(0, p.paymentTermsDays))
  let result: Awaited<ReturnType<typeof createSalesInvoice>>
  try {
    const priced = await priceProfile(tenantId, p)
    result = await createSalesInvoice({
      session: opts.session, tenantId, customerId: p.customerId, warehouseId: p.warehouseId, priced,
      clientSaleId: stableUuid(`recurring-invoice:${p.id}:${runDate}`),
    })
  } catch (error) {
    logError('recurring-invoices/generate', error, { tenantId, profileId: p.id, runDate })
    result = { ok: false, status: 500, error: error instanceof Error ? error.message : 'Failed to create the invoice' }
  }

  if (!result.ok || !result.saleId) {
    const error = result.error || 'Failed to create the invoice'
    await withTenant(tenantId, async (db) => {
      await db.update(recurringInvoiceRuns).set({ status: opts.advanceSchedule ? 'failed' : 'draft', error, updatedAt: new Date() })
        .where(eq(recurringInvoiceRuns.id, run.id))
      await db.update(recurringInvoices).set({ lastError: `${runDate}: ${error}`, updatedAt: new Date() }).where(eq(recurringInvoices.id, p.id))
    })
    logAndBroadcast(tenantId, 'recurring-invoice', 'updated', p.id)
    return { kind: 'failed', runId: run.id, runDate, error, code: result.code }
  }

  await withTenant(tenantId, async (db) => {
    await db.update(recurringInvoiceRuns).set({
      status: 'generated', saleId: result.saleId!, invoiceNo: result.invoiceNo || null, total: String(result.total ?? 0),
      dueDate, error: null, updatedAt: new Date(),
    }).where(eq(recurringInvoiceRuns.id, run.id))
    if (opts.advanceSchedule) {
      const [locked] = await db.select().from(recurringInvoices).where(eq(recurringInvoices.id, p.id)).for('update')
      if (locked && locked.occurrencesGenerated === run.occurrence) await advance(db, locked, run.occurrence)
    }
  })
  await setInvoiceNotes(tenantId, result.saleId, invoiceNotes(p, runDate, dueDate)).catch((e) => logError('recurring-invoices/notes', e))
  if (p.notifyChannel !== 'none') {
    try {
      const { sendSaleReceipt } = await import('@/lib/messaging/actions')
      await sendSaleReceipt({ tenantId, saleId: result.saleId, channel: p.notifyChannel, userId: opts.session?.user.id ?? null })
    } catch (e) {
      logError('recurring-invoices/notify', e, { tenantId, saleId: result.saleId })
    }
  }
  logAndBroadcast(tenantId, 'recurring-invoice', 'updated', p.id)
  logAndBroadcast(tenantId, 'sale', 'created', result.saleId)
  return { kind: 'generated', runId: run.id, runDate, saleId: result.saleId, invoiceNo: result.invoiceNo || '', total: result.total ?? 0 }
}

/**
 * Generate what is due for one profile (cron: every due occurrence up to CATCH_UP_LIMIT;
 * force = "Run now": exactly the next occurrence, even if its date is ahead).
 */
export async function generateForProfile(tenantId: string, profileId: string, opts: {
  today?: string; force?: boolean; triggeredBy?: 'cron' | 'manual'; session?: CompanySession | null; userId?: string | null; limit?: number
  /** "Run now": the next run date the user saw (double-click safe) */
  expectedRunDate?: string | null
} = {}): Promise<OccurrenceOutcome[]> {
  const today = opts.today || recurringToday()
  const limit = opts.force ? 1 : Math.max(1, opts.limit ?? CATCH_UP_LIMIT)
  const outcomes: OccurrenceOutcome[] = []
  for (let i = 0; i < limit; i++) {
    const claim = await claimNext(tenantId, profileId, { today, force: !!opts.force, triggeredBy: opts.triggeredBy || 'cron', userId: opts.userId, expectedRunDate: opts.expectedRunDate })
    if (claim.kind !== 'claimed') {
      if (claim.kind === 'draft') {
        // show the draft's amount in the history (priced as it would be invoiced today)
        try {
          const p = await withTenant(tenantId, (db) => db.select().from(recurringInvoices).where(eq(recurringInvoices.id, profileId)))
          if (p[0]) {
            const priced = await priceProfile(tenantId, p[0])
            claim.total = priced.total
            await withTenant(tenantId, (db) => db.update(recurringInvoiceRuns).set({ total: String(priced.total) }).where(eq(recurringInvoiceRuns.id, claim.runId)))
          }
        } catch (e) {
          logError('recurring-invoices/draft-total', e, { tenantId, profileId })
        }
        logAndBroadcast(tenantId, 'recurring-invoice', 'updated', profileId)
      }
      outcomes.push(claim)
      if (claim.kind === 'draft' || claim.kind === 'duplicate') continue
      break
    }
    const outcome = await invoiceRun(tenantId, claim.profile, claim.run, { session: opts.session, advanceSchedule: true })
    outcomes.push(outcome)
    if (outcome.kind !== 'generated') break
  }
  return outcomes
}

/** "Post invoice" on a draft run: raise the invoice now (the schedule already moved on). */
export async function postDraftRun(tenantId: string, runId: string, opts: { session?: CompanySession | null } = {}): Promise<OccurrenceOutcome | { kind: 'not_draft'; status: string }> {
  const claimed = await withTenant(tenantId, async (db) => {
    const [run] = await db.update(recurringInvoiceRuns).set({ status: 'processing', attempts: sql`${recurringInvoiceRuns.attempts} + 1`, updatedAt: new Date() })
      .where(and(eq(recurringInvoiceRuns.id, runId), eq(recurringInvoiceRuns.status, 'draft'))).returning()
    if (!run) {
      const [cur] = await db.select({ status: recurringInvoiceRuns.status }).from(recurringInvoiceRuns).where(eq(recurringInvoiceRuns.id, runId))
      return { notDraft: cur?.status || 'missing' }
    }
    const [p] = await db.select().from(recurringInvoices).where(eq(recurringInvoices.id, run.recurringInvoiceId))
    return { run, p }
  })
  if ('notDraft' in claimed) return { kind: 'not_draft', status: String(claimed.notDraft) }
  if (!claimed.p) return { kind: 'not_draft', status: 'missing' }
  return invoiceRun(tenantId, claimed.p, claimed.run, { session: opts.session, advanceSchedule: false })
}

export interface RecurringCronSummary {
  today: string
  profiles: number
  generated: number
  drafts: number
  failed: number
  skipped: number
  outcomes: Array<{ tenantId: string; profileId: string; outcomes: OccurrenceOutcome[] }>
}

/** Cron: every active profile due on or before today (Asia/Colombo), all tenants. */
export async function runRecurringInvoices(opts: { now?: Date; tenantIds?: string[] } = {}): Promise<RecurringCronSummary> {
  const today = recurringToday(opts.now)
  const due = await withoutTenant((db) => db.select({
    id: recurringInvoices.id, tenantId: recurringInvoices.tenantId, createdBy: recurringInvoices.createdBy,
  }).from(recurringInvoices)
    .innerJoin(customers, eq(customers.id, recurringInvoices.customerId))
    .where(and(
      eq(recurringInvoices.status, 'active'), eq(recurringInvoices.isActive, true),
      lte(recurringInvoices.nextRunDate, today),
      opts.tenantIds?.length ? sql`${recurringInvoices.tenantId} IN (${sql.join(opts.tenantIds.map((t) => sql`${t}::uuid`), sql`, `)})` : undefined,
      sql`EXISTS (SELECT 1 FROM tenants t WHERE t.id = ${recurringInvoices.tenantId} AND t.status = 'active')`,
    ))
    .orderBy(asc(recurringInvoices.tenantId), asc(recurringInvoices.nextRunDate)))

  const summary: RecurringCronSummary = { today, profiles: due.length, generated: 0, drafts: 0, failed: 0, skipped: 0, outcomes: [] }
  const sessions = new Map<string, CompanySession | null>()
  for (const row of due) {
    try {
      const key = `${row.tenantId}:${row.createdBy || ''}`
      if (!sessions.has(key)) sessions.set(key, await systemSessionFor(row.tenantId, row.createdBy))
      const session = sessions.get(key)
      if (!session) {
        summary.skipped++
        await withTenant(row.tenantId, (db) => db.update(recurringInvoices)
          .set({ lastError: 'No active owner or manager to raise the invoice as', updatedAt: new Date() })
          .where(eq(recurringInvoices.id, row.id)))
        continue
      }
      const outcomes = await generateForProfile(row.tenantId, row.id, { today, triggeredBy: 'cron', session, userId: session.user.id })
      for (const o of outcomes) {
        if (o.kind === 'generated') summary.generated++
        else if (o.kind === 'draft') summary.drafts++
        else if (o.kind === 'failed') summary.failed++
        else summary.skipped++
      }
      summary.outcomes.push({ tenantId: row.tenantId, profileId: row.id, outcomes })
    } catch (error) {
      summary.failed++
      logError('cron/recurring-invoices', error, { tenantId: row.tenantId, profileId: row.id })
    }
  }
  return summary
}
