import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { settings } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation'
import { updateLabelSettingsSchema } from '@/lib/validation/schemas/label-templates'

const LABEL_SETTINGS_KEY = 'label_settings'

const DEFAULT_LABEL_SETTINGS = { codeWord: '' }

// GET label settings (code word for price encoding)
export async function GET() {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    return await withTenant(session.user.tenantId, async (db) => {
      const result = await db.query.settings.findFirst({
        where: eq(settings.key, LABEL_SETTINGS_KEY),
      })

      if (result?.value) {
        try {
          const parsed = JSON.parse(result.value)
          return NextResponse.json({
            ...DEFAULT_LABEL_SETTINGS,
            ...parsed,
          })
        } catch {
          return NextResponse.json(DEFAULT_LABEL_SETTINGS)
        }
      }

      return NextResponse.json(DEFAULT_LABEL_SETTINGS)
    })
  } catch (error) {
    logError('api/label-settings', error)
    return NextResponse.json({ error: 'Failed to fetch label settings' }, { status: 500 })
  }
}

// PUT update label settings
export async function PUT(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageSettings')
    if (permError) return permError

    const parsed = await validateBody(request, updateLabelSettingsSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data

    // Sanitize codeWord: uppercase letters only, max 10, no duplicates
    const codeWord = (body.codeWord || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 10)
    // Remove duplicate letters (keep first occurrence)
    const uniqueCodeWord = [...new Set(codeWord)].join('')

    const newSettings = { codeWord: uniqueCodeWord }

    return await withTenant(session.user.tenantId, async (db) => {
      const existing = await db.query.settings.findFirst({
        where: eq(settings.key, LABEL_SETTINGS_KEY),
      })

      if (existing) {
        await db.update(settings)
          .set({
            value: JSON.stringify(newSettings),
            updatedAt: new Date(),
          })
          .where(eq(settings.id, existing.id))
      } else {
        await db.insert(settings).values({
          tenantId: session.user.tenantId,
          key: LABEL_SETTINGS_KEY,
          value: JSON.stringify(newSettings),
          type: 'json',
        })
      }

      logAndBroadcast(session.user.tenantId, 'settings', 'updated', LABEL_SETTINGS_KEY)

      return NextResponse.json(newSettings)
    })
  } catch (error) {
    logError('api/label-settings', error)
    return NextResponse.json({ error: 'Failed to update label settings' }, { status: 500 })
  }
}
