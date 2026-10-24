import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { authWithCompany } from '@/lib/auth'
import { hasPermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { settings } from '@/lib/db/schema'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation'
import { mergeLockedSetups, sanitizeStickerSetups, stickerSetupsSchema, type StickerSetup } from '@/lib/labels/sticker-stock'

const LABEL_SETTINGS_KEY = 'label_settings'

const bodySchema = z.object({ stickerSetups: stickerSetupsSchema })

function parse(value: string | null | undefined): Record<string, unknown> {
  try {
    const v = value ? JSON.parse(value) : {}
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch {
    return {}
  }
}

// GET sticker stock / label printer setups
export async function GET() {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    return await withTenant(session.user.tenantId, async (db) => {
      const row = await db.query.settings.findFirst({ where: eq(settings.key, LABEL_SETTINGS_KEY) })
      return NextResponse.json({ stickerSetups: sanitizeStickerSetups(parse(row?.value).stickerSetups) })
    })
  } catch (error) {
    logError('api/label-settings/sticker-setups', error)
    return NextResponse.json({ error: 'Failed to load label setups' }, { status: 500 })
  }
}

/**
 * PUT replaces the list. Admins (manageSettings) can do anything, including
 * lock / unlock. Stock staff (manageInventory) can add and calibrate unlocked
 * setups but cannot change, remove or lock locked ones.
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const u = session.user as unknown as { role: string; tenantId: string; customRoleId?: string | null; name?: string | null; fullName?: string | null }
    const isAdmin = hasPermission(u.role, 'manageSettings', u.tenantId, u.customRoleId)
    const canCalibrate = isAdmin || hasPermission(u.role, 'manageInventory', u.tenantId, u.customRoleId)
    if (!canCalibrate) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const parsed = await validateBody(request, bodySchema)
    if (!parsed.success) return parsed.response
    let next = sanitizeStickerSetups(parsed.data.stickerSetups)

    return await withTenant(session.user.tenantId, async (db) => {
      const row = await db.query.settings.findFirst({ where: eq(settings.key, LABEL_SETTINGS_KEY) })
      const stored = parse(row?.value)
      const prev = sanitizeStickerSetups(stored.stickerSetups)
      const prevById = new Map(prev.map((s) => [s.id, s]))

      if (!isAdmin) {
        const merged = mergeLockedSetups(prev, next)
        if (merged.blocked) return NextResponse.json({ error: 'A locked label setup can only be changed by an admin' }, { status: 403 })
        if (merged.list.some((s) => s.locked && !prevById.get(s.id)?.locked)) {
          return NextResponse.json({ error: 'Only an admin can lock a label setup' }, { status: 403 })
        }
        next = merged.list
      }

      // Stamp who locked a setup and when
      const who = u.fullName || u.name || 'admin'
      next = next.map((s): StickerSetup => {
        const old = prevById.get(s.id)
        if (s.locked && !old?.locked) return { ...s, lockedBy: who, lockedAt: new Date().toISOString() }
        if (s.locked && old?.locked) return { ...s, lockedBy: old.lockedBy ?? who, lockedAt: old.lockedAt ?? null }
        return { ...s, lockedBy: null, lockedAt: null }
      })

      const value = JSON.stringify({ ...stored, stickerSetups: next })
      if (row) {
        await db.update(settings).set({ value, updatedAt: new Date() }).where(eq(settings.id, row.id))
      } else {
        await db.insert(settings).values({ tenantId: session.user.tenantId, key: LABEL_SETTINGS_KEY, value, type: 'json' })
      }
      logAndBroadcast(session.user.tenantId, 'settings', 'updated', LABEL_SETTINGS_KEY)
      return NextResponse.json({ stickerSetups: next })
    })
  } catch (error) {
    logError('api/label-settings/sticker-setups', error)
    return NextResponse.json({ error: 'Failed to save label setups' }, { status: 500 })
  }
}
