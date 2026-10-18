import { NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { getStorageQuota } from '@/lib/db/storage-quota'

// GET /api/company/storage-quota - Returns storage quota for current tenant
export async function GET() {
  const session = await authWithCompany()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const quota = await getStorageQuota(session.user.tenantId)
  return NextResponse.json(quota)
}
