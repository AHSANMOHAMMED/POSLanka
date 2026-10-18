import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { files } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getFromR2, keyFromUrl, cdnUrl } from '@/lib/files'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET lightweight thumbnail endpoint — no audit logging, aggressive caching
// Serves pre-generated thumbnail when available, falls back to original file
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const file = await db.query.files.findFirst({
        where: eq(files.id, id),
        columns: {
          id: true,
          fileName: true,
          fileUrl: true,
          fileType: true,
          isPrivate: true,
          isFolder: true,
          contentHash: true,
          thumbnailUrl: true,
        },
      })

      if (!file) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 })
      }

      if (file.isFolder) {
        return NextResponse.json({ error: 'Cannot view a folder' }, { status: 400 })
      }

      // ETag support — skip re-download if browser already has this version
      const etag = file.contentHash ? `"thumb-${file.contentHash}"` : null
      if (etag) {
        const ifNoneMatch = request.headers.get('if-none-match')
        if (ifNoneMatch === etag) {
          return new NextResponse(null, { status: 304, headers: { ETag: etag } })
        }
      }

      // Determine which URL to serve: thumbnail (small) or original (fallback)
      const serveUrl = file.thumbnailUrl || file.fileUrl

      // For public files with CDN URL, redirect (browser caches the redirect target)
      if (!file.isPrivate && serveUrl.startsWith('http')) {
        const headers: Record<string, string> = {
          'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        }
        if (etag) headers['ETag'] = etag
        return NextResponse.redirect(serveUrl, { headers })
      }

      // For public files with legacy local path
      if (!file.isPrivate && serveUrl.startsWith('/uploads/')) {
        const key = keyFromUrl(serveUrl)
        if (key) {
          return NextResponse.redirect(cdnUrl(key))
        }
      }

      // For private files, stream from R2
      const key = keyFromUrl(serveUrl)
      if (!key) {
        return NextResponse.json({ error: 'File not found on storage' }, { status: 404 })
      }

      const r2File = await getFromR2(key)
      if (!r2File) {
        // If thumbnail not found in R2, fall back to original
        if (file.thumbnailUrl && serveUrl === file.thumbnailUrl) {
          const origKey = keyFromUrl(file.fileUrl)
          if (origKey) {
            const origFile = await getFromR2(origKey)
            if (origFile) {
              const headers: Record<string, string> = {
                'Content-Type': file.fileType || origFile.contentType,
                'Content-Disposition': 'inline',
                'Content-Length': String(origFile.buffer.length),
                'Cache-Control': 'private, max-age=86400, stale-while-revalidate=604800',
              }
              if (etag) headers['ETag'] = etag
              return new NextResponse(new Uint8Array(origFile.buffer), { headers })
            }
          }
        }
        return NextResponse.json({ error: 'File not found on storage' }, { status: 404 })
      }

      const headers: Record<string, string> = {
        'Content-Type': file.thumbnailUrl ? 'image/jpeg' : (file.fileType || r2File.contentType),
        'Content-Disposition': 'inline',
        'Content-Length': String(r2File.buffer.length),
        'Cache-Control': 'private, max-age=86400, stale-while-revalidate=604800',
      }
      if (etag) headers['ETag'] = etag

      return new NextResponse(new Uint8Array(r2File.buffer), { headers })
    })
  } catch {
    return NextResponse.json({ error: 'Failed to load thumbnail' }, { status: 500 })
  }
}
