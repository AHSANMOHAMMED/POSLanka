// In-memory import job store using globalThis pattern
// Jobs are ephemeral — lost on server restart (acceptable for import progress tracking)

export type ImportJobStatus = 'processing' | 'done' | 'error'

export interface ImportJob {
  jobId: string
  tenantId: string
  userId: string
  entityName: string
  status: ImportJobStatus
  total: number
  processed: number
  imported: number
  skipped: number
  autoCreated: number
  errors: { row: number; message: string }[]
  errorMessage?: string
  startedAt: number
  completedAt?: number
}

declare global {
  // eslint-disable-next-line no-var
  var __importJobs: Map<string, ImportJob> | undefined
}

function getJobStore(): Map<string, ImportJob> {
  if (!globalThis.__importJobs) {
    globalThis.__importJobs = new Map()
  }
  return globalThis.__importJobs
}

export function createJob(job: ImportJob): void {
  const store = getJobStore()
  store.set(job.jobId, job)

  // TTL cleanup: remove jobs older than 2 hours
  const cutoff = Date.now() - 2 * 60 * 60 * 1000
  for (const [id, j] of store) {
    if (j.startedAt < cutoff) store.delete(id)
  }
}

export function getJob(jobId: string): ImportJob | undefined {
  return getJobStore().get(jobId)
}

export function updateJob(jobId: string, patch: Partial<ImportJob>): ImportJob | undefined {
  const store = getJobStore()
  const job = store.get(jobId)
  if (!job) return undefined
  const updated = { ...job, ...patch }
  store.set(jobId, updated)
  return updated
}
