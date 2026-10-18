import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { items } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { uploadToR2, deleteFromR2, keyFromUrl } from '@/lib/files'
import { requireQuota, adjustFileStorage } from '@/lib/db/storage-quota'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
const MAX_SIZE = 5 * 1024 * 1024 // 5MB

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageItems')
    if (permError) return permError

    const quotaError = await requireQuota(session!.user.tenantId, 'file')
    if (quotaError) return quotaError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id: itemId } = paramsParsed.data
    const formData = await request.formData()
    const file = formData.get('image') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'Invalid file type. Allowed: PNG, JPEG, WebP' }, { status: 400 })
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'File too large. Maximum 5MB' }, { status: 400 })
    }

    return await withTenant(session!.user.tenantId, async (db) => {
      // Verify item exists
      const item = await db.query.items.findFirst({
        where: eq(items.id, itemId),
        columns: { id: true, imageUrl: true, imageSize: true },
      })

      if (!item) {
        return NextResponse.json({ error: 'Item not found' }, { status: 404 })
      }

      // Delete old image from R2 if exists
      const oldSize = item.imageSize || 0
      if (item.imageUrl) {
        const oldKey = keyFromUrl(item.imageUrl)
        if (oldKey) {
          try { await deleteFromR2(oldKey) } catch { /* ignore */ }
        }
      }

      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const bytes = await file.arrayBuffer()
      const buffer = Buffer.from(bytes)
      const r2Key = `items/${session!.user.tenantId}/${itemId}.${ext}`
      const imageUrl = await uploadToR2(r2Key, buffer, file.type)

      // Update item imageUrl
      await db.update(items)
        .set({ imageUrl, imageSize: buffer.length, updatedAt: new Date() })
        .where(eq(items.id, itemId))

      // Track file storage change (item images bypass files table)
      adjustFileStorage(session!.user.tenantId, buffer.length - oldSize).catch(() => {})

      logAndBroadcast(session!.user.tenantId, 'item', 'updated', itemId, { userId: session!.user.id })

      return NextResponse.json({ imageUrl })
    })
  } catch (error) {
    logError('api/items/[id]/image', error)
    return NextResponse.json({ error: 'Failed to upload image' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageItems')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id: itemId } = paramsParsed.data

    return await withTenant(session!.user.tenantId, async (db) => {
      const item = await db.query.items.findFirst({
        where: eq(items.id, itemId),
        columns: { id: true, imageUrl: true, imageSize: true },
      })

      if (!item) {
        return NextResponse.json({ error: 'Item not found' }, { status: 404 })
      }

      if (item.imageUrl) {
        const key = keyFromUrl(item.imageUrl)
        if (key) {
          try { await deleteFromR2(key) } catch { /* ignore */ }
        }
      }

      await db.update(items)
        .set({ imageUrl: null, imageSize: null, updatedAt: new Date() })
        .where(eq(items.id, itemId))

      // Subtract file storage (item images bypass files table)
      if (item.imageSize) {
        adjustFileStorage(session!.user.tenantId, -item.imageSize).catch(() => {})
      }

      logAndBroadcast(session!.user.tenantId, 'item', 'updated', itemId, { userId: session!.user.id })

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/items/[id]/image', error)
    return NextResponse.json({ error: 'Failed to remove image' }, { status: 500 })
  }
}
