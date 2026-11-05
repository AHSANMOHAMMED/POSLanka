import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq } from 'drizzle-orm'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { files, users } from '@/lib/db/schema'
import { logError } from '@/lib/ai/error-logger'
import { validateFile, validateFileContent, storeFile, computeFileHash, deleteStoredFile } from '@/lib/files'
import { requireQuota, invalidateStorageCache } from '@/lib/db/storage-quota'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { loadPrescriptionFor } from '@/lib/pharmacy/prescription-access'
import { requireAnyPermission, UUID_RE } from '@/lib/pharmacy/route-helpers'

/**
 * Photos / scans of a prescription (files table, attached_to_type = 'prescription', stored private:
 * medical records are served only through /api/pharmacy/prescriptions/[id]/attachments/[fileId]).
 *   GET    — list
 *   POST   — multipart `file` (JPEG / PNG / WebP / PDF, up to 10 MB)
 *   DELETE ?attachmentId= — remove one
 */
const ATTACHED_TYPE = 'prescription'
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requireAnyPermission(session, ['createSales', 'viewReports'])
    if (permError) return permError
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    return await withTenant(session.user.tenantId, async (db) => {
      const found = await loadPrescriptionFor(session, db, p.data.id)
      if ('error' in found) return found.error
      const rows = await db.select({
        id: files.id, fileName: files.fileName, fileType: files.fileType, fileSize: files.fileSize, createdAt: files.createdAt, uploadedBy: users.fullName,
      })
        .from(files)
        .leftJoin(users, eq(users.id, files.uploadedBy))
        .where(and(eq(files.tenantId, session.user.tenantId), eq(files.attachedToType, ATTACHED_TYPE), eq(files.attachedToId, p.data.id)))
        .orderBy(desc(files.createdAt))
      return NextResponse.json({
        data: rows.map((r) => ({ ...r, url: `/api/pharmacy/prescriptions/${p.data.id}/attachments/${r.id}` })),
      })
    })
  } catch (error) {
    logError('api/pharmacy/prescriptions/[id]/attachments GET', error)
    return NextResponse.json({ error: 'Failed to load the prescription images' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'createSales')
    if (permError) return permError
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const quotaError = await requireQuota(session.user.tenantId, 'file')
    if (quotaError) return quotaError

    let form: FormData
    try {
      form = await request.formData()
    } catch {
      return NextResponse.json({ error: 'Send the image as multipart form data (field "file")' }, { status: 400 })
    }
    const file = form.get('file')
    if (!(file instanceof File)) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    const check = validateFile(file, { allowedTypes: ALLOWED, maxSize: 10 * 1024 * 1024 })
    if (!check.valid) return NextResponse.json({ error: check.error }, { status: 400 })
    const buffer = Buffer.from(await file.arrayBuffer())
    const content = validateFileContent(buffer, file.name)
    if (!content.valid) return NextResponse.json({ error: content.error }, { status: 400 })
    const contentHash = computeFileHash(buffer)

    return await withTenant(session.user.tenantId, async (db) => {
      const found = await loadPrescriptionFor(session, db, p.data.id)
      if ('error' in found) return found.error
      const [dup] = await db.select({ id: files.id }).from(files)
        .where(and(eq(files.tenantId, session.user.tenantId), eq(files.attachedToType, ATTACHED_TYPE), eq(files.attachedToId, p.data.id), eq(files.contentHash, contentHash)))
        .limit(1)
      if (dup) return NextResponse.json({ error: 'This image is already attached to the prescription', duplicate: true }, { status: 409 })
      const stored = await storeFile(buffer, file.name, { tenantSlug: session.user.tenantSlug, isPrivate: true })
      const [row] = await db.insert(files).values({
        tenantId: session.user.tenantId,
        fileName: file.name.slice(0, 255),
        fileUrl: stored.fileUrl,
        fileSize: buffer.length,
        fileType: file.type,
        contentHash,
        isPrivate: true,
        isFolder: false,
        attachedToType: ATTACHED_TYPE,
        attachedToId: p.data.id,
        category: 'prescription',
        uploadedBy: session.user.id,
      }).returning({ id: files.id, fileName: files.fileName, fileType: files.fileType, fileSize: files.fileSize, createdAt: files.createdAt })
      invalidateStorageCache(session.user.tenantId)
      logAndBroadcast(session.user.tenantId, 'file', 'created', row.id, { userId: session.user.id })
      return NextResponse.json({ ...row, url: `/api/pharmacy/prescriptions/${p.data.id}/attachments/${row.id}` }, { status: 201 })
    })
  } catch (error) {
    logError('api/pharmacy/prescriptions/[id]/attachments POST', error)
    return NextResponse.json({ error: 'Failed to upload the prescription image' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'createSales')
    if (permError) return permError
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const attachmentId = request.nextUrl.searchParams.get('attachmentId') || ''
    if (!UUID_RE.test(attachmentId)) return NextResponse.json({ error: 'attachmentId is required' }, { status: 400 })
    return await withTenant(session.user.tenantId, async (db) => {
      const found = await loadPrescriptionFor(session, db, p.data.id)
      if ('error' in found) return found.error
      const [row] = await db.delete(files)
        .where(and(eq(files.tenantId, session.user.tenantId), eq(files.id, attachmentId), eq(files.attachedToType, ATTACHED_TYPE), eq(files.attachedToId, p.data.id)))
        .returning({ id: files.id, fileUrl: files.fileUrl, contentHash: files.contentHash })
      if (!row) return NextResponse.json({ error: 'Image not found' }, { status: 404 })
      // Keep the stored object when another record still points at the same content
      const [other] = row.contentHash
        ? await db.select({ id: files.id }).from(files).where(and(eq(files.tenantId, session.user.tenantId), eq(files.fileUrl, row.fileUrl))).limit(1)
        : []
      if (!other) await deleteStoredFile(row.fileUrl, session.user.tenantSlug).catch(() => false)
      invalidateStorageCache(session.user.tenantId)
      logAndBroadcast(session.user.tenantId, 'file', 'deleted', row.id, { userId: session.user.id })
      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/pharmacy/prescriptions/[id]/attachments DELETE', error)
    return NextResponse.json({ error: 'Failed to remove the image' }, { status: 500 })
  }
}
