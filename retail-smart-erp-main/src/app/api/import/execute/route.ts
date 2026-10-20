import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { parseImportRequest } from '@/lib/import-export/import-request'
import { validateImport } from '@/lib/import-export/import-validate'
import { createImportJob, effectiveStatus } from '@/lib/import-export/import-job-store'
import { startImportJobInBackground } from '@/lib/import-export/run-import-job'

// POST - Validate the file, persist the job + rows, then apply in the background.
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseImportRequest(request, session)
    if (parsed instanceof NextResponse) return parsed

    const tenantId = session.user.tenantId
    const quotaError = await requireQuota(tenantId, 'file')
    if (quotaError) return quotaError

    const validation = await withTenant(tenantId, (db) => validateImport(db, {
      tenantId,
      entityConfig: parsed.entityConfig,
      rawRows: parsed.rawRows,
      columnMapping: parsed.columnMapping,
      mode: parsed.mode,
      options: parsed.options,
      businessType: parsed.businessType,
    }))

    if (!parsed.options.skipErrors && validation.counts.error > 0) {
      return NextResponse.json({
        error: `${validation.counts.error} rows have validation errors. Fix them or enable "Skip invalid rows".`,
        errors: validation.errors.slice(0, 20),
      }, { status: 400 })
    }
    if (validation.counts.insert + validation.counts.update === 0) {
      return NextResponse.json({ error: 'No rows to import', actions: validation.counts }, { status: 400 })
    }

    const created = await createImportJob({
      tenantId,
      userId: session.user.id,
      entityName: parsed.entityName,
      mode: parsed.mode,
      options: { ...parsed.options, matchBy: validation.matchBy },
      fileName: parsed.fileName,
      fileHash: parsed.fileHash,
      rows: validation.rows,
    })

    if (!created.ok) {
      const existing = created.conflict
      const status = existing ? effectiveStatus(existing) : 'processing'
      return NextResponse.json({
        error: status === 'interrupted'
          ? 'This file has an interrupted import. Resume it instead of starting again.'
          : 'This file is already being imported.',
        jobId: existing?.id ?? null,
        status,
      }, { status: 409 })
    }

    startImportJobInBackground(created.job.id, tenantId)

    return NextResponse.json({ jobId: created.job.id, total: created.job.total, actions: validation.counts })
  } catch (error) {
    logError('api/import/execute', error)
    return NextResponse.json({ error: 'Import failed to start' }, { status: 500 })
  }
}
