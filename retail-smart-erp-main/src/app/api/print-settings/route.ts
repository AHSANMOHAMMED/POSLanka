import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { settings } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { DEFAULT_PRINT_SETTINGS, DocumentPrintSettings, PrintSettings, MAX_MARGIN, MAX_COPIES } from '@/lib/print/types'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation'
import { updatePrintSettingsSchema } from '@/lib/validation/schemas/users'

const PRINT_SETTINGS_KEY = 'print_settings'

// GET print settings
export async function GET() {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      const result = await db.query.settings.findFirst({
        where: eq(settings.key, PRINT_SETTINGS_KEY),
      })

      if (result?.value) {
        try {
          const parsed = JSON.parse(result.value) as DocumentPrintSettings
          // Merge with defaults to ensure all fields exist
          return NextResponse.json({
            ...DEFAULT_PRINT_SETTINGS,
            ...parsed,
          })
        } catch {
          return NextResponse.json(DEFAULT_PRINT_SETTINGS)
        }
      }

      return NextResponse.json(DEFAULT_PRINT_SETTINGS)
    })
  } catch (error) {
    logError('api/print-settings', error)
    return NextResponse.json({ error: 'Failed to fetch print settings' }, { status: 500 })
  }
}

// PUT update print settings
export async function PUT(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageSettings')
    if (permError) return permError

    const parsed = await validateBody(request, updatePrintSettingsSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data as Partial<DocumentPrintSettings>

    // Validate and clamp settings
    function validateSettings(s: PrintSettings): PrintSettings {
      return {
        ...s,
        copies: Math.max(1, Math.min(MAX_COPIES, s.copies || 1)),
        margins: {
          top: Math.max(0, Math.min(MAX_MARGIN, s.margins?.top ?? 10)),
          right: Math.max(0, Math.min(MAX_MARGIN, s.margins?.right ?? 10)),
          bottom: Math.max(0, Math.min(MAX_MARGIN, s.margins?.bottom ?? 10)),
          left: Math.max(0, Math.min(MAX_MARGIN, s.margins?.left ?? 10)),
        },
      }
    }

    // Merge with defaults and validate each document type
    const merged = { ...DEFAULT_PRINT_SETTINGS, ...body }
    const newSettings: DocumentPrintSettings = {
      receipt: validateSettings(merged.receipt),
      work_order: validateSettings(merged.work_order),
      estimate: validateSettings(merged.estimate),
      invoice: validateSettings(merged.invoice),
      purchase_order: validateSettings(merged.purchase_order),
      purchase_invoice: validateSettings(merged.purchase_invoice),
      stock_transfer: validateSettings(merged.stock_transfer),
      sales_order: validateSettings(merged.sales_order),
    }

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Check if settings exist (RLS scopes to tenant)
      const existing = await db.query.settings.findFirst({
        where: eq(settings.key, PRINT_SETTINGS_KEY),
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
          key: PRINT_SETTINGS_KEY,
          value: JSON.stringify(newSettings),
          type: 'json',
        })
      }

      // Broadcast settings update
      logAndBroadcast(session.user.tenantId, 'settings', 'updated', PRINT_SETTINGS_KEY)

      return NextResponse.json(newSettings)
    })
  } catch (error) {
    logError('api/print-settings', error)
    return NextResponse.json({ error: 'Failed to update print settings' }, { status: 500 })
  }
}
