import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { adminAuthError, logAdminAction, withRateLimit, STRICT_LIMIT, validateAdminSession } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { isS3Configured } from '@/lib/files/r2'
import { deleteOrphans, scanOrphans } from '@/lib/admin/storage-cleanup'

const prefixSchema = z.string().trim().max(255).regex(/^[A-Za-z0-9/_.-]*$/, 'Letters, digits, / _ . - only').optional()

/** GET /api/sys-control/r2-cleanup?prefix= — dry run: uploaded files no record points at. */
export async function GET(request: NextRequest) {
  try {
    const rateLimited = await withRateLimit('/api/sys-control/r2-cleanup')
    if (rateLimited) return rateLimited
    const session = await validateAdminSession('read')
    if (!session) {
      return adminAuthError()
    }
    const parsed = validateSearchParams(request, z.object({ prefix: prefixSchema }))
    if (!parsed.success) return parsed.response
    const { scan } = await scanOrphans(parsed.data.prefix ?? '')
    return NextResponse.json({ storage: isS3Configured() ? 'object-storage' : 'local', ...scan })
  } catch (error) {
    logError('api/sys-control/r2-cleanup GET', error)
    return NextResponse.json({ error: 'Failed to scan file storage' }, { status: 500 })
  }
}

/** POST /api/sys-control/r2-cleanup { confirm: true, prefix? } — delete the orphans found by the scan. Audited. */
export async function POST(request: NextRequest) {
  try {
    const rateLimited = await withRateLimit('/api/sys-control/r2-cleanup', STRICT_LIMIT)
    if (rateLimited) return rateLimited
    const session = await validateAdminSession('settings')
    if (!session) {
      return adminAuthError()
    }
    const parsed = await validateBody(request, z.object({
      prefix: prefixSchema,
      confirm: z.literal(true, { message: 'Confirm the deletion' }),
    }))
    if (!parsed.success) return parsed.response
    const prefix = parsed.data.prefix ?? ''

    let result: { deleted: number; scanned: number }
    try {
      result = await deleteOrphans(prefix)
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('No file references')) {
        return NextResponse.json({ error: e.message }, { status: 409 })
      }
      throw e
    }
    await logAdminAction({ accountId: session.superAdminId, action: 'delete', resource: 'storage_orphans', details: { op: 'delete_orphans', prefix: prefix || '(all)', ...result } })
    return NextResponse.json({ ...result, prefix: prefix || '(all)' })
  } catch (error) {
    logError('api/sys-control/r2-cleanup POST', error)
    return NextResponse.json({ error: 'Failed to clean up file storage' }, { status: 500 })
  }
}
