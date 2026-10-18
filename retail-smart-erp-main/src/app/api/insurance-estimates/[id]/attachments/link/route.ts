import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { insuranceEstimates, files } from '@/lib/db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { invalidateStorageCache, requireQuota } from '@/lib/db/storage-quota'
import { requirePermission } from '@/lib/auth/roles'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { linkAttachmentsSchema } from '@/lib/validation/schemas/insurance'
import { idParamSchema } from '@/lib/validation/schemas/common'

// POST link existing attachments to this estimate
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

    const quotaError = await requireQuota(session.user.tenantId, 'file')
    if (quotaError) return quotaError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id: estimateId } = paramsParsed.data
    const parsed = await validateBody(request, linkAttachmentsSchema)
    if (!parsed.success) return parsed.response
    const { attachmentIds } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const estimate = await db.query.insuranceEstimates.findFirst({
        where: eq(insuranceEstimates.id, estimateId),
      })

      if (!estimate) {
        return NextResponse.json({ error: 'Estimate not found' }, { status: 404 })
      }

      // Fetch source files
      const sourceFiles = await db.query.files.findMany({
        where: inArray(files.id, attachmentIds),
      })

      if (sourceFiles.length === 0) {
        return NextResponse.json({ error: 'No valid attachments found' }, { status: 404 })
      }

      // Get existing content hashes in this estimate to avoid duplicates
      const existingFiles = await db.query.files.findMany({
        where: and(
          eq(files.attachedToType, 'estimate'),
          eq(files.attachedToId, estimateId),
        ),
        columns: { contentHash: true },
      })
      const existingHashes = new Set(existingFiles.map(f => f.contentHash).filter(Boolean))

      const newFiles = []
      let skipped = 0

      for (const source of sourceFiles) {
        if (source.contentHash && existingHashes.has(source.contentHash)) {
          skipped++
          continue
        }

        newFiles.push({
          tenantId: session.user.tenantId,
          fileName: source.fileName,
          fileUrl: source.fileUrl,
          fileSize: source.fileSize,
          fileType: source.fileType,
          contentHash: source.contentHash,
          isPrivate: false,
          isFolder: false,
          attachedToType: 'estimate' as const,
          attachedToId: estimateId,
          category: source.category,
          description: source.description,
          uploadedBy: session.user.id,
        })

        if (source.contentHash) {
          existingHashes.add(source.contentHash)
        }
      }

      if (newFiles.length > 0) {
        await db.insert(files).values(newFiles)
        logAndBroadcast(session.user.tenantId, 'estimate', 'updated', estimateId)
        invalidateStorageCache(session.user.tenantId)
      }

      return NextResponse.json({
        linked: newFiles.length,
        skipped,
        message: newFiles.length > 0
          ? `Linked ${newFiles.length} attachment${newFiles.length !== 1 ? 's' : ''}${skipped > 0 ? ` (${skipped} already exist)` : ''}`
          : 'All selected files already exist in this estimate',
      })
    })
  } catch (error) {
    logError('api/insurance-estimates/[id]/attachments/link', error)
    return NextResponse.json({ error: 'Failed to link attachments' }, { status: 500 })
  }
}
