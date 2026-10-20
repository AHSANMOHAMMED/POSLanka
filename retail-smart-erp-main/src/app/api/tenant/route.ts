import { NextRequest, NextResponse } from 'next/server'
import { normalizeScaleConfig, type ScaleBarcodeConfig } from '@/lib/inventory/barcode-parse'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { tenants } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation'
import { updateTenantSchema } from '@/lib/validation/schemas/users'
import { resolveReceiptSettings, sanitizeReceiptSettingsPatch } from '@/lib/print/receipt-settings'

// GET tenant settings (tax rate, currency, etc.)
export async function GET() {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    return await withTenant(session.user.tenantId, async (db) => {
      const tenant = await db.query.tenants.findFirst({
        where: eq(tenants.id, session.user.tenantId),
        columns: {
          id: true,
          name: true,
          businessType: true,
          currency: true,
          country: true,
          taxRate: true,
          taxInclusive: true,
          timezone: true,
          aiEnabled: true,
          aiConsentAcceptedAt: true,
          phone: true,
          address: true,
          email: true,
          settings: true,
          legalName: true,
          taxId: true,
          brn: true,
          website: true,
          logoUrl: true,
          receiptSettings: true,
        },
      })

      if (!tenant) {
        return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
      }

      const { settings, receiptSettings, ...rest } = tenant
      const scaleBarcode = normalizeScaleConfig(((settings || {}) as { scaleBarcode?: Partial<ScaleBarcodeConfig> }).scaleBarcode)
      // receiptSettings = tenant-level effective settings (defaults merged in);
      // receiptSettingsRaw = what is actually stored (for editors).
      return NextResponse.json({
        ...rest,
        scaleBarcode,
        receiptSettings: resolveReceiptSettings(receiptSettings),
        receiptSettingsRaw: sanitizeReceiptSettingsPatch(receiptSettings),
      })
    })
  } catch (error) {
    logError('api/tenant', error)
    return NextResponse.json({ error: 'Failed to fetch tenant settings' }, { status: 500 })
  }
}

// PUT update tenant settings (business type for testing)
export async function PUT(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageSettings')
    if (permError) return permError

    const parsed = await validateBody(request, updateTenantSchema)
    if (!parsed.success) return parsed.response
    const { businessType, timezone, aiEnabled, taxRate, taxInclusive, scaleBarcode } = parsed.data
    const { name, legalName, address, phone, email, website, taxId, brn, receiptSettings } = parsed.data

    // Build update data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: Record<string, any> = { updatedAt: new Date() }

    if (businessType !== undefined) {
      updateData.businessType = businessType
    }

    if (timezone !== undefined) {
      // Validate timezone using Intl API
      try {
        Intl.DateTimeFormat(undefined, { timeZone: timezone })
      } catch {
        return NextResponse.json({ error: 'Invalid timezone' }, { status: 400 })
      }
      updateData.timezone = timezone
    }

    if (taxRate !== undefined) {
      updateData.taxRate = String(taxRate)
    }

    if (taxInclusive !== undefined) {
      updateData.taxInclusive = taxInclusive
    }

    if (aiEnabled !== undefined) {
      updateData.aiEnabled = !!aiEnabled
      // Record consent timestamp when enabling AI for the first time
      if (aiEnabled) {
        const tenant = await withTenant(session.user.tenantId, async (db) => {
          return db.query.tenants.findFirst({
            where: eq(tenants.id, session.user.tenantId),
            columns: { aiConsentAcceptedAt: true },
          })
        })
        if (!tenant?.aiConsentAcceptedAt) {
          updateData.aiConsentAcceptedAt = new Date()
        }
      }
    }

    if (scaleBarcode) {
      const current = await withTenant(session.user.tenantId, async (db) =>
        db.query.tenants.findFirst({ where: eq(tenants.id, session.user.tenantId), columns: { settings: true } })
      )
      const settings = { ...((current?.settings || {}) as Record<string, unknown>) }
      settings.scaleBarcode = normalizeScaleConfig(scaleBarcode)
      updateData.settings = settings
    }

    // Business profile fields (empty string clears optional ones)
    if (name !== undefined) updateData.name = name
    if (email !== undefined) updateData.email = email
    if (legalName !== undefined) updateData.legalName = legalName || null
    if (address !== undefined) updateData.address = address || null
    if (phone !== undefined) updateData.phone = phone || null
    if (website !== undefined) updateData.website = website || null
    if (taxId !== undefined) updateData.taxId = taxId || null
    if (brn !== undefined) updateData.brn = brn || null
    if (receiptSettings !== undefined) {
      // Merge onto stored settings so partial updates don't wipe other keys.
      const current = await withTenant(session.user.tenantId, async (db) =>
        db.query.tenants.findFirst({ where: eq(tenants.id, session.user.tenantId), columns: { receiptSettings: true } })
      )
      updateData.receiptSettings = { ...sanitizeReceiptSettingsPatch(current?.receiptSettings), ...receiptSettings }
    }

    if (Object.keys(updateData).length <= 1) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    // Note: tenants table doesn't have RLS, but we use withTenant for consistency
    // and to ensure proper connection handling
    return await withTenant(session.user.tenantId, async (db) => {
      await db.update(tenants)
        .set(updateData)
        .where(eq(tenants.id, session.user.tenantId))

      // Broadcast tenant settings update
      logAndBroadcast(session.user.tenantId, 'tenant', 'updated', session.user.tenantId, { userId: session.user.id })

      return NextResponse.json({ success: true, ...updateData })
    })
  } catch (error) {
    logError('api/tenant', error)
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 })
  }
}
