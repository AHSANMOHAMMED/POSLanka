import { NextRequest, NextResponse } from 'next/server'
import { withTenant, withAuthTenant } from '@/lib/db'
import { authWithCompany } from '@/lib/auth'
import { tenants } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { uploadToR2, deleteFromR2, keyFromUrl } from '@/lib/files'
import { requireQuota, adjustFileStorage } from '@/lib/db/storage-quota'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { requirePermission } from '@/lib/auth/roles'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('logo') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Validate file type
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: 'Invalid file type. Allowed: PNG, JPEG, WebP' }, { status: 400 })
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large. Maximum 2MB' }, { status: 400 })
    }

    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageSettings')
    if (permError) return permError

    const quotaError = await requireQuota(session.user.tenantId, 'file')
    if (quotaError) return quotaError

    const result = await withTenant(session.user.tenantId, async (db) => {

      const ext = file.name.split('.').pop() || 'png'

      // Delete old logo from R2 if exists
      const oldLogo = await db.query.tenants.findFirst({
        where: eq(tenants.id, session.user.tenantId),
        columns: { logoUrl: true, logoSize: true }
      })

      const oldSize = oldLogo?.logoSize || 0
      if (oldLogo?.logoUrl) {
        const oldKey = keyFromUrl(oldLogo.logoUrl)
        if (oldKey) {
          try { await deleteFromR2(oldKey) } catch { /* ignore */ }
        }
      }

      const bytes = await file.arrayBuffer()
      const buffer = Buffer.from(bytes)
      const r2Key = `logos/${session.user.tenantId}.${ext}`
      const logoUrl = await uploadToR2(r2Key, buffer, file.type)

      // Update tenant logoUrl and size
      await db.update(tenants)
        .set({ logoUrl, logoSize: buffer.length })
        .where(eq(tenants.id, session.user.tenantId))

      // Track file storage change (logos bypass files table) - delta = new - old
      adjustFileStorage(session.user.tenantId, buffer.length - oldSize).catch(() => {})

      logAndBroadcast(session.user.tenantId, 'settings', 'updated', session.user.tenantId, { userId: session.user.id })
      return { logoUrl }
    })

    if (result === null) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    return NextResponse.json(result)
  } catch (error) {
    logError('api/settings/logo', error)
    return NextResponse.json({ error: 'Failed to upload logo' }, { status: 500 })
  }
}

export async function DELETE() {
  try {
    const result = await withAuthTenant(async (session, db) => {
      // Only settings managers can delete logo
      const permError = requirePermission(session, 'manageSettings')
      if (permError) return { error: permError }

      // Get current logo URL and size
      const tenant = await db.query.tenants.findFirst({
        where: eq(tenants.id, session.user.tenantId),
        columns: { logoUrl: true, logoSize: true }
      })

      if (tenant?.logoUrl) {
        const key = keyFromUrl(tenant.logoUrl)
        if (key) {
          try { await deleteFromR2(key) } catch { /* ignore */ }
        }
      }

      // Clear logoUrl and size in database
      await db.update(tenants)
        .set({ logoUrl: null, logoSize: null })
        .where(eq(tenants.id, session.user.tenantId))

      // Subtract logo from file storage counter
      if (tenant?.logoSize) {
        adjustFileStorage(session.user.tenantId, -tenant.logoSize).catch(() => {})
      }

      return { success: true }
    })

    if (result === null) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if ('error' in result) {
      return result.error // NextResponse from requirePermission
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    logError('api/settings/logo', error)
    return NextResponse.json({ error: 'Failed to remove logo' }, { status: 500 })
  }
}
