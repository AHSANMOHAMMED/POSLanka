import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tenantUsage, subscriptions } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'

export interface StorageQuota {
  dbUsedBytes: number
  dbLimitBytes: number | null
  fileUsedBytes: number
  fileLimitBytes: number | null
  dbPercent: number
  filePercent: number
  warningLevel: 'none' | 'warning' | 'critical' | 'blocked'
  canCreateRecords: boolean   // false at >=100% DB
  canUploadFiles: boolean     // false at >=100% files
  canCompleteSales: boolean   // true up to 110% (grace)
}

// In-memory cache with 60-second TTL
const quotaCache = new Map<string, { data: StorageQuota; expires: number }>()
const CACHE_TTL_MS = 60_000

function getWarningLevel(dbPercent: number, filePercent: number): StorageQuota['warningLevel'] {
  const maxPercent = Math.max(dbPercent, filePercent)
  if (maxPercent >= 100) return 'blocked'
  if (maxPercent >= 90) return 'critical'
  if (maxPercent >= 80) return 'warning'
  return 'none'
}

export async function getStorageQuota(tenantId: string): Promise<StorageQuota> {
  // Check cache first
  const cached = quotaCache.get(tenantId)
  if (cached && cached.expires > Date.now()) {
    return cached.data
  }

  // Fetch usage
  const usage = await db.query.tenantUsage.findFirst({
    where: eq(tenantUsage.tenantId, tenantId),
  })

  // Fetch subscription with tier
  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.tenantId, tenantId),
    with: {
      tier: true,
    },
  })

  const dbUsedBytes = usage?.storageBytes ?? 0
  const fileUsedBytes = usage?.fileStorageBytes ?? 0

  // Use override values if set, otherwise use tier limits
  const dbLimitBytes = sub?.overrideDatabaseBytes ?? (sub?.tier as { maxDatabaseBytes?: number | null })?.maxDatabaseBytes ?? null
  const fileLimitBytes = sub?.overrideFileStorageBytes ?? (sub?.tier as { maxFileStorageBytes?: number | null })?.maxFileStorageBytes ?? null

  const dbPercent = dbLimitBytes ? (dbUsedBytes / dbLimitBytes) * 100 : 0
  const filePercent = fileLimitBytes ? (fileUsedBytes / fileLimitBytes) * 100 : 0

  const quota: StorageQuota = {
    dbUsedBytes,
    dbLimitBytes,
    fileUsedBytes,
    fileLimitBytes,
    dbPercent: Math.round(dbPercent * 10) / 10,
    filePercent: Math.round(filePercent * 10) / 10,
    warningLevel: getWarningLevel(dbPercent, filePercent),
    canCreateRecords: dbLimitBytes ? dbPercent < 100 : true,
    canUploadFiles: fileLimitBytes ? filePercent < 100 : true,
    canCompleteSales: dbLimitBytes ? dbPercent < 110 : true, // Grace period up to 110%
  }

  // Cache the result
  quotaCache.set(tenantId, { data: quota, expires: Date.now() + CACHE_TTL_MS })

  return quota
}

export async function checkCanWrite(
  tenantId: string,
  type: 'standard' | 'essential' | 'file'
): Promise<{ allowed: boolean; reason?: string }> {
  const quota = await getStorageQuota(tenantId)

  if (type === 'file') {
    if (!quota.canUploadFiles) {
      return {
        allowed: false,
        reason: 'File storage limit reached. Please upgrade your plan to upload more files.',
      }
    }
    return { allowed: true }
  }

  if (type === 'essential') {
    // Essential operations (completing existing sales) have grace up to 110%
    if (!quota.canCompleteSales) {
      return {
        allowed: false,
        reason: 'Database storage limit exceeded (grace period). Please upgrade your plan.',
      }
    }
    return { allowed: true }
  }

  // Standard operations (creating new records)
  if (!quota.canCreateRecords) {
    return {
      allowed: false,
      reason: 'Database storage limit reached. Please upgrade your plan to create new records.',
    }
  }
  return { allowed: true }
}

/**
 * API route helper - returns error response if tenant exceeds storage quota.
 * Same pattern as requirePermission() in roles.ts.
 * Returns null if allowed, NextResponse (402) if blocked.
 *
 * **Usage Pattern A** — Inside `withAuthTenant` callback (wrap in `{ error: ... }`):
 * ```ts
 * const result = await withAuthTenant(async (session, db) => {
 *   const quotaError = await requireQuota(session.user.tenantId, 'standard')
 *   if (quotaError) return { error: quotaError }
 *   // ...
 * })
 * if (result && 'error' in result) return result.error
 * ```
 *
 * **Usage Pattern B** — Before `withAuthTenantTransaction` (return directly):
 * ```ts
 * const quotaError = await requireQuota(tenantId, 'standard')
 * if (quotaError) return quotaError
 * ```
 *
 * For file uploads, pass `fileSizeBytes` to check whether the specific file
 * would exceed remaining quota (prevents a single large file from going over).
 */
export async function requireQuota(
  tenantId: string,
  type: 'standard' | 'essential' | 'file',
  fileSizeBytes?: number
): Promise<NextResponse | null> {
  const check = await checkCanWrite(tenantId, type)
  if (!check.allowed) {
    return NextResponse.json(
      { error: check.reason, code: 'STORAGE_LIMIT', quotaType: type },
      { status: 402 }
    )
  }

  // For file uploads, also check if this specific file would exceed the limit
  if (type === 'file' && fileSizeBytes && fileSizeBytes > 0) {
    const quota = await getStorageQuota(tenantId)
    if (quota.fileLimitBytes) {
      const remaining = quota.fileLimitBytes - quota.fileUsedBytes
      if (fileSizeBytes > remaining) {
        return NextResponse.json(
          {
            error: `File too large for remaining storage. ${formatBytes(remaining)} remaining, file is ${formatBytes(fileSizeBytes)}.`,
            code: 'STORAGE_LIMIT',
            quotaType: type,
          },
          { status: 402 }
        )
      }
    }
  }

  return null
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

// Clear cache for a specific tenant (call after storage-changing operations)
export function invalidateStorageCache(tenantId: string) {
  quotaCache.delete(tenantId)
}

// Clear all tenant caches (call after bulk recalculation like cron job)
export function invalidateAllStorageCache() {
  quotaCache.clear()
}

/**
 * Manually adjust file_storage_bytes for uploads that bypass the `files` table
 * (e.g. item images, logos). Call after uploading/deleting such files.
 * Uses GREATEST(0, ...) to prevent negative values.
 */
export async function adjustFileStorage(tenantId: string, deltaBytes: number) {
  if (deltaBytes === 0) return
  await db.update(tenantUsage)
    .set({
      fileStorageBytes: sql`GREATEST(0, ${tenantUsage.fileStorageBytes} + ${deltaBytes})`,
    })
    .where(eq(tenantUsage.tenantId, tenantId))
  invalidateStorageCache(tenantId)
}
