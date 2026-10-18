import { NextRequest, NextResponse } from 'next/server'
import { cdnUrl } from '@/lib/files'

/**
 * Backward compatibility for old /uploads/... URLs.
 * Redirects to CDN URL on Cloudflare R2.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await params
  const filePath = segments.join('/')

  // Reject path traversal
  if (filePath.includes('..')) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // Redirect to CDN URL (R2 public domain)
  const url = cdnUrl(filePath)
  return NextResponse.redirect(url, 301)
}
