import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { getJob } from '@/lib/import-export/import-job-store'
import { validateParams } from '@/lib/validation/helpers'
import { z } from 'zod'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const session = await authWithCompany()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const paramsParsed = validateParams(await params, z.object({ jobId: z.string().uuid() }))
    if (!paramsParsed.success) return paramsParsed.response
    const { jobId } = paramsParsed.data
  const job = getJob(jobId)

  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  // Only the job owner can poll
  if (job.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return NextResponse.json({
    jobId: job.jobId,
    status: job.status,
    processed: job.processed,
    total: job.total,
    imported: job.imported,
    skipped: job.skipped,
    autoCreated: job.autoCreated,
    errors: job.errors.slice(0, 50),
    errorMessage: job.errorMessage,
  })
}
