// Persistent import job repository (import_jobs + import_job_rows).
// Job state lives in PostgreSQL so progress survives restarts, works across
// instances and interrupted jobs can be resumed.

import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { withTenant, withTenantTransaction } from '@/lib/db'
import { importJobs, importJobRows } from '@/lib/db/schema'
import { getPgError } from '@/lib/db/errors'
import { broadcastAccountChange } from '@/lib/websocket/broadcast'
import type { ImportMode, StockImportMode } from './entity-config'

export type ImportJobStatus = 'queued' | 'validating' | 'processing' | 'done' | 'error' | 'cancelled' | 'interrupted'
export type ImportRowStatus = 'pending' | 'done' | 'skipped' | 'error'
export type ImportRowAction = 'insert' | 'update' | 'skip' | 'none'

export type ImportJobRecord = typeof importJobs.$inferSelect
export type ImportJobRowRecord = typeof importJobRows.$inferSelect

/** A processing job whose heartbeat is older than this is reported as interrupted. */
export const HEARTBEAT_STALE_MS = 2 * 60 * 1000

export interface ImportJobOptions {
  matchBy?: string[]
  stockMode?: StockImportMode
  blankPolicy?: 'keep'
  skipErrors?: boolean
  businessType?: string
  /** File headers in original order (errors CSV). */
  headers?: string[]
  columnMapping?: Record<string, string>
}

export interface ImportStockLine {
  warehouseId: string
  warehouseCode: string
  qty?: number | null
  minStock?: number | null
  reorderQty?: number | null
}

export interface ImportRowPayload {
  raw: Record<string, string>
  data: Record<string, unknown>
  stock?: ImportStockLine[]
  warnings?: string[]
}

export interface NewImportRow {
  rowIndex: number
  action: ImportRowAction
  status: ImportRowStatus
  payload: ImportRowPayload
  error?: string | null
  entityId?: string | null
}

export interface ImportJobView {
  jobId: string
  entityName: string
  mode: string
  fileName: string | null
  status: ImportJobStatus
  storedStatus: string
  total: number
  processed: number
  inserted: number
  updated: number
  imported: number
  skipped: number
  failed: number
  autoCreated: number
  errorMessage: string | null
  userId: string
  options: ImportJobOptions
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  heartbeatAt: string | null
  canResume: boolean
  errors?: { row: number; message: string; status: string }[]
}

export function isHeartbeatStale(job: Pick<ImportJobRecord, 'heartbeatAt' | 'startedAt' | 'createdAt'>, now = Date.now()): boolean {
  const ref = job.heartbeatAt ?? job.startedAt ?? job.createdAt
  return !ref || now - new Date(ref).getTime() > HEARTBEAT_STALE_MS
}

/** Status as shown to users: a processing job with a stale heartbeat is 'interrupted'. */
export function effectiveStatus(job: ImportJobRecord, now = Date.now()): ImportJobStatus {
  const s = job.status as ImportJobStatus
  if ((s === 'processing' || s === 'queued' || s === 'validating') && isHeartbeatStale(job, now)) return 'interrupted'
  return s
}

export function toJobView(job: ImportJobRecord, errors?: ImportJobView['errors']): ImportJobView {
  const status = effectiveStatus(job)
  const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null)
  return {
    jobId: job.id,
    entityName: job.entityName,
    mode: job.mode,
    fileName: job.fileName,
    status,
    storedStatus: job.status,
    total: job.total,
    processed: job.processed,
    inserted: job.inserted,
    updated: job.updated,
    imported: job.inserted + job.updated,
    skipped: job.skipped,
    failed: job.failed,
    autoCreated: job.autoCreated,
    errorMessage: job.errorMessage,
    userId: job.userId,
    options: (job.options || {}) as ImportJobOptions,
    createdAt: new Date(job.createdAt).toISOString(),
    startedAt: iso(job.startedAt),
    completedAt: iso(job.completedAt),
    heartbeatAt: iso(job.heartbeatAt),
    canResume: status === 'interrupted' || status === 'error',
    ...(errors ? { errors } : {}),
  }
}

export interface CreateImportJobInput {
  tenantId: string
  userId: string
  entityName: string
  mode: ImportMode
  options: ImportJobOptions
  fileName?: string | null
  fileHash?: string | null
  rows: NewImportRow[]
}

export type CreateImportJobResult =
  | { ok: true; job: ImportJobRecord }
  | { ok: false; conflict: ImportJobRecord | null }

const ROW_INSERT_CHUNK = 500

/**
 * Create the job and all its rows in one transaction. Rows already decided
 * (skip / validation error) are stored final; counters start from them.
 * Returns `{ ok: false, conflict }` when the same file is already running.
 */
export async function createImportJob(input: CreateImportJobInput): Promise<CreateImportJobResult> {
  const skipped = input.rows.filter(r => r.status === 'skipped').length
  const failed = input.rows.filter(r => r.status === 'error').length
  try {
    const job = await withTenantTransaction(input.tenantId, async (tx) => {
      const [created] = await tx.insert(importJobs).values({
        tenantId: input.tenantId,
        userId: input.userId,
        entityName: input.entityName,
        mode: input.mode,
        options: input.options as Record<string, unknown>,
        status: 'queued',
        fileName: input.fileName ? input.fileName.slice(0, 255) : null,
        fileHash: input.fileHash || null,
        total: input.rows.length,
        processed: skipped + failed,
        skipped,
        failed,
        heartbeatAt: new Date(),
      }).returning()

      for (let i = 0; i < input.rows.length; i += ROW_INSERT_CHUNK) {
        const slice = input.rows.slice(i, i + ROW_INSERT_CHUNK)
        await tx.insert(importJobRows).values(slice.map(r => ({
          jobId: created.id,
          tenantId: input.tenantId,
          rowIndex: r.rowIndex,
          action: r.action,
          status: r.status,
          payload: r.payload as unknown as Record<string, unknown>,
          error: r.error ?? null,
          entityId: r.entityId ?? null,
        })))
      }
      return created
    })
    return { ok: true, job }
  } catch (err) {
    const pg = getPgError(err)
    if (pg?.code === '23505' && pg.constraint === 'import_jobs_active_file_unique') {
      const conflict = input.fileHash ? await findActiveJobByHash(input.tenantId, input.fileHash, input.entityName) : null
      return { ok: false, conflict }
    }
    throw err
  }
}

export async function findActiveJobByHash(tenantId: string, fileHash: string, entityName: string): Promise<ImportJobRecord | null> {
  return withTenant(tenantId, async (db) => {
    const [job] = await db.select().from(importJobs).where(and(
      eq(importJobs.tenantId, tenantId),
      eq(importJobs.fileHash, fileHash),
      eq(importJobs.entityName, entityName),
      inArray(importJobs.status, ['queued', 'validating', 'processing']),
    )).limit(1)
    return job ?? null
  })
}

export async function getJob(tenantId: string, jobId: string): Promise<ImportJobRecord | null> {
  return withTenant(tenantId, async (db) => {
    const [job] = await db.select().from(importJobs)
      .where(and(eq(importJobs.id, jobId), eq(importJobs.tenantId, tenantId)))
      .limit(1)
    return job ?? null
  })
}

export async function listJobs(tenantId: string, opts: { userId?: string; limit?: number } = {}): Promise<ImportJobRecord[]> {
  return withTenant(tenantId, async (db) => {
    const conds = [eq(importJobs.tenantId, tenantId)]
    if (opts.userId) conds.push(eq(importJobs.userId, opts.userId))
    return db.select().from(importJobs)
      .where(and(...conds))
      .orderBy(desc(importJobs.createdAt))
      .limit(Math.min(opts.limit ?? 50, 200))
  })
}

export async function updateJob(
  tenantId: string,
  jobId: string,
  patch: Partial<Omit<ImportJobRecord, 'id' | 'tenantId'>>,
  onlyIfStatus?: string[],
): Promise<ImportJobRecord | null> {
  return withTenant(tenantId, async (db) => {
    const conds = [eq(importJobs.id, jobId), eq(importJobs.tenantId, tenantId)]
    if (onlyIfStatus?.length) conds.push(inArray(importJobs.status, onlyIfStatus))
    const [job] = await db.update(importJobs).set(patch).where(and(...conds)).returning()
    return job ?? null
  })
}

/** Rows that need attention (error / skipped), in file order. */
export async function listProblemRows(tenantId: string, jobId: string, limit?: number): Promise<ImportJobRowRecord[]> {
  return withTenant(tenantId, async (db) => {
    const q = db.select().from(importJobRows)
      .where(and(
        eq(importJobRows.jobId, jobId),
        eq(importJobRows.tenantId, tenantId),
        inArray(importJobRows.status, ['error', 'skipped']),
      ))
      .orderBy(importJobRows.rowIndex)
    return limit ? q.limit(limit) : q
  })
}

export async function countRowsByStatus(tenantId: string, jobId: string): Promise<Record<string, number>> {
  return withTenant(tenantId, async (db) => {
    const res = await db.select({ status: importJobRows.status, n: sql<number>`count(*)::int` })
      .from(importJobRows)
      .where(and(eq(importJobRows.jobId, jobId), eq(importJobRows.tenantId, tenantId)))
      .groupBy(importJobRows.status)
    const out: Record<string, number> = {}
    for (const r of res) out[r.status] = Number(r.n)
    return out
  })
}

/** Job view including the first problem rows (for polling clients). */
export async function getJobView(tenantId: string, jobId: string, errorLimit = 50): Promise<ImportJobView | null> {
  const job = await getJob(tenantId, jobId)
  if (!job) return null
  const problems = await listProblemRows(tenantId, jobId, errorLimit)
  return toJobView(job, problems.map(r => ({ row: r.rowIndex, message: r.error || r.status, status: r.status })))
}

/** Push job progress to the job owner's WebSocket session (best effort). */
export function broadcastJob(job: ImportJobRecord, extra?: Record<string, unknown>): void {
  try {
    const view = toJobView(job)
    broadcastAccountChange(job.userId, 'import-job', 'updated', job.id, {
      ...view,
      // Legacy client statuses: anything not finished is "processing"
      status: view.status,
      ...extra,
    })
  } catch {
    // broadcasting must never break the import
  }
}
