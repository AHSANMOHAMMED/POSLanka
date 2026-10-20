import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authWithCompany } from '@/lib/auth'
import { validateParams } from '@/lib/validation/helpers'
import { logError } from '@/lib/ai/error-logger'
import { getPgError } from '@/lib/db/errors'
import { effectiveStatus, getJob, toJobView, updateJob } from '@/lib/import-export/import-job-store'
import { checkJobAccess } from '@/lib/import-export/import-request'
import { isRunningLocally, startImportJobInBackground } from '@/lib/import-export/run-import-job'

// POST - resume an interrupted / failed job: re-runs pending rows only
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const paramsParsed = validateParams(await params, z.object({ jobId: z.string().uuid() }))
    if (!paramsParsed.success) return paramsParsed.response
    const { jobId } = paramsParsed.data
    const tenantId = session.user.tenantId

    const job = await getJob(tenantId, jobId)
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    const denied = checkJobAccess(session, job)
    if (denied) return denied

    const status = effectiveStatus(job)
    if (status === 'done' || status === 'cancelled') {
      return NextResponse.json({ error: `Job is already ${status}` }, { status: 400 })
    }
    if ((status === 'processing' || status === 'queued') || isRunningLocally(jobId)) {
      return NextResponse.json({ error: 'Job is still running', job: toJobView(job) }, { status: 409 })
    }

    // Take ownership with a fresh heartbeat (compare-and-set on the stored status)
    let claimed
    try {
      claimed = await updateJob(tenantId, jobId, { status: 'processing', heartbeatAt: new Date(), errorMessage: null }, [job.status])
    } catch (err) {
      if (getPgError(err)?.code === '23505') {
        return NextResponse.json({ error: 'The same file is already being imported by another job' }, { status: 409 })
      }
      throw err
    }
    if (!claimed) return NextResponse.json({ error: 'Job state changed, try again' }, { status: 409 })

    startImportJobInBackground(jobId, tenantId)
    return NextResponse.json({ jobId, status: 'processing' })
  } catch (error) {
    logError('api/import/jobs/[jobId]/resume', error)
    return NextResponse.json({ error: 'Failed to resume import' }, { status: 500 })
  }
}
