import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authWithCompany } from '@/lib/auth'
import { validateParams } from '@/lib/validation/helpers'
import { logError } from '@/lib/ai/error-logger'
import { broadcastJob, getJob, toJobView, updateJob } from '@/lib/import-export/import-job-store'
import { checkJobAccess } from '@/lib/import-export/import-request'

// POST - cancel a job. Rows already applied stay applied; pending rows are left pending.
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

    const cancelled = await updateJob(tenantId, jobId, { status: 'cancelled', completedAt: new Date() },
      ['queued', 'validating', 'processing', 'error', 'interrupted'])
    if (!cancelled) return NextResponse.json({ error: `Job is already ${job.status}` }, { status: 400 })
    broadcastJob(cancelled)
    return NextResponse.json(toJobView(cancelled))
  } catch (error) {
    logError('api/import/jobs/[jobId]/cancel', error)
    return NextResponse.json({ error: 'Failed to cancel import' }, { status: 500 })
  }
}
