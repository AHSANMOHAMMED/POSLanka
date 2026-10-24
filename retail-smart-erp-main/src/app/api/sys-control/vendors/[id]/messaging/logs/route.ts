import { NextResponse } from 'next/server'
import { adminAuthError, validateAdminSession } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import { validateParams, validateSearchParams } from '@/lib/validation'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { listMessageLogs, logFilterSchema } from '@/lib/messaging/admin'

/** GET /api/sys-control/vendors/[id]/messaging/logs — the vendor's SMS / WhatsApp delivery log (filters: channel, status, purpose, from, to, search). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await validateAdminSession('read')
    if (!session) return adminAuthError()
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const f = validateSearchParams(request, logFilterSchema)
    if (!f.success) return f.response
    return NextResponse.json(await listMessageLogs(p.data.id, f.data))
  } catch (error) {
    logError('api/sys-control/vendors/[id]/messaging/logs', error)
    return NextResponse.json({ error: 'Failed to load the delivery log' }, { status: 500 })
  }
}
