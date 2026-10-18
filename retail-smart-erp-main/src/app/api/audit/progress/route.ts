import { NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { getAuditProgress } from '@/lib/audit/runner'

// GET — poll for audit progress
export async function GET() {
  const session = await authWithCompany()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const permError = requirePermission(session, 'viewActivityLogs')
  if (permError) return permError

  const progress = getAuditProgress(session.user.tenantId)
  return NextResponse.json(progress)
}
