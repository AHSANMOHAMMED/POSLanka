import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'

const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
})

const BUCKET = process.env.R2_BUCKET_NAME || 'retailsmart-uploads'
const PUBLIC_URL = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '')

/**
 * Upload a file to R2 and return its public CDN URL.
 */
export async function uploadToR2(
  key: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  await r2.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  )
  return cdnUrl(key)
}

/**
 * Delete a file from R2 by its key.
 */
export async function deleteFromR2(key: string): Promise<boolean> {
  try {
    await r2.send(
      new DeleteObjectCommand({
        Bucket: BUCKET,
        Key: key,
      })
    )
    return true
  } catch {
    return false
  }
}

/**
 * Get a file from R2 as a buffer.
 */
export async function getFromR2(
  key: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    const response = await r2.send(
      new GetObjectCommand({
        Bucket: BUCKET,
        Key: key,
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
 * Check if a file exists in R2.
 */
export async function existsInR2(key: string): Promise<boolean> {
  try {
    await r2.send(
      new HeadObjectCommand({
        Bucket: BUCKET,
        Key: key,
      })
    )
    return true
  } catch {
    return false
  }
}

/**
 * List all object keys under a prefix in R2.
 * Handles pagination automatically.
 */
export async function listByPrefix(prefix: string): Promise<string[]> {
  const keys: string[] = []
  let continuationToken: string | undefined

  do {
    const response = await r2.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
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

  let deleted = 0
  // R2/S3 batch delete supports up to 1000 keys per request
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
      // Fall back to individual deletes
      for (const key of batch) {
        if (await deleteFromR2(key)) deleted++
      }
    }
  }
  return deleted
}

/**
 * Build the public CDN URL for an R2 key.
 */
export function cdnUrl(key: string): string {
  return `${PUBLIC_URL}/${key}`
}

/**
 * Extract the R2 object key from a CDN URL or legacy /uploads/ path.
 * Returns null if the URL doesn't match either format.
 */
export function keyFromUrl(url: string): string | null {
  // CDN URL: https://cdn.retailsmarterp.com/tenantSlug/ab/hash-123.png
  if (PUBLIC_URL && url.startsWith(PUBLIC_URL + '/')) {
    return url.slice(PUBLIC_URL.length + 1)
  }

  // Legacy local path: /uploads/tenantSlug/ab/hash-123.png
  if (url.startsWith('/uploads/')) {
    return url.slice('/uploads/'.length)
  }

  // Legacy private path: /storage/private/tenantSlug/ab/hash-123.png
  if (url.startsWith('/storage/private/')) {
    return 'private/' + url.slice('/storage/private/'.length)
  }

  return null
}
