import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { adminAuthError, validateAdminSession } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import { validateParams, validateSearchParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { getBroadcast } from '@/lib/admin/broadcast'

const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
})

/** GET /api/sys-control/notifications/[id] — a sent broadcast (notification or email) with per-recipient delivery. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await validateAdminSession('read')
    if (!session) return adminAuthError()
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const q = validateSearchParams(request, pageSchema)
    if (!q.success) return q.response
    const broadcast = await getBroadcast(p.data.id, q.data.page, q.data.pageSize)
    if (!broadcast) return NextResponse.json({ error: 'Broadcast not found' }, { status: 404 })
    return NextResponse.json(broadcast)
  } catch (error) {
    logError('api/sys-control/notifications/[id]', error)
    return NextResponse.json({ error: 'Failed to load the broadcast' }, { status: 500 })
  }
}
