import crypto from 'crypto'
import { uploadToR2, deleteFromR2, existsInR2, keyFromUrl, listByPrefix, deleteManyFromR2 } from './r2'

const ALLOWED_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp',
  // SVG removed: can contain embedded JavaScript (stored XSS risk)
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt',
  'ppt', 'pptx',
  'mp4', 'mov', 'avi', 'webm', 'ogg',
  'zip', 'rar', '7z',
])

const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100MB default

interface ValidateOptions {
  allowedTypes?: string[]
  maxSize?: number
}

interface StoreOptions {
  tenantSlug: string
  isPrivate?: boolean
}

interface StoreResult {
  fileUrl: string
  contentHash: string
  fileSize: number
}

export function computeFileHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

export function validateFile(
  file: { name: string; type: string; size: number },
  options?: ValidateOptions
): { valid: boolean; error?: string } {
  const { allowedTypes, maxSize = MAX_FILE_SIZE } = options || {}

  // Check size
  if (file.size > maxSize) {
    const maxMB = Math.round(maxSize / 1024 / 1024)
    return { valid: false, error: `File too large. Maximum size is ${maxMB}MB` }
  }

  // Check extension
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (!ext || !ALLOWED_EXTENSIONS.has(ext)) {
    return { valid: false, error: `File type .${ext || 'unknown'} is not allowed` }
  }

  // Check MIME type if allowedTypes specified
  if (allowedTypes && !allowedTypes.includes(file.type)) {
    return { valid: false, error: `File type ${file.type} is not allowed` }
  }

  // Validate that MIME type matches the file extension to prevent spoofing
  const extensionMimeMap: Record<string, string[]> = {
    jpg: ['image/jpeg'], jpeg: ['image/jpeg'], png: ['image/png'],
    gif: ['image/gif'], webp: ['image/webp'], svg: ['image/svg+xml'],
    pdf: ['application/pdf'],
    doc: ['application/msword'], docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    xls: ['application/vnd.ms-excel'], xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ppt: ['application/vnd.ms-powerpoint'], pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    csv: ['text/csv', 'text/plain', 'application/csv'],
    txt: ['text/plain'],
    mp4: ['video/mp4'], mov: ['video/quicktime'], avi: ['video/x-msvideo'],
    webm: ['video/webm'], ogg: ['video/ogg', 'audio/ogg'],
    zip: ['application/zip', 'application/x-zip-compressed'],
    rar: ['application/x-rar-compressed', 'application/vnd.rar'],
    '7z': ['application/x-7z-compressed'],
  }
  if (ext && file.type && extensionMimeMap[ext]) {
    const allowedMimes = extensionMimeMap[ext]
    if (!allowedMimes.includes(file.type) && file.type !== 'application/octet-stream') {
      return { valid: false, error: `File extension .${ext} does not match content type ${file.type}` }
    }
  }

  // Sanitize filename - reject path traversal
  if (file.name.includes('..') || file.name.includes('/') || file.name.includes('\\')) {
    return { valid: false, error: 'Invalid file name' }
  }

  return { valid: true }
}

export async function storeFile(
  buffer: Buffer,
  originalName: string,
  options: StoreOptions
): Promise<StoreResult> {
  const { tenantSlug, isPrivate = false } = options

  const contentHash = computeFileHash(buffer)
  const ext = originalName.split('.').pop()?.toLowerCase() || 'bin'
  const hashPrefix = contentHash.substring(0, 2)
  const timestamp = Date.now()
  const fileName = `${contentHash.substring(0, 12)}-${timestamp}.${ext}`

  // Detect MIME type from extension
  const mimeTypes: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp',
    pdf: 'application/pdf', csv: 'text/csv', txt: 'text/plain',
    doc: 'application/msword', xls: 'application/vnd.ms-excel',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    svg: 'image/svg+xml',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo',
    webm: 'video/webm', ogg: 'video/ogg',
    zip: 'application/zip', rar: 'application/x-rar-compressed',
    '7z': 'application/x-7z-compressed',
  }
  const contentType = mimeTypes[ext] || 'application/octet-stream'

  let r2Key: string
  let fileUrl: string

  if (isPrivate) {
    r2Key = `private/${tenantSlug}/${hashPrefix}/${fileName}`
    // Private files store the R2 key path (not CDN URL) — served via download API
    fileUrl = `/storage/private/${tenantSlug}/${hashPrefix}/${fileName}`
  } else {
    r2Key = `${tenantSlug}/${hashPrefix}/${fileName}`
    // Public files get a CDN URL
    fileUrl = await uploadToR2(r2Key, buffer, contentType)
    return { fileUrl, contentHash, fileSize: buffer.length }
  }

  await uploadToR2(r2Key, buffer, contentType)

  return {
    fileUrl,
    contentHash,
    fileSize: buffer.length,
  }
}

export async function deleteStoredFile(fileUrl: string, _tenantSlug: string, thumbnailUrl?: string | null): Promise<boolean> {
  const key = keyFromUrl(fileUrl)
  if (!key) return false
  const result = await deleteFromR2(key)

  // Also delete thumbnail if it exists
  if (thumbnailUrl) {
    const thumbKey = keyFromUrl(thumbnailUrl)
    if (thumbKey) {
      await deleteFromR2(thumbKey).catch(() => {})
    }
  }

  return result
}

export async function fileExists(fileUrl: string): Promise<boolean> {
  const key = keyFromUrl(fileUrl)
  if (!key) return false
  return existsInR2(key)
}

/**
 * Delete all R2 objects for a tenant (public + private).
 * Call this BEFORE deleting the tenant's DB records.
 * Optionally pass tenantId to also delete logo files (stored under logos/{tenantId}.*).
 * Returns count of deleted objects.
 */
export async function deleteTenantFiles(tenantSlug: string, tenantId?: string): Promise<number> {
  // Public files: {tenantSlug}/...
  const publicKeys = await listByPrefix(`${tenantSlug}/`)
  // Private files: private/{tenantSlug}/...
  const privateKeys = await listByPrefix(`private/${tenantSlug}/`)
  // Thumbnails (public): thumbnails/{tenantSlug}/...
  const thumbKeys = await listByPrefix(`thumbnails/${tenantSlug}/`)
  // Thumbnails (private): private/thumbnails/{tenantSlug}/...
  const privateThumbKeys = await listByPrefix(`private/thumbnails/${tenantSlug}/`)

  // Logo files: logos/{tenantId}.* (stored under a different prefix)
  let logoKeys: string[] = []
  if (tenantId) {
    logoKeys = await listByPrefix(`logos/${tenantId}`)
  }

  // Item images: items/{tenantId}/{itemId}.{ext} (stored by tenantId, not slug)
  let itemImageKeys: string[] = []
  if (tenantId) {
    itemImageKeys = await listByPrefix(`items/${tenantId}/`)
  }

  const allKeys = [...publicKeys, ...privateKeys, ...thumbKeys, ...privateThumbKeys, ...logoKeys, ...itemImageKeys]
  if (allKeys.length === 0) return 0

  return deleteManyFromR2(allKeys)
}

/**
 * Delete specific R2 files by their URLs.
 * Resolves each URL to an R2 key, then batch-deletes.
 */
export async function deleteFilesByUrls(urls: string[]): Promise<number> {
  const keys: string[] = []
  for (const url of urls) {
    const key = keyFromUrl(url)
    if (key) keys.push(key)
  }
  if (keys.length === 0) return 0
  return deleteManyFromR2(keys)
}
