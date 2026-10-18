import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { getEntityConfig } from '@/lib/import-export/entity-config'
import { parseCsv, parseXlsx, mapColumns, validateRows } from '@/lib/import-export/import-utils'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { createJob, getJob, updateJob } from '@/lib/import-export/import-job-store'
import { runImportJob } from '@/lib/import-export/run-import-job'
import { broadcastAccountChange } from '@/lib/websocket/broadcast'
import { randomUUID } from 'crypto'

export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File
    const entityName = formData.get('entity') as string
    const mode = (formData.get('mode') as string) || 'insert'
    const skipErrors = formData.get('skipErrors') === 'true'

    if (!file || !entityName) {
      return NextResponse.json({ error: 'File and entity are required' }, { status: 400 })
    }

    const entityConfig = getEntityConfig(entityName)
    if (!entityConfig) {
      return NextResponse.json({ error: `Unknown entity: ${entityName}` }, { status: 400 })
    }

    if (!entityConfig.importable) {
      return NextResponse.json({ error: `Import not supported for: ${entityName}` }, { status: 400 })
    }

    const permError = requirePermission(session, entityConfig.permission as Parameters<typeof requirePermission>[1])
    if (permError) return permError

    const quotaError = await requireQuota(session.user.tenantId, 'file')
    if (quotaError) return quotaError

    const businessType = session.user.businessType || undefined

    // Parse file synchronously before returning response
    let rawRows: Record<string, string>[]
    const fileName = file.name.toLowerCase()

    if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
      const buffer = await file.arrayBuffer()
      rawRows = await parseXlsx(buffer)
    } else if (fileName.endsWith('.csv')) {
      const text = await file.text()
      rawRows = parseCsv(text)
    } else {
      return NextResponse.json({ error: 'Unsupported file format. Use CSV or XLSX.' }, { status: 400 })
    }

    if (rawRows.length === 0) {
      return NextResponse.json({ error: 'File contains no data rows' }, { status: 400 })
    }

    // Map columns
    const headers = Object.keys(rawRows[0])
    const customMappingStr = formData.get('columnMapping') as string | null
    let columnMapping: Record<string, string>
    if (customMappingStr) {
      try {
        columnMapping = JSON.parse(customMappingStr)
      } catch {
        return NextResponse.json({ error: 'Invalid column mapping format' }, { status: 400 })
      }
    } else {
      columnMapping = mapColumns(headers, entityConfig, businessType)
    }

    // Validate rows
    const validation = validateRows(rawRows, entityConfig, columnMapping, mode as 'insert' | 'update', businessType)

    if (!skipErrors && validation.errorCount > 0) {
      return NextResponse.json({
        error: `${validation.errorCount} rows have validation errors. Fix them or enable "Skip invalid rows".`,
        errors: validation.errors.slice(0, 20),
      }, { status: 400 })
    }

    if (validation.validRows.length === 0) {
      return NextResponse.json({ error: 'No valid rows to import' }, { status: 400 })
    }

    // Create job and return immediately
    const jobId = randomUUID()
    const tenantId = session.user.tenantId
    const userId = session.user.id

    createJob({
      jobId,
      tenantId,
      userId,
      entityName,
      status: 'processing',
      total: validation.validRows.length,
      processed: 0,
      imported: 0,
      skipped: 0,
      autoCreated: 0,
      errors: [],
      startedAt: Date.now(),
    })

    // Kick off background processing (detached — no await)
    runImportJob({
      jobId,
      tenantId,
      userId,
      entityName,
      entityConfig,
      businessType,
      validRows: validation.validRows,
      mode: mode as 'insert' | 'update',
      skipErrors,
    }).catch((err) => {
      console.error('[ImportJob] Unhandled error:', err)
      updateJob(jobId, { status: 'error', errorMessage: 'Internal error', completedAt: Date.now() })
      broadcastAccountChange(userId, 'import-job', 'updated', jobId, {
        ...getJob(jobId),
        status: 'error',
        errorMessage: 'Internal error',
      })
      logError('import-job-unhandled', err, { errorSource: 'system', context: { jobId, entityName } })
    })

    return NextResponse.json({ jobId })
  } catch (error) {
    logError('api/import/execute', error)
    console.error('POST /api/import/execute error:', error)
    return NextResponse.json({ error: 'Import failed to start' }, { status: 500 })
  }
}
