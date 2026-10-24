import { NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { logError } from '@/lib/ai/error-logger'
import { validateSearchParams } from '@/lib/validation'
import { listMessageLogs, logFilterSchema } from '@/lib/messaging/admin'

/** GET /api/messaging/logs — the business's SMS / WhatsApp delivery log (read-only). */
export async function GET(request: Request) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const perm = requirePermission(session, 'viewActivityLogs')
    if (perm) return perm
    const f = validateSearchParams(request, logFilterSchema)
    if (!f.success) return f.response
    return NextResponse.json(await listMessageLogs(session.user.tenantId, f.data))
  } catch (error) {
    logError('api/messaging/logs', error)
    return NextResponse.json({ error: 'Failed to load the delivery log' }, { status: 500 })
  }
}
