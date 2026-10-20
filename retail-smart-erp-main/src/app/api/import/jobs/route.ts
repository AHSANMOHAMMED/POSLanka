import { NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { logError } from '@/lib/ai/error-logger'
import { listJobs, toJobView } from '@/lib/import-export/import-job-store'
import { canManageAllImports } from '@/lib/import-export/import-request'

// GET - latest 50 import jobs (own jobs; all tenant jobs for managers)
export async function GET() {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const jobs = await listJobs(session.user.tenantId, {
      userId: canManageAllImports(session) ? undefined : session.user.id,
      limit: 50,
    })
    return NextResponse.json({ jobs: jobs.map(j => toJobView(j)) })
  } catch (error) {
    logError('api/import/jobs', error)
    return NextResponse.json({ error: 'Failed to list import jobs' }, { status: 500 })
  }
}
