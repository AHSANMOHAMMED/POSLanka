import { NextResponse } from 'next/server'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { checkRateLimit, recordRateLimitAttempt } from '@/lib/auth/rate-limit'
import { backupStream, tenantBackupZip } from '@/lib/backup/tenant-backup'
import { logActivity } from '@/lib/utils/activity-log'
import { logError } from '@/lib/ai/error-logger'

export const dynamic = 'force-dynamic'
export const maxDuration = 900

const BACKUP_RATE_LIMIT = { maxAttempts: 3, windowMs: 60 * 60_000, category: 'tenant_backup' }
/** One backup per tenant at a time per instance (a backup holds a DB connection while streaming). */
const running = new Set<string>()

// GET /api/export/backup — owner-only full company backup (ZIP of JSON Lines, streamed)
export async function GET() {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (session.user.role !== 'owner' || session.user.customRoleId) {
      return NextResponse.json({ error: 'Only the company owner can download a full backup' }, { status: 403 })
    }
    const tenantId = session.user.tenantId
    const userId = await resolveUserIdRequired(session)

    const limit = await checkRateLimit(tenantId, BACKUP_RATE_LIMIT)
    if (limit.limited) {
      return NextResponse.json(
        { error: 'Backup limit reached (3 per hour). Try again later.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((limit.retryAfterMs || 60_000) / 1000)) } },
      )
    }
    if (running.has(tenantId)) {
      return NextResponse.json({ error: 'A backup of this company is already running' }, { status: 409 })
    }
    await recordRateLimitAttempt(tenantId, BACKUP_RATE_LIMIT)

    const startedAt = Date.now()
    await logActivity({
      tenantId, userId, action: 'export', entityType: 'backup',
      description: 'Started a full company backup download',
      metadata: { kind: 'tenant_backup', stage: 'started' },
    })

    running.add(tenantId)
    let released = false
    const release = () => { if (!released) { released = true; running.delete(tenantId) } }

    const gen = tenantBackupZip(tenantId, {
      requestedBy: session.user.email,
      onDone: (summary) => {
        release()
        void logActivity({
          tenantId, userId, action: 'export', entityType: 'backup',
          description: `Downloaded a full company backup (${summary.tables.length} tables, ${summary.totalRows} rows)`,
          metadata: { kind: 'tenant_backup', stage: 'completed', totalRows: summary.totalRows, tables: summary.tables.length, ms: Date.now() - startedAt },
        })
      },
    })
    const wrapped = (async function* () {
      try {
        yield* gen
      } finally {
        release()
      }
    })()
    const stream = backupStream(wrapped, (err) => {
      release()
      logError('api/export/backup', err)
    })

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${session.user.tenantSlug}-backup-${stamp}.zip"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    logError('api/export/backup', error)
    return NextResponse.json({ error: 'Backup failed' }, { status: 500 })
  }
}
