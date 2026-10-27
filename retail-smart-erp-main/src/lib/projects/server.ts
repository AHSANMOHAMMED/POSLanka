/**
 * Projects & time tracking — server helpers (drizzle/0185). Server-only.
 *
 * Invoicing unbilled time / a fixed price ("Create invoice") goes through POST /api/sales with
 * service lines (a non-stock service item; src/lib/billing/sales-invoice.ts):
 *  1. claim — under the project's row lock the billable entries are locked and marked invoiced
 *     against a new project_invoices row, so a second click / tab cannot bill them again;
 *  2. invoice — POST /api/sales (clientSaleId from the project_invoices id);
 *  3. record — sale linked to the project invoice and the entries; on failure the claim is undone.
 */
import { NextResponse } from 'next/server'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { withTenant, type TenantDb } from '@/lib/db'
import { items, projectInvoices, projectMembers, projectTasks, projectTimeEntries, projects, users } from '@/lib/db/schema'
import { hasPermission } from '@/lib/auth/roles'
import { assertRecordBranch } from '@/lib/auth/branch-access'
import { roundCurrency } from '@/lib/utils/currency'
import { generateItemCode } from '@/lib/inventory/item-codes'
import type { CompanySession } from '@/lib/auth'
import { previewProjectInvoice, type BillingPreview } from './billing'
import { createSalesInvoice, priceInvoiceLines, setInvoiceNotes, stableUuid } from '@/lib/billing/sales-invoice'

export const SERVICE_ITEM_NAME = 'Professional services'

export function canManageProjects(session: CompanySession): boolean {
  return hasPermission(session.user.role, 'manageSales', session.user.tenantId, session.user.customRoleId)
}

/** Colombo wall time on `date` at HH:MM → instant */
export function colomboInstant(date: string, hhmm: string): Date {
  return new Date(`${date}T${hhmm}:00+05:30`)
}

/** Local (Asia/Colombo) date of an instant */
export function colomboDateOf(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

/**
 * Project access: managers (manageSales) — any project of their branches; other staff — only
 * projects they are a member of. Returns a 403/404 response or null.
 */
export async function projectAccess(session: CompanySession, db: TenantDb, projectId: string, userId: string): Promise<NextResponse | null> {
  const [p] = await db.select({ id: projects.id, isActive: projects.isActive }).from(projects).where(eq(projects.id, projectId))
  if (!p || !p.isActive) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  if (canManageProjects(session)) return assertRecordBranch(session, db, projects, projectId, { includeUnassigned: true })
  const [m] = await db.select({ id: projectMembers.id }).from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
  return m ? null : NextResponse.json({ error: 'You are not a member of this project' }, { status: 403 })
}

export async function loadBillingContext(db: TenantDb, projectId: string, opts: { lock?: boolean } = {}) {
  const q = db.select().from(projects).where(eq(projects.id, projectId))
  const [project] = opts.lock ? await q.for('update') : await q
  if (!project) return null
  const tasks = await db.select().from(projectTasks).where(eq(projectTasks.projectId, projectId))
  const members = await db.select({ userId: projectMembers.userId, rate: projectMembers.rate, name: users.fullName })
    .from(projectMembers).leftJoin(users, eq(users.id, projectMembers.userId)).where(eq(projectMembers.projectId, projectId))
  const eq_ = db.select().from(projectTimeEntries)
    .where(and(eq(projectTimeEntries.projectId, projectId), eq(projectTimeEntries.invoiced, false), eq(projectTimeEntries.isRunning, false)))
  const entries = opts.lock ? await eq_.for('update') : await eq_
  const [{ fixedInvoiced }] = await db.select({ fixedInvoiced: sql<string>`COALESCE(SUM(${projectInvoices.amount}) FILTER (WHERE ${projectInvoices.kind} = 'fixed' AND ${projectInvoices.saleId} IS NOT NULL), 0)::text` })
    .from(projectInvoices).where(eq(projectInvoices.projectId, projectId))
  return { project, tasks, members, entries, fixedInvoiced: Number(fixedInvoiced) || 0 }
}

export function previewFromContext(ctx: NonNullable<Awaited<ReturnType<typeof loadBillingContext>>>, opts: { includeTime?: boolean; fixedAmount?: number; entryIds?: string[] } = {}): BillingPreview {
  const { project, tasks, members, entries, fixedInvoiced } = ctx
  return previewProjectInvoice(
    { name: project.name, billingMethod: project.billingMethod, projectRate: Number(project.projectRate), fixedAmount: Number(project.fixedAmount), fixedInvoiced },
    tasks.map((t) => ({ id: t.id, name: t.name, rate: Number(t.rate), billable: t.billable })),
    members.map((m) => ({ userId: m.userId, name: m.name || 'Staff', rate: Number(m.rate) })),
    entries.map((e) => ({ id: e.id, taskId: e.taskId, userId: e.userId, durationMinutes: e.durationMinutes, billable: e.billable, invoiced: e.invoiced, isRunning: e.isRunning })),
    opts,
  )
}

/** The project's service item, else the tenant's "Professional services" (created as a non-stock item). */
export async function ensureServiceItem(db: TenantDb, tenantId: string, serviceItemId: string | null): Promise<string> {
  if (serviceItemId) {
    const [it] = await db.select({ id: items.id }).from(items).where(eq(items.id, serviceItemId))
    if (it) return it.id
  }
  const [existing] = await db.select({ id: items.id }).from(items)
    .where(and(eq(items.name, SERVICE_ITEM_NAME), eq(items.trackStock, false), eq(items.isActive, true))).limit(1)
  if (existing) return existing.id
  const [created] = await db.insert(items).values({
    tenantId, itemCode: await generateItemCode(db, tenantId), name: SERVICE_ITEM_NAME, trackStock: false, unit: 'hrs', sellingPrice: '0', costPrice: '0',
  }).returning({ id: items.id })
  return created.id
}

export type ProjectInvoiceOutcome =
  | { ok: true; projectInvoiceId: string; saleId: string; invoiceNo: string; total: number; hours: number; amount: number }
  | { ok: false; status: number; error: string; code?: string }

export async function createProjectInvoice(
  session: CompanySession, userId: string, projectId: string,
  opts: { includeTime?: boolean; fixedAmount?: number; entryIds?: string[] },
): Promise<ProjectInvoiceOutcome> {
  const tenantId = session.user.tenantId
  const claim = await withTenant(tenantId, async (db) => {
    const ctx = await loadBillingContext(db, projectId, { lock: true })
    if (!ctx || !ctx.project.isActive) return { error: { ok: false as const, status: 404, error: 'Project not found' } }
    if (ctx.project.status === 'cancelled') return { error: { ok: false as const, status: 400, error: 'This project is cancelled' } }
    const preview = previewFromContext(ctx, opts)
    if (preview.lines.length === 0 || preview.totalAmount <= 0) {
      return { error: { ok: false as const, status: 400, error: 'Nothing to invoice: no unbilled billable time (or fixed price left)', code: 'NOTHING_TO_INVOICE' } }
    }
    if (ctx.project.billingMethod === 'fixed' && preview.totalAmount - preview.fixedRemaining > 0.004) {
      return { error: { ok: false as const, status: 400, error: `Only ${preview.fixedRemaining.toFixed(2)} of the fixed price is left to invoice`, code: 'FIXED_PRICE_EXCEEDED' } }
    }
    const serviceItemId = await ensureServiceItem(db, tenantId, ctx.project.serviceItemId)
    const kind = ctx.project.billingMethod === 'fixed' ? 'fixed' as const : 'time' as const
    const [pi] = await db.insert(projectInvoices).values({
      tenantId, projectId, kind, hours: String(roundCurrency(preview.totalMinutes / 60)), amount: String(preview.totalAmount), createdBy: userId,
    }).returning({ id: projectInvoices.id })
    const entryIds = preview.lines.flatMap((l) => l.entryIds)
    for (const id of entryIds) {
      const rate = preview.entryRates[id] ?? 0
      const minutes = ctx.entries.find((e) => e.id === id)?.durationMinutes ?? 0
      await db.update(projectTimeEntries).set({
        invoiced: true, projectInvoiceId: pi.id, invoicedRate: String(rate), invoicedAmount: String(roundCurrency(rate * minutes / 60)), updatedAt: new Date(),
      }).where(eq(projectTimeEntries.id, id))
    }
    const priced = await priceInvoiceLines(db, tenantId, {
      customerId: ctx.project.customerId,
      lines: preview.lines.map((l) => ({
        itemId: serviceItemId,
        name: l.kind === 'fixed' ? l.name : `${l.name} (${l.hours} h @ ${l.rate.toFixed(2)})`,
        quantity: l.kind === 'fixed' ? 1 : l.hours,
        unitPrice: l.rate,
      })),
    })
    return { pi, entryIds, priced, project: ctx.project, preview }
  })
  if ('error' in claim && claim.error) return claim.error
  const { pi, entryIds, priced, project, preview } = claim as Exclude<typeof claim, { error: unknown }>

  const undo = () => withTenant(tenantId, async (db) => {
    if (entryIds.length) {
      await db.update(projectTimeEntries).set({ invoiced: false, projectInvoiceId: null, invoicedRate: null, invoicedAmount: null, updatedAt: new Date() })
        .where(and(inArray(projectTimeEntries.id, entryIds), eq(projectTimeEntries.projectInvoiceId, pi.id)))
    }
    await db.delete(projectInvoices).where(eq(projectInvoices.id, pi.id))
  })

  let result: Awaited<ReturnType<typeof createSalesInvoice>>
  try {
    // Runs in the caller's request context: the signed-in user raises the invoice
    result = await createSalesInvoice({
      tenantId, customerId: project.customerId, warehouseId: project.warehouseId, priced,
      clientSaleId: stableUuid(`project-invoice:${pi.id}`),
    })
  } catch (e) {
    await undo()
    throw e
  }
  if (!result.ok || !result.saleId) {
    await undo()
    return { ok: false, status: result.status >= 400 ? result.status : 400, error: result.error || 'Failed to create the invoice', code: result.code }
  }
  await withTenant(tenantId, async (db) => {
    await db.update(projectInvoices).set({ saleId: result.saleId!, invoiceNo: result.invoiceNo || null }).where(eq(projectInvoices.id, pi.id))
    if (entryIds.length) await db.update(projectTimeEntries).set({ saleId: result.saleId! }).where(eq(projectTimeEntries.projectInvoiceId, pi.id))
  })
  await setInvoiceNotes(tenantId, result.saleId, `Project ${project.projectNo} — ${project.name}${preview.totalMinutes ? ` (${roundCurrency(preview.totalMinutes / 60)} h)` : ''}`).catch(() => undefined)
  return {
    ok: true, projectInvoiceId: pi.id, saleId: result.saleId, invoiceNo: result.invoiceNo || '', total: result.total ?? priced.total,
    hours: roundCurrency(preview.totalMinutes / 60), amount: preview.totalAmount,
  }
}

type TaskInput = { id?: string; name: string; description?: string | null; rate: number; billable: boolean; isActive: boolean }
type MemberInput = { userId: string; rate: number }

/**
 * Save a project's tasks (upsert by id; tasks left out are deactivated, never deleted — time may
 * point at them) and members (replaced; users must be active staff of the tenant).
 */
export async function saveTasksAndMembers(db: TenantDb, tenantId: string, projectId: string, tasks: TaskInput[], members: MemberInput[]): Promise<NextResponse | null> {
  if (members.length) {
    const ids = members.map((m) => m.userId)
    const found = await db.select({ id: users.id }).from(users).where(and(inArray(users.id, ids), eq(users.isActive, true)))
    if (found.length !== new Set(ids).size) return NextResponse.json({ error: 'A project member is not an active staff user' }, { status: 400 })
  }
  const existing = await db.select({ id: projectTasks.id }).from(projectTasks).where(eq(projectTasks.projectId, projectId))
  const existingIds = new Set(existing.map((t) => t.id))
  const kept = new Set<string>()
  for (const [i, t] of tasks.entries()) {
    const values = { name: t.name, description: t.description || null, rate: String(roundCurrency(t.rate)), billable: t.billable, isActive: t.isActive, sortOrder: i }
    if (t.id && existingIds.has(t.id)) {
      await db.update(projectTasks).set(values).where(eq(projectTasks.id, t.id))
      kept.add(t.id)
    } else {
      await db.insert(projectTasks).values({ tenantId, projectId, ...values })
    }
  }
  const dropped = [...existingIds].filter((id) => !kept.has(id))
  if (dropped.length) await db.update(projectTasks).set({ isActive: false }).where(inArray(projectTasks.id, dropped))
  await db.delete(projectMembers).where(eq(projectMembers.projectId, projectId))
  if (members.length) {
    await db.insert(projectMembers).values(members.map((m) => ({ tenantId, projectId, userId: m.userId, rate: String(roundCurrency(m.rate)) })))
  }
  return null
}

/** Hours logged / unbilled per project (minutes) */
export function projectTotalsSql() {
  return {
    loggedMinutes: sql<number>`(SELECT COALESCE(SUM(e.duration_minutes), 0)::int FROM project_time_entries e WHERE e.project_id = ${projects.id})`,
    unbilledMinutes: sql<number>`(SELECT COALESCE(SUM(e.duration_minutes), 0)::int FROM project_time_entries e
      LEFT JOIN project_tasks t ON t.id = e.task_id
      WHERE e.project_id = ${projects.id} AND e.billable AND NOT e.invoiced AND NOT e.is_running AND COALESCE(t.billable, true))`,
    invoicedAmount: sql<string>`(SELECT COALESCE(SUM(pi.amount), 0)::text FROM project_invoices pi WHERE pi.project_id = ${projects.id} AND pi.sale_id IS NOT NULL)`,
  }
}
