import { NextRequest, NextResponse } from 'next/server'
import { cdnUrl, isS3Configured } from '@/lib/files'
import fs from 'fs'
import path from 'path'

/**
 * Serves local uploads from public/uploads or redirects to CDN URL on S3/R2.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await params
  const filePath = segments.join('/')

  // Reject path traversal
  if (filePath.includes('..') || filePath.includes('\0')) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // 1. Check if the file exists on local disk in public/uploads/
  const localFile = path.join(process.cwd(), 'public', 'uploads', filePath)
  if (fs.existsSync(localFile)) {
    try {
      const fileBuffer = await fs.promises.readFile(localFile)
      const ext = path.extname(localFile).toLowerCase()
      const mimeTypes: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.gif': 'image/gif',
        '.pdf': 'application/pdf',
        '.txt': 'text/plain',
        '.json': 'application/json',
      }
      const contentType = mimeTypes[ext] || 'application/octet-stream'
      return new NextResponse(fileBuffer, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      })
    } catch {
      // Fall through if read fails
    }
  }

  // 2. If S3/R2 is configured, redirect to CDN URL
  if (isS3Configured()) {
    const url = cdnUrl(filePath)
    if (url && !url.startsWith('/uploads/')) {
      return NextResponse.redirect(url, 301)
    }
  }

  // 3. Fallback for images: return a 1x1 transparent PNG so Next.js Image component doesn't error
  const ext = path.extname(filePath).toLowerCase()
  if (['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif'].includes(ext)) {
    const TRANSPARENT_PNG = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    )
    return new NextResponse(TRANSPARENT_PNG, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-cache',
      },
    })
  }

  return NextResponse.json({ error: 'File not found' }, { status: 404 })
}
