import { NextResponse } from 'next/server'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { notificationTemplates } from '@/lib/db/schema'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation'
import { getVendorTemplates } from '@/lib/messaging/service'
import {
  DEFAULT_TEXTS, MAX_TEMPLATE_LENGTH, MESSAGE_PURPOSES, PURPOSE_LABELS, PURPOSE_VARIABLES, TEMPLATE_TRIGGER_PREFIX, type MessagePurpose,
} from '@/lib/messaging/templates'

/** GET /api/messaging/templates — the text of each message (the business's own or the default). */
export async function GET() {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const perm = requirePermission(session, 'manageSettings')
    if (perm) return perm
    const custom = await getVendorTemplates(session.user.tenantId)
    return NextResponse.json({
      templates: MESSAGE_PURPOSES.map((p) => ({
        purpose: p, label: PURPOSE_LABELS[p], variables: PURPOSE_VARIABLES[p],
        text: custom[p] ?? DEFAULT_TEXTS[p], defaultText: DEFAULT_TEXTS[p], custom: !!custom[p],
      })),
    })
  } catch (error) {
    logError('api/messaging/templates GET', error)
    return NextResponse.json({ error: 'Failed to load templates' }, { status: 500 })
  }
}

const putSchema = z.object({
  purpose: z.enum(MESSAGE_PURPOSES),
  /** '' = go back to the default text */
  text: z.string().trim().max(MAX_TEMPLATE_LENGTH, `Keep it under ${MAX_TEMPLATE_LENGTH} characters`),
})

/** PUT /api/messaging/templates — save (or reset with text '') one message text. */
export async function PUT(request: Request) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const perm = requirePermission(session, 'manageSettings')
    if (perm) return perm
    const parsed = await validateBody(request, putSchema, { keepEmptyStrings: true })
    if (!parsed.success) return parsed.response
    const { purpose, text } = parsed.data
    const unknown = [...text.matchAll(/\{\{\s*([a-zA-Z]+)\s*\}\}/g)].map((m) => m[1]).filter((v) => !PURPOSE_VARIABLES[purpose as MessagePurpose].includes(v))
    if (unknown.length) return NextResponse.json({ error: `Unknown placeholder ${unknown.map((u) => `{{${u}}}`).join(', ')}. Use: ${PURPOSE_VARIABLES[purpose].map((v) => `{{${v}}}`).join(' ')}` }, { status: 400 })

    const tenantId = session.user.tenantId
    const trigger = `${TEMPLATE_TRIGGER_PREFIX}${purpose}`
    await withTenant(tenantId, async (tdb) => {
      const where = and(eq(notificationTemplates.tenantId, tenantId), eq(notificationTemplates.triggerEvent, trigger))
      if (!text) {
        await tdb.delete(notificationTemplates).where(where)
        return
      }
      const [existing] = await tdb.select({ id: notificationTemplates.id }).from(notificationTemplates).where(where).limit(1)
      if (existing) {
        await tdb.update(notificationTemplates).set({ smsContent: text, isActive: true, updatedAt: new Date() }).where(eq(notificationTemplates.id, existing.id))
      } else {
        await tdb.insert(notificationTemplates).values({
          tenantId, name: PURPOSE_LABELS[purpose], channel: 'sms', triggerEvent: trigger, isAutoTrigger: false,
          smsContent: text, isActive: true, createdBy: session.user.id,
        })
      }
    })
    return NextResponse.json({ purpose, text: text || DEFAULT_TEXTS[purpose], custom: !!text })
  } catch (error) {
    logError('api/messaging/templates PUT', error)
    return NextResponse.json({ error: 'Failed to save the template' }, { status: 500 })
  }
}
