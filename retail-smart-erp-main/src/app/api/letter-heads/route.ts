import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant } from '@/lib/db'
import { letterHeads } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { requirePermission } from '@/lib/auth/roles'
import { validateBody } from '@/lib/validation'
import { createLetterHeadSchema } from '@/lib/validation/schemas/settings'

export async function GET() {
  const result = await withAuthTenant(async (session, db) => {
    return db.select().from(letterHeads)
      .where(eq(letterHeads.tenantId, session.user.tenantId))
      .orderBy(desc(letterHeads.createdAt))
  })

  if (result === null) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json(result)
}

export async function POST(request: NextRequest) {
  try {
    const parsed = await validateBody(request, createLetterHeadSchema)
    if (!parsed.success) return parsed.response
    const { name, headerHtml, footerHtml, headerImage, footerImage, headerHeight, footerHeight, alignment, isDefault } = parsed.data

    const result = await withAuthTenant(async (session, db) => {
      const permError = requirePermission(session, 'manageSettings')
      if (permError) return { error: permError }

      const quotaError = await requireQuota(session.user.tenantId, 'standard')
      if (quotaError) return quotaError

      // If setting as default, unset other defaults
      if (isDefault) {
        await db.update(letterHeads)
          .set({ isDefault: false })
          .where(eq(letterHeads.tenantId, session.user.tenantId))
      }

      const [created] = await db.insert(letterHeads).values({
        tenantId: session.user.tenantId,
        name,
        headerHtml: headerHtml || null,
        footerHtml: footerHtml || null,
        headerImage: headerImage || null,
        footerImage: footerImage || null,
        headerHeight,
        footerHeight,
        alignment,
        isDefault,
      }).returning()

      logAndBroadcast(session.user.tenantId, 'letter-head', 'created', created.id, { userId: session.user.id, entityName: created.name })
      return created
    })

    if (result === null) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    logError('api/letter-heads', error)
    return NextResponse.json({ error: 'Failed to create letter head' }, { status: 500 })
  }
}
