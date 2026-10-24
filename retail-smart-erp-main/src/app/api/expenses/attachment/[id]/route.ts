import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { authWithCompany } from '@/lib/auth'
import { requireAnyPermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { files } from '@/lib/db/schema'
import { getFromR2, keyFromUrl } from '@/lib/files'
import { logError } from '@/lib/ai/error-logger'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

const INLINE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])

/** GET /api/expenses/attachment/[id] — shows an expense bill uploaded with POST /api/expenses/attachment. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requireAnyPermission(session, ['createSales', 'manageAccounting', 'requestAdvance'])
    if (permError) return permError
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response

    const file = await withTenant(session.user.tenantId, (db) => db.query.files.findFirst({
      where: and(eq(files.id, p.data.id), eq(files.attachedToType, 'expense'), eq(files.isFolder, false)),
    }))
    if (!file) return NextResponse.json({ error: 'Bill not found' }, { status: 404 })

    const key = keyFromUrl(file.fileUrl)
    const stored = key ? await getFromR2(key) : null
    if (!stored) return NextResponse.json({ error: 'Bill not found on storage' }, { status: 404 })

    const contentType = file.fileType || stored.contentType
    return new NextResponse(new Uint8Array(stored.buffer), {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': INLINE_TYPES.has(contentType) ? 'inline' : `attachment; filename="${encodeURIComponent(file.fileName)}"`,
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    logError('api/expenses/attachment/[id]', error)
    return NextResponse.json({ error: 'Failed to open the bill' }, { status: 500 })
  }
}
