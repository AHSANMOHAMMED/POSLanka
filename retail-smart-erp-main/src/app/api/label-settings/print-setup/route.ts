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
import { applyPrintSetupChange, sanitizePrintSetup } from '@/lib/labels/print-setup'

const LABEL_SETTINGS_KEY = 'label_settings'

const bodySchema = z.object({
  action: z.enum(['save', 'lock', 'unlock']).optional(),
  printSetup: z.unknown().optional(),
})

function parse(value: string | null | undefined): Record<string, unknown> {
  try {
    const v = value ? JSON.parse(value) : {}
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch {
    return {}
  }
}

type SessionUser = { role: string; tenantId: string; customRoleId?: string | null; name?: string | null; fullName?: string | null }

const canManage = (u: SessionUser) => hasPermission(u.role, 'manageSettings', u.tenantId, u.customRoleId)

// GET the shop's label print setup (printer, roll, layout, element tweaks, lock). null = never saved.
export async function GET() {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const u = session.user as unknown as SessionUser
    return await withTenant(session.user.tenantId, async (db) => {
      const row = await db.query.settings.findFirst({ where: eq(settings.key, LABEL_SETTINGS_KEY) })
      const stored = parse(row?.value).printSetup
      return NextResponse.json({ printSetup: stored ? sanitizePrintSetup(stored) : null, canManage: canManage(u) })
    })
  } catch (error) {
    logError('api/label-settings/print-setup', error)
    return NextResponse.json({ error: 'Failed to load the label setup' }, { status: 500 })
  }
}

/**
 * PUT { action: 'save' | 'lock' | 'unlock', printSetup }.
 * Owners / managers (manageSettings) only. A locked setup cannot be saved
 * (409) until it is unlocked; other users get 403.
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const u = session.user as unknown as SessionUser
    const parsed = await validateBody(request, bodySchema)
    if (!parsed.success) return parsed.response
    const action = parsed.data.action ?? 'save'

    return await withTenant(session.user.tenantId, async (db) => {
      const row = await db.query.settings.findFirst({ where: eq(settings.key, LABEL_SETTINGS_KEY) })
      const stored = parse(row?.value)
      const prev = stored.printSetup ? sanitizePrintSetup(stored.printSetup) : null
      const res = applyPrintSetupChange(prev, parsed.data.printSetup, action, {
        canManage: canManage(u),
        name: u.fullName || u.name || 'manager',
      })
      if (res.status !== 200) return NextResponse.json({ error: res.error, printSetup: prev }, { status: res.status })

      // keep the code word / sticker setups stored in the same row
      const value = JSON.stringify({ ...stored, printSetup: res.setup })
      if (row) {
        await db.update(settings).set({ value, updatedAt: new Date() }).where(eq(settings.id, row.id))
      } else {
        await db.insert(settings).values({ tenantId: session.user.tenantId, key: LABEL_SETTINGS_KEY, value, type: 'json' })
      }
      logAndBroadcast(session.user.tenantId, 'settings', 'updated', LABEL_SETTINGS_KEY)
      return NextResponse.json({ printSetup: res.setup, canManage: true })
    })
  } catch (error) {
    logError('api/label-settings/print-setup', error)
    return NextResponse.json({ error: 'Failed to save the label setup' }, { status: 500 })
  }
}
