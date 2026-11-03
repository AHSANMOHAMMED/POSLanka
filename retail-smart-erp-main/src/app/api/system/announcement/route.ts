import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { systemSettings } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { announcementTextForLocale, normalizeAnnouncement } from '@/lib/admin/announcement'
import { resolveLocale } from '@/lib/i18n/locale'
import { clientIp, consumeRateLimit, rateLimitedResponse } from '@/lib/auth/rate-limit'

const PUBLIC_GET_LIMIT = { maxAttempts: 60, windowMs: 60_000, category: 'system_announcement' }

// GET /api/system/announcement?locale=en|si|ta — public banner for the vendor app
export async function GET(req: NextRequest) {
  try {
    const limit = await consumeRateLimit(clientIp(req), PUBLIC_GET_LIMIT)
    if (limit.limited) return rateLimitedResponse(limit)

    const locale = resolveLocale(req.nextUrl.searchParams.get('locale'))
    const setting = await db.query.systemSettings.findFirst({
      where: eq(systemSettings.key, 'system_announcement'),
    })

    if (!setting || !setting.value) {
      return NextResponse.json({ enabled: false })
    }

    const announcement = normalizeAnnouncement(setting.value)
    const message = announcementTextForLocale(announcement, locale)

    if (!announcement.enabled || !message) {
      return NextResponse.json({ enabled: false })
    }

    return NextResponse.json({
      enabled: true,
      message,
      type: announcement.type,
      showOnLogin: announcement.showOnLogin !== false,
      locale,
      messages: announcement.messages,
    })
  } catch (error) {
    logError('api/system/announcement', error)
    return NextResponse.json({ enabled: false })
  }
}
