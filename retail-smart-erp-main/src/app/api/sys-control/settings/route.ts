import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { systemSettings } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { adminAudit, withRateLimit, validateAdminSession } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation/helpers'
import { sysUpdateSettingSchema } from '@/lib/validation/schemas/sys-control'

// GET /api/sys-control/settings - Get all system settings
export async function GET(request: NextRequest) {
  try {
    const rateLimited = await withRateLimit('/api/sys-control/settings')
    if (rateLimited) return rateLimited

    const session = await validateAdminSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const key = searchParams.get('key')

    if (key) {
      // PayHere status is derived from env vars, not stored in DB
      if (key === 'payhere_status') {
        const configured = !!(process.env.PAYHERE_MERCHANT_ID && process.env.PAYHERE_MERCHANT_SECRET)
        return NextResponse.json({
          key: 'payhere_status',
          value: {
            configured,
            sandbox: process.env.PAYHERE_SANDBOX === 'true',
          },
        })
      }

      const setting = await db.query.systemSettings.findFirst({
        where: eq(systemSettings.key, key),
      })
      return NextResponse.json(setting || { key, value: {} })
    }

    const settings = await db.query.systemSettings.findMany()
    return NextResponse.json(settings)
  } catch (error) {
    logError('api/sys-control/settings', error)
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 })
  }
}

// PUT /api/sys-control/settings - Update a setting
export async function PUT(request: NextRequest) {
  try {
    const rateLimited = await withRateLimit('/api/sys-control/settings')
    if (rateLimited) return rateLimited

    const session = await validateAdminSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await validateBody(request, sysUpdateSettingSchema)
    if (!parsed.success) return parsed.response
    const { key, value, description } = parsed.data

    // Check if setting exists
    const existing = await db.query.systemSettings.findFirst({
      where: eq(systemSettings.key, key),
    })

    let result
    if (existing) {
      // Update existing (updatedBy is null for super admin updates - they're in a separate table)
      const [updated] = await db.update(systemSettings)
        .set({
          value,
          description: description || existing.description,
          updatedAt: new Date(),
        })
        .where(eq(systemSettings.key, key))
        .returning()
      result = updated
    } else {
      // Create new
      const [created] = await db.insert(systemSettings)
        .values({
          key,
          value,
          description,
        })
        .returning()
      result = created
    }

    // Audit log
    await adminAudit.update(session.superAdminId, 'setting', result.id, { key })

    return NextResponse.json(result)
  } catch (error) {
    logError('api/sys-control/settings', error)
    return NextResponse.json({ error: 'Failed to update setting' }, { status: 500 })
  }
}
