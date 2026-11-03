import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { inAppNotifications } from '@/lib/db/schema'
import { validateSearchParams } from '@/lib/validation/helpers'
import { notificationsListSchema } from '@/lib/validation/schemas/notification-alerts'
import { logError } from '@/lib/ai/error-logger'
import { pickLocalizedPair, resolveLocale, type Locale } from '@/lib/i18n/locale'

function localizeRow<T extends { title: string; body: string | null; data?: unknown }>(row: T, locale: Locale): T {
  const data = (row.data && typeof row.data === 'object' ? row.data : {}) as {
    translations?: Partial<Record<Locale, { title?: string; body?: string }>>
  }
  if (!data.translations) return row
  const localized = pickLocalizedPair(data.translations, locale, {
    title: row.title,
    body: row.body || '',
  })
  return { ...row, title: localized.title, body: localized.body }
}

// GET /api/notifications?page=1&pageSize=20&unread=1&locale=en|si|ta — the caller's in-app alert inbox
export async function GET(request: NextRequest) {
  const session = await authWithCompany()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = validateSearchParams(request, notificationsListSchema)
  if (!parsed.success) return parsed.response
  const { page, pageSize, unread } = parsed.data
  const onlyUnread = unread === '1' || unread === 'true'
  const locale = resolveLocale(
    request.nextUrl.searchParams.get('locale')
      || request.headers.get('accept-language')?.split(',')[0],
  )
  const tenantId = session.user.tenantId
  const userId = session.user.id
  try {
    const result = await withTenant(tenantId, async (tdb) => {
      const mine = and(eq(inAppNotifications.tenantId, tenantId), eq(inAppNotifications.userId, userId))
      const where = onlyUnread ? and(mine, isNull(inAppNotifications.readAt)) : mine
      const [list, [counts]] = await Promise.all([
        tdb.select().from(inAppNotifications).where(where)
          .orderBy(desc(inAppNotifications.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
        tdb.select({
          total: sql<number>`count(*)::int`,
          unread: sql<number>`count(*) FILTER (WHERE ${inAppNotifications.readAt} IS NULL)::int`,
        }).from(inAppNotifications).where(mine),
      ])
      return { list, counts }
    })
    const total = onlyUnread ? result.counts.unread : result.counts.total
    return NextResponse.json({
      data: result.list.map((row) => localizeRow(row, locale)),
      unreadCount: result.counts.unread,
      locale,
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    })
  } catch (error) {
    logError('api/notifications GET', error)
    return NextResponse.json({ error: 'Failed to load notifications' }, { status: 500 })
  }
}
