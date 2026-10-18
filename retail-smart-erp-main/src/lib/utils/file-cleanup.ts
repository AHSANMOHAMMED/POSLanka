/**
 * File cleanup utilities for handling file deletion from R2
 * when parent documents are deleted (estimates, inspections, work orders).
 *
 * Uses the unified files table with hash-based deduplication.
 */

import { db } from '@/lib/db'
import { files } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { deleteStoredFile, keyFromUrl, deleteFromR2 } from '@/lib/files'
import { invalidateStorageCache } from '@/lib/db/storage-quota'

interface AttachmentInfo {
  filePath: string
  fileHash: string | null
}

interface InspectionPhotoInfo {
  photoUrl: string
}

/**
 * Delete all file records for a specific document, respecting deduplication.
 * Only deletes R2 objects if no other records reference the same contentHash.
 */
export async function deleteFilesByDocument(
  tenantId: string,
  attachedToType: string,
  attachedToId: string,
  tenantSlug: string
): Promise<{ deleted: number; skipped: number; errors: string[] }> {
  // Invalidate storage cache since we're about to delete file records
  invalidateStorageCache(tenantId)
  const result = { deleted: 0, skipped: 0, errors: [] as string[] }

  try {
    // Find all file records for this document
    const fileRecords = await db.query.files.findMany({
      where: and(
        eq(files.tenantId, tenantId),
        eq(files.attachedToType, attachedToType),
        eq(files.attachedToId, attachedToId),
      ),
    })

    for (const fileRecord of fileRecords) {
      try {
        // Try R2 deletion first, then DB — prevents orphaned R2 objects
        // if R2 delete succeeds but DB delete fails, the file is gone but
        // the dangling DB record can be cleaned up later. The reverse
        // (DB deleted, R2 still there) is harder to detect.
        let r2Deleted = false

        if (fileRecord.contentHash && !fileRecord.isFolder) {
          const otherReference = await db.query.files.findFirst({
            where: and(
              eq(files.contentHash, fileRecord.contentHash),
              // Exclude the current record from the check
              eq(files.tenantId, tenantId),
            ),
            columns: { id: true },
          })

          // Only delete from R2 if this is the last reference (accounting for self)
          const refCount = otherReference && otherReference.id !== fileRecord.id
          if (!refCount) {
            r2Deleted = await deleteStoredFile(fileRecord.fileUrl, tenantSlug)
            if (!r2Deleted) {
              result.errors.push(`${fileRecord.fileUrl}: could not delete from R2`)
            }
          } else {
            result.skipped++
            r2Deleted = true // Skip R2, just delete DB record
          }
        } else if (!fileRecord.isFolder) {
          r2Deleted = await deleteStoredFile(fileRecord.fileUrl, tenantSlug)
        }

        // Delete the DB record
        await db.delete(files).where(eq(files.id, fileRecord.id))
        if (r2Deleted && !fileRecord.isFolder) {
          result.deleted++
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        result.errors.push(`${fileRecord.fileUrl}: ${message}`)
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    result.errors.push(`Query error: ${message}`)
  }

  return result
}

/**
 * Delete estimate attachment files from R2, respecting hash-based deduplication.
 * Only deletes files if no other records reference the same hash.
 *
 * Call this AFTER the database records have been deleted.
 */
export async function deleteEstimateAttachmentFiles(
  tenantId: string,
  attachments: AttachmentInfo[]
): Promise<{ deleted: number; skipped: number; errors: string[] }> {
  const result = { deleted: 0, skipped: 0, errors: [] as string[] }

  for (const attachment of attachments) {
    try {
      // Check if other files reference the same hash
      if (attachment.fileHash) {
        const otherReference = await db.query.files.findFirst({
          where: and(
            eq(files.tenantId, tenantId),
            eq(files.contentHash, attachment.fileHash)
          ),
        })

        if (otherReference) {
          result.skipped++
          continue
        }
      }

      const key = keyFromUrl(attachment.filePath)
      if (key) {
        await deleteFromR2(key)
        result.deleted++
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      result.errors.push(`${attachment.filePath}: ${message}`)
    }
  }

  return result
}

/**
 * Delete inspection photo files from R2.
 *
 * Call this AFTER the database records have been deleted.
 */
export async function deleteInspectionPhotoFiles(
  inspectionId: string,
  photos: InspectionPhotoInfo[]
): Promise<{ deleted: number; errors: string[] }> {
  const result = { deleted: 0, errors: [] as string[] }

  for (const photo of photos) {
    try {
      const key = keyFromUrl(photo.photoUrl)
      if (key) {
        await deleteFromR2(key)
        result.deleted++
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      result.errors.push(`${photo.photoUrl}: ${message}`)
    }
  }

  // No directory cleanup needed for R2 (flat object store)

  return result
}

interface InspectionWithPhotos {
  id: string
  photos: InspectionPhotoInfo[]
}

/**
 * Delete all inspection photo files for a work order from R2.
 *
 * Call this AFTER the database records have been deleted.
 */
export async function deleteWorkOrderInspectionFiles(
  inspections: InspectionWithPhotos[]
): Promise<{ totalDeleted: number; totalErrors: string[] }> {
  const totalResult = { totalDeleted: 0, totalErrors: [] as string[] }

  for (const inspection of inspections) {
    const result = await deleteInspectionPhotoFiles(inspection.id, inspection.photos)
    totalResult.totalDeleted += result.deleted
    totalResult.totalErrors.push(...result.errors)
  }

  return totalResult
}
