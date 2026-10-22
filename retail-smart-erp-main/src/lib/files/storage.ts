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

// Uploads are buffered in memory, so keep the default modest. UPLOAD_MAX_MB raises it.
const MAX_FILE_SIZE = (() => {
  const mb = parseInt(process.env.UPLOAD_MAX_MB || '', 10)
  return (Number.isFinite(mb) && mb > 0 ? mb : 20) * 1024 * 1024
})()

const startsWith = (buf: Buffer, bytes: number[], offset = 0) =>
  buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b)
const ascii = (buf: Buffer, text: string, offset = 0) => startsWith(buf, [...Buffer.from(text, 'latin1')], offset)

const ZIP = (b: Buffer) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]) || startsWith(b, [0x50, 0x4b, 0x05, 0x06])
const OLE = (b: Buffer) => startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
const ISO_BMFF = (b: Buffer) => ['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip'].some((t) => ascii(b, t, 4))
const TEXT = (b: Buffer) => {
  const head = b.subarray(0, 8192)
  if (head.includes(0)) {
    // UTF-16 text (Excel "Unicode text" CSV export) starts with a BOM and contains NULs
    return startsWith(b, [0xff, 0xfe]) || startsWith(b, [0xfe, 0xff])
  }
  // Executables renamed to .txt/.csv
  return !(ascii(b, 'MZ') || startsWith(b, [0x7f, 0x45, 0x4c, 0x46]))
}

/** File signature ("magic bytes") per allowed extension. */
const MAGIC: Record<string, (b: Buffer) => boolean> = {
  jpg: (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  jpeg: (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  png: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  gif: (b) => ascii(b, 'GIF87a') || ascii(b, 'GIF89a'),
  webp: (b) => ascii(b, 'RIFF') && ascii(b, 'WEBP', 8),
  pdf: (b) => b.subarray(0, 1024).includes(Buffer.from('%PDF-')),
  doc: OLE, xls: OLE, ppt: OLE,
  docx: ZIP, xlsx: ZIP, pptx: ZIP, zip: ZIP,
  rar: (b) => ascii(b, 'Rar!\x1a\x07'),
  '7z': (b) => startsWith(b, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]),
  mp4: ISO_BMFF, mov: ISO_BMFF,
  avi: (b) => ascii(b, 'RIFF') && ascii(b, 'AVI ', 8),
  webm: (b) => startsWith(b, [0x1a, 0x45, 0xdf, 0xa3]),
  ogg: (b) => ascii(b, 'OggS'),
  csv: TEXT, txt: TEXT,
}

/**
 * Check the uploaded bytes against the file's extension (the browser-supplied MIME type and
 * name are attacker-controlled). Call after reading the buffer, before storing it.
 */
export function validateFileContent(buffer: Buffer, fileName: string): { valid: boolean; error?: string } {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  const check = MAGIC[ext]
  if (!check) return { valid: false, error: `File type .${ext || 'unknown'} is not allowed` }
  if (buffer.length === 0) return { valid: false, error: 'File is empty' }
  if (!check(buffer)) return { valid: false, error: `File content does not match the .${ext} extension` }
  return { valid: true }
}

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
