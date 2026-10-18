import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { insuranceEstimates, files } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { validateFile, storeFile, computeFileHash, deleteStoredFile } from '@/lib/files'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota, invalidateStorageCache } from '@/lib/db/storage-quota'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

// E23: Photo attachments API for estimates (backed by unified files table)

// GET all attachments for an estimate
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const estimate = await db.query.insuranceEstimates.findFirst({
        where: eq(insuranceEstimates.id, id),
      })

      if (!estimate) {
        return NextResponse.json({ error: 'Estimate not found' }, { status: 404 })
      }

      const fileRecords = await db.query.files.findMany({
        where: and(
          eq(files.attachedToType, 'estimate'),
          eq(files.attachedToId, id),
        ),
        with: {
          uploadedByUser: { columns: { fullName: true } },
        },
        orderBy: (f, { desc }) => [desc(f.createdAt)],
      })

      // Map to old response shape for backward compatibility
      const attachments = fileRecords.map(f => ({
        id: f.id,
        tenantId: f.tenantId,
        estimateId: id,
        fileName: f.fileName,
        fileType: f.fileType,
        fileSize: f.fileSize,
        filePath: f.fileUrl,
        fileHash: f.contentHash,
        category: f.category,
        description: f.description,
        uploadedBy: f.uploadedBy,
        createdAt: f.createdAt,
        uploadedByUser: f.uploadedByUser,
      }))

      return NextResponse.json(attachments)
    })
  } catch (error) {
    logError('api/insurance-estimates/[id]/attachments', error)
    return NextResponse.json({ error: 'Failed to fetch attachments' }, { status: 500 })
  }
}

// POST upload a new attachment
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageInsuranceEstimates')
    if (permError) return permError

    const quotaError = await requireQuota(session!.user.tenantId, 'file')
    if (quotaError) return quotaError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const estimate = await db.query.insuranceEstimates.findFirst({
        where: eq(insuranceEstimates.id, id),
      })

      if (!estimate) {
        return NextResponse.json({ error: 'Estimate not found' }, { status: 404 })
      }

      const formData = await request.formData()
      const file = formData.get('file') as File | null
      const category = formData.get('category') as string | null
      const description = formData.get('description') as string | null

      if (!file) {
        return NextResponse.json({ error: 'No file provided' }, { status: 400 })
      }

      const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']
      const validation = validateFile(file, { allowedTypes, maxSize: 10 * 1024 * 1024 })
      if (!validation.valid) {
        return NextResponse.json({ error: validation.error }, { status: 400 })
      }

      const bytes = await file.arrayBuffer()
      const buffer = Buffer.from(bytes)
      const contentHash = computeFileHash(buffer)

      // Check for duplicate in same estimate
      const duplicateInEstimate = await db.query.files.findFirst({
        where: and(
          eq(files.attachedToType, 'estimate'),
          eq(files.attachedToId, id),
          eq(files.contentHash, contentHash),
        ),
      })

      if (duplicateInEstimate) {
        return NextResponse.json({
          error: 'This file has already been uploaded to this estimate',
          duplicate: true,
          existingAttachment: {
            id: duplicateInEstimate.id,
            fileName: duplicateInEstimate.fileName,
            uploadedAt: duplicateInEstimate.createdAt,
          }
        }, { status: 409 })
      }

      // Check for existing file with same hash in tenant (for file reuse)
      const existingFile = await db.query.files.findFirst({
        where: eq(files.contentHash, contentHash),
      })

      let fileUrl: string
      let linkedFrom: string | null = null

      if (existingFile) {
        fileUrl = existingFile.fileUrl
        // Try to find what estimate it belongs to for the message
        if (existingFile.attachedToType === 'estimate' && existingFile.attachedToId) {
          const sourceEstimate = await db.query.insuranceEstimates.findFirst({
            where: eq(insuranceEstimates.id, existingFile.attachedToId),
            columns: { estimateNo: true },
          })
          linkedFrom = sourceEstimate?.estimateNo || null
        }
      } else {
        const stored = await storeFile(buffer, file.name, {
          tenantSlug: session.user.tenantSlug,
        })
        fileUrl = stored.fileUrl
      }

      const [newFile] = await db.insert(files).values({
        tenantId: session.user.tenantId,
        fileName: file.name,
        fileUrl,
        fileSize: file.size,
        fileType: file.type,
        contentHash,
        isPrivate: false,
        isFolder: false,
        attachedToType: 'estimate',
        attachedToId: id,
        category: category || null,
        description: description || null,
        uploadedBy: session.user.id,
      }).returning()

      // Map to old response shape
      const response: Record<string, unknown> = {
        id: newFile.id,
        tenantId: newFile.tenantId,
        estimateId: id,
        fileName: newFile.fileName,
        fileType: newFile.fileType,
        fileSize: newFile.fileSize,
        filePath: newFile.fileUrl,
        fileHash: newFile.contentHash,
        category: newFile.category,
        description: newFile.description,
        uploadedBy: newFile.uploadedBy,
        createdAt: newFile.createdAt,
      }

      if (linkedFrom) {
        response.linkedFrom = linkedFrom
        response.message = `File linked from estimate ${linkedFrom} (no duplicate storage)`
      }

      logAndBroadcast(session.user.tenantId, 'estimate', 'updated', id)
      invalidateStorageCache(session.user.tenantId)

      return NextResponse.json(response)
    })
  } catch (error) {
    logError('api/insurance-estimates/[id]/attachments', error)
    return NextResponse.json({ error: 'Failed to upload attachment' }, { status: 500 })
  }
}

// DELETE an attachment
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageInsuranceEstimates')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id: estimateId } = paramsParsed.data
    const { searchParams } = new URL(request.url)
    const attachmentId = searchParams.get('attachmentId')

    if (!attachmentId) {
      return NextResponse.json({ error: 'Attachment ID required' }, { status: 400 })
    }

    return await withTenant(session.user.tenantId, async (db) => {
      const estimate = await db.query.insuranceEstimates.findFirst({
        where: eq(insuranceEstimates.id, estimateId),
      })

      if (!estimate) {
        return NextResponse.json({ error: 'Estimate not found' }, { status: 404 })
      }

      const attachment = await db.query.files.findFirst({
        where: and(
          eq(files.id, attachmentId),
          eq(files.attachedToType, 'estimate'),
          eq(files.attachedToId, estimateId),
        ),
      })

      if (!attachment) {
        return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
      }

      // Delete from database
      await db.delete(files).where(eq(files.id, attachmentId))

      // Only delete file if no other records reference the same hash
      if (attachment.contentHash) {
        const otherReference = await db.query.files.findFirst({
          where: eq(files.contentHash, attachment.contentHash),
        })

        if (!otherReference) {
          await deleteStoredFile(attachment.fileUrl, session.user.tenantSlug)
        }
      }

      logAndBroadcast(session.user.tenantId, 'estimate', 'updated', estimateId)
      invalidateStorageCache(session.user.tenantId)

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/insurance-estimates/[id]/attachments', error)
    return NextResponse.json({ error: 'Failed to delete attachment' }, { status: 500 })
  }
}
