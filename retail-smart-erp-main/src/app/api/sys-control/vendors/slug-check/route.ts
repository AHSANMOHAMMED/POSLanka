import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { adminAuthError, validateAdminSession } from '@/lib/admin'
import { validateSearchParams } from '@/lib/validation'
import { checkSlugAvailability } from '@/lib/admin/vendor-slug'
import { logError } from '@/lib/ai/error-logger'

const schema = z.object({ slug: z.string().trim().toLowerCase().max(60) })

// GET /api/sys-control/vendors/slug-check?slug=sunrise-foods — live availability for the create wizard
export async function GET(request: NextRequest) {
  try {
    const session = await validateAdminSession('read')
    if (!session) return adminAuthError()
    const parsed = validateSearchParams(request, schema)
    if (!parsed.success) return parsed.response
    return NextResponse.json({ slug: parsed.data.slug, ...(await checkSlugAvailability(parsed.data.slug)) })
  } catch (error) {
    logError('api/sys-control/vendors/slug-check', error)
    return NextResponse.json({ error: 'Failed to check address' }, { status: 500 })
  }
}
