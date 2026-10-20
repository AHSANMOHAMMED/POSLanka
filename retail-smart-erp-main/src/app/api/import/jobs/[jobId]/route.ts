import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authWithCompany } from '@/lib/auth'
import { validateParams } from '@/lib/validation/helpers'
import { logError } from '@/lib/ai/error-logger'
import { getJob, getJobView } from '@/lib/import-export/import-job-store'
import { checkJobAccess } from '@/lib/import-export/import-request'

// GET - job progress from the DB ('interrupted' when processing with a stale heartbeat)
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

    const view = await getJobView(session.user.tenantId, jobId, 50)
    return NextResponse.json(view)
  } catch (error) {
    logError('api/import/jobs/[jobId]', error)
    return NextResponse.json({ error: 'Failed to load import job' }, { status: 500 })
  }
}
