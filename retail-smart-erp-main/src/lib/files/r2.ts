import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'
import fs from 'fs'
import path from 'path'

/**
 * S3-compatible object storage: Cloudflare R2 or DigitalOcean Spaces (or AWS S3).
 * Provider-neutral STORAGE_* variables win; the original R2_* names keep working.
 *
 *   STORAGE_ENDPOINT     R2: https://<account>.r2.cloudflarestorage.com
 *                        Spaces: https://<region>.digitaloceanspaces.com (e.g. sgp1)
 *   STORAGE_REGION       R2: auto (default) · Spaces: us-east-1 (SigV4 region Spaces expects)
 *   STORAGE_ACCESS_KEY_ID / STORAGE_SECRET_ACCESS_KEY / STORAGE_BUCKET
 *   STORAGE_PUBLIC_URL   public base URL of the bucket (Spaces CDN: https://<bucket>.<region>.cdn.digitaloceanspaces.com)
 *   STORAGE_PUBLIC_ACL   'public-read' for Spaces/S3: objects outside private/ are uploaded world-readable
 *                        (R2 serves public files through the bucket's public domain instead; leave unset)
 */
const env = (name: string, legacy: string) => process.env[name] || process.env[legacy] || ''

export function isS3Configured(): boolean {
  return Boolean(
    env('STORAGE_ACCESS_KEY_ID', 'R2_ACCESS_KEY_ID') &&
    env('STORAGE_SECRET_ACCESS_KEY', 'R2_SECRET_ACCESS_KEY')
  )
}

/** Local public/uploads fallback: development, or explicitly allowed (ALLOW_LOCAL_UPLOADS=true). */
export function localUploadsAllowed(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.ALLOW_LOCAL_UPLOADS === 'true'
}

/** 's3' | 'local' | 'unconfigured' — reported by /api/health. */
export function storageMode(): 's3' | 'local' | 'unconfigured' {
  if (isS3Configured()) return 's3'
  return localUploadsAllowed() ? 'local' : 'unconfigured'
}

const r2 = new S3Client({
  region: process.env.STORAGE_REGION || 'auto',
  endpoint: env('STORAGE_ENDPOINT', 'R2_ENDPOINT') || undefined,
  credentials: {
    accessKeyId: env('STORAGE_ACCESS_KEY_ID', 'R2_ACCESS_KEY_ID'),
    secretAccessKey: env('STORAGE_SECRET_ACCESS_KEY', 'R2_SECRET_ACCESS_KEY'),
  },
})

const BUCKET = env('STORAGE_BUCKET', 'R2_BUCKET_NAME') || 'retailsmart-uploads'
const PUBLIC_URL = env('STORAGE_PUBLIC_URL', 'R2_PUBLIC_URL').replace(/\/$/, '')
const PUBLIC_ACL = process.env.STORAGE_PUBLIC_ACL === 'public-read'

/** Private uploads (private/…) are never made world-readable. */
export function objectAclFor(key: string): 'public-read' | undefined {
  return PUBLIC_ACL && !key.startsWith('private/') ? 'public-read' : undefined
}

/**
 * Upload a file to R2 (or local public/uploads fallback) and return its URL.
 */
export async function uploadToR2(
  key: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  const cleanKey = key.replace(/^\/+/, '')

  // Fallback to local storage when S3/R2 is not configured. In production that would silently
  // put uploads on the container's ephemeral disk (lost on redeploy, invisible to other
  // instances), so it is refused unless ALLOW_LOCAL_UPLOADS=true (single host with a volume).
  if (!isS3Configured()) {
    if (!localUploadsAllowed()) {
      throw new Error('Object storage is not configured (set STORAGE_ACCESS_KEY_ID / STORAGE_SECRET_ACCESS_KEY / STORAGE_BUCKET, or ALLOW_LOCAL_UPLOADS=true)')
    }
    try {
      const localFile = path.join(process.cwd(), 'public', 'uploads', cleanKey)
      await fs.promises.mkdir(path.dirname(localFile), { recursive: true })
      await fs.promises.writeFile(localFile, buffer)
      return cdnUrl(cleanKey)
    } catch (err) {
      console.error('[storage] Local storage write failed:', err)
      throw new Error('Local file storage failed: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  await r2.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: cleanKey,
      Body: buffer,
      ContentType: contentType,
      ACL: objectAclFor(cleanKey),
    })
  )
  return cdnUrl(cleanKey)
}

/**
 * Delete a file from R2 (and local storage) by its key.
 */
export async function deleteFromR2(key: string): Promise<boolean> {
  const cleanKey = key.replace(/^\/+/, '')
  try {
    const localFile = path.join(process.cwd(), 'public', 'uploads', cleanKey)
    if (fs.existsSync(localFile)) {
      await fs.promises.unlink(localFile).catch(() => {})
    }
  } catch {
    // ignore local delete error
  }

  if (!isS3Configured()) {
    return true
  }

  try {
    await r2.send(
      new DeleteObjectCommand({
        Bucket: BUCKET,
        Key: cleanKey,
      })
    )
    return true
  } catch {
    return false
  }
}

/**
 * Get a file from R2 or local storage as a buffer.
 */
export async function getFromR2(
  key: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const cleanKey = key.replace(/^\/+/, '')

  // Check local file first if S3 not configured
  if (!isS3Configured()) {
    try {
      const localFile = path.join(process.cwd(), 'public', 'uploads', cleanKey)
      if (fs.existsSync(localFile)) {
        const buffer = await fs.promises.readFile(localFile)
        return {
          buffer,
          contentType: 'application/octet-stream',
        }
      }
    } catch {
      return null
    }
  }

  try {
    const response = await r2.send(
      new GetObjectCommand({
        Bucket: BUCKET,
        Key: cleanKey,
      })
    )
    if (!response.Body) return null
    const bytes = await response.Body.transformToByteArray()
    return {
      buffer: Buffer.from(bytes),
      contentType: response.ContentType || 'application/octet-stream',
    }
  } catch {
    return null
  }
}

/**
 * Check if a file exists in R2 or local storage.
 */
export async function existsInR2(key: string): Promise<boolean> {
  const cleanKey = key.replace(/^\/+/, '')
  if (!isS3Configured()) {
    const localFile = path.join(process.cwd(), 'public', 'uploads', cleanKey)
    return fs.existsSync(localFile)
  }

  try {
    await r2.send(
      new HeadObjectCommand({
        Bucket: BUCKET,
        Key: cleanKey,
      })
    )
    return true
  } catch {
    return false
  }
}

/**
 * List all object keys under a prefix in R2 or local storage.
 * Handles pagination automatically.
 */
export async function listByPrefix(prefix: string): Promise<string[]> {
  const cleanPrefix = prefix.replace(/^\/+/, '')

  if (!isS3Configured()) {
    try {
      const dirPath = path.join(process.cwd(), 'public', 'uploads', cleanPrefix)
      if (!fs.existsSync(dirPath)) return []

      const readDirRecursive = async (dir: string, base: string): Promise<string[]> => {
        let results: string[] = []
        const entries = await fs.promises.readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name)
          const relPath = path.join(base, entry.name)
          if (entry.isDirectory()) {
            results = results.concat(await readDirRecursive(fullPath, relPath))
          } else {
            results.push(relPath)
          }
        }
        return results
      }

      return await readDirRecursive(dirPath, cleanPrefix)
    } catch {
      return []
    }
  }

  const keys: string[] = []
  let continuationToken: string | undefined

  do {
    const response = await r2.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: cleanPrefix,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      })
    )
    if (response.Contents) {
      for (const obj of response.Contents) {
        if (obj.Key) keys.push(obj.Key)
      }
    }
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined
  } while (continuationToken)

  return keys
}

/**
 * Delete multiple files from R2 in a single batch (up to 1000 per call).
 * Returns count of successfully deleted objects.
 */
export async function deleteManyFromR2(keys: string[]): Promise<number> {
  if (keys.length === 0) return 0

  if (!isS3Configured()) {
    let deleted = 0
    for (const key of keys) {
      if (await deleteFromR2(key)) deleted++
    }
    return deleted
  }

  let deleted = 0
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000)
    try {
      const response = await r2.send(
        new DeleteObjectsCommand({
          Bucket: BUCKET,
          Delete: {
            Objects: batch.map(key => ({ Key: key })),
            Quiet: true,
          },
        })
      )
      deleted += batch.length - (response.Errors?.length || 0)
    } catch {
      for (const key of batch) {
        if (await deleteFromR2(key)) deleted++
      }
    }
  }
  return deleted
}

/**
 * Build the public CDN URL for an R2 key (or local URL).
 */
export function cdnUrl(key: string): string {
  const cleanKey = key.replace(/^\/+/, '')
  if (isS3Configured() && PUBLIC_URL) {
    return `${PUBLIC_URL}/${cleanKey}`
  }
  return `/uploads/${cleanKey}`
}

/**
 * Extract the object key from a CDN URL or /uploads/ path.
 * Returns null if the URL doesn't match either format.
 */
export function keyFromUrl(url: string): string | null {
  // CDN URL: https://cdn.retailsmarterp.com/tenantSlug/ab/hash-123.png
  if (PUBLIC_URL && url.startsWith(PUBLIC_URL + '/')) {
    return url.slice(PUBLIC_URL.length + 1)
  }

  // Local path: /uploads/logos/xyz.png
  if (url.startsWith('/uploads/')) {
    return url.slice('/uploads/'.length)
  }

  // Legacy private path: /storage/private/tenantSlug/ab/hash-123.png
  if (url.startsWith('/storage/private/')) {
    return 'private/' + url.slice('/storage/private/'.length)
  }

  return null
}
