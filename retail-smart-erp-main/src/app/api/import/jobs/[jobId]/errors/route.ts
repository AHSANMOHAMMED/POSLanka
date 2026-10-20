import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authWithCompany } from '@/lib/auth'
import { validateParams } from '@/lib/validation/helpers'
import { logError } from '@/lib/ai/error-logger'
import { getJob } from '@/lib/import-export/import-job-store'
import { checkJobAccess } from '@/lib/import-export/import-request'
import { buildErrorsCsv } from '@/lib/import-export/import-errors-csv'

// GET - CSV of failed / skipped rows (original columns + Error) for fixing and re-upload
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const paramsParsed = validateParams(await params, z.object({ jobId: z.string().uuid() }))
    if (!paramsParsed.success) return paramsParsed.response
    const { jobId } = paramsParsed.data

    const job = await getJob(session.user.tenantId, jobId)
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    const denied = checkJobAccess(session, job)
    if (denied) return denied

    const csv = await buildErrorsCsv(session.user.tenantId, job)
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="import_errors_${job.entityName}_${jobId.slice(0, 8)}.csv"`,
      },
    })
  } catch (error) {
    logError('api/import/jobs/[jobId]/errors', error)
    return NextResponse.json({ error: 'Failed to build errors file' }, { status: 500 })
  }
}
