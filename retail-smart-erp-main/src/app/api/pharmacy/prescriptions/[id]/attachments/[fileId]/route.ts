import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { files } from '@/lib/db/schema'
import { logError } from '@/lib/ai/error-logger'
import { getFromR2, keyFromUrl } from '@/lib/files'
import { loadPrescriptionFor } from '@/lib/pharmacy/prescription-access'
import { requireAnyPermission, UUID_RE } from '@/lib/pharmacy/route-helpers'

const INLINE = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])

/** GET /api/pharmacy/prescriptions/[id]/attachments/[fileId] — the image / PDF itself (inline) */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requireAnyPermission(session, ['createSales', 'viewReports'])
    if (permError) return permError
    const { id, fileId } = await params
    if (!UUID_RE.test(id) || !UUID_RE.test(fileId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return await withTenant(session.user.tenantId, async (db) => {
      const found = await loadPrescriptionFor(session, db, id)
      if ('error' in found) return found.error
      const [file] = await db.select({ fileUrl: files.fileUrl, fileType: files.fileType, fileName: files.fileName }).from(files)
        .where(and(eq(files.tenantId, session.user.tenantId), eq(files.id, fileId), eq(files.attachedToType, 'prescription'), eq(files.attachedToId, id)))
        .limit(1)
      if (!file) return NextResponse.json({ error: 'Image not found' }, { status: 404 })
      const key = keyFromUrl(file.fileUrl)
      const obj = key ? await getFromR2(key) : null
      if (!obj) return NextResponse.json({ error: 'File not found on storage' }, { status: 404 })
      const type = file.fileType && INLINE.has(file.fileType) ? file.fileType : 'application/octet-stream'
      return new NextResponse(new Uint8Array(obj.buffer), {
        headers: {
          'Content-Type': type,
          'Content-Disposition': type === 'application/octet-stream' ? `attachment; filename="${encodeURIComponent(file.fileName)}"` : 'inline',
          'Content-Length': String(obj.buffer.length),
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    })
  } catch (error) {
    logError('api/pharmacy/prescriptions/[id]/attachments/[fileId]', error)
    return NextResponse.json({ error: 'Failed to load the image' }, { status: 500 })
  }
}
