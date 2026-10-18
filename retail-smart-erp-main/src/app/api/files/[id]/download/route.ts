import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { files } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { getFromR2, keyFromUrl } from '@/lib/files'
import { logFileAudit, getRequestMeta } from '@/lib/files'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET download/stream a file (handles private files with auth)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'uploadFiles')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const file = await db.query.files.findFirst({
        where: eq(files.id, id),
      })

      if (!file) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 })
      }

      if (file.isFolder) {
        return NextResponse.json({ error: 'Cannot download a folder' }, { status: 400 })
      }

      // ETag support — skip re-download if browser already has this version
      const etag = file.contentHash ? `"${file.contentHash}"` : null
      if (etag) {
        const ifNoneMatch = request.headers.get('if-none-match')
        if (ifNoneMatch === etag) {
          return new NextResponse(null, { status: 304, headers: { ETag: etag } })
        }
      }

      // Audit log (fire and forget)
      const { ip, userAgent } = getRequestMeta(request)
      logFileAudit({
        tenantId: session.user.tenantId,
        fileId: id,
        userId: session.user.id,
        action: 'downloaded',
        fileName: file.fileName,
        ipAddress: ip,
        userAgent,
      })

      // For public files with CDN URL, redirect
      if (!file.isPrivate && file.fileUrl.startsWith('http')) {
        return NextResponse.redirect(file.fileUrl)
      }

      // For public files with legacy local path, redirect to CDN
      if (!file.isPrivate && file.fileUrl.startsWith('/uploads/')) {
        const key = keyFromUrl(file.fileUrl)
        if (key) {
          const { cdnUrl } = await import('@/lib/files')
          return NextResponse.redirect(cdnUrl(key))
        }
      }

      // For private files, stream from R2
      const key = keyFromUrl(file.fileUrl)
      if (!key) {
        return NextResponse.json({ error: 'File not found on storage' }, { status: 404 })
      }

      const r2File = await getFromR2(key)
      if (!r2File) {
        return NextResponse.json({ error: 'File not found on storage' }, { status: 404 })
      }

      const headers: Record<string, string> = {
        'Content-Type': file.fileType || r2File.contentType,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(file.fileName)}"`,
        'Content-Length': String(r2File.buffer.length),
        'Cache-Control': 'private, max-age=86400',
      }
      if (etag) headers['ETag'] = etag

      return new NextResponse(new Uint8Array(r2File.buffer), { headers })
    })
  } catch (error) {
    logError('api/files/[id]/download', error)
    return NextResponse.json({ error: 'Failed to download file' }, { status: 500 })
  }
}
