import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { logError } from '@/lib/ai/error-logger'
import { parseImportRequest } from '@/lib/import-export/import-request'
import { validateImport } from '@/lib/import-export/import-validate'

// POST - Dry run: the SAME validation the runner uses, so preview == result.
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseImportRequest(request, session)
    if (parsed instanceof NextResponse) return parsed

    const result = await withTenant(session.user.tenantId, (db) => validateImport(db, {
      tenantId: session.user.tenantId,
      entityConfig: parsed.entityConfig,
      rawRows: parsed.rawRows,
      columnMapping: parsed.columnMapping,
      mode: parsed.mode,
      options: parsed.options,
      businessType: parsed.businessType,
    }))

    const preview = result.rows.slice(0, 100).map(row => ({
      row: row.rowIndex,
      status: row.status === 'error' ? 'error' as const : row.status === 'skipped' ? 'skip' as const : 'valid' as const,
      action: row.action,
      data: row.payload.data,
      error: row.error ?? null,
      errors: row.status === 'error' && row.error ? [{ column: '', message: row.error }] : [],
      warnings: row.warnings.map(message => ({ column: '', message })),
    }))

    return NextResponse.json({
      totalRows: result.counts.total,
      validRows: result.counts.insert + result.counts.update,
      errorRows: result.counts.error,
      skipRows: result.counts.skip,
      actions: result.counts,
      matchBy: result.matchBy,
      columns: Object.keys(parsed.columnMapping),
      mappedColumns: parsed.columnMapping,
      preview,
      errors: result.errors,
      warnings: [
        ...result.warnings,
        ...result.rows.filter(r => r.status === 'skipped').map(r => ({ row: r.rowIndex, column: '', message: `Skipped: ${r.error}` })),
      ],
    })
  } catch (error) {
    logError('api/import/preview', error)
    return NextResponse.json({ error: 'Import preview failed' }, { status: 500 })
  }
}
