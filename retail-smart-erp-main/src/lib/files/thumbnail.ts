import sharp from 'sharp'
import { uploadToR2 } from './r2'

const THUMB_MAX_WIDTH = 400
const THUMB_MAX_HEIGHT = 400
const THUMB_QUALITY = 80

interface ThumbnailResult {
  thumbnailUrl: string
  imageWidth: number
  imageHeight: number
}

/**
 * Generate a JPEG thumbnail from an image buffer and upload to R2.
 * Returns the thumbnail CDN URL and original image dimensions.
 * Returns null for non-image or unsupported formats (SVG, GIF animation).
 */
export async function generateThumbnail(
  buffer: Buffer,
  fileType: string,
  r2KeyBase: string,
  isPrivate: boolean,
  tenantSlug: string
): Promise<ThumbnailResult | null> {
  // Only process raster images
  if (!fileType.startsWith('image/')) return null
  if (fileType === 'image/svg+xml') return null

  try {
    const image = sharp(buffer)
    const metadata = await image.metadata()

    if (!metadata.width || !metadata.height) return null

    // Generate thumbnail — resize to fit within max dimensions
    const thumbBuffer = await image
      .resize(THUMB_MAX_WIDTH, THUMB_MAX_HEIGHT, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: THUMB_QUALITY, progressive: true })
      .toBuffer()

    // Build thumbnail R2 key: thumbnails/{tenantSlug}/{hashPrefix}/{name}_thumb.jpg
    // Strip the original extension and append _thumb.jpg
    const baseName = r2KeyBase.replace(/\.[^.]+$/, '')
    const thumbKey = isPrivate
      ? `private/thumbnails/${tenantSlug}/${baseName.split('/').slice(2).join('/')}_thumb.jpg`
      : `thumbnails/${tenantSlug}/${baseName.split('/').slice(1).join('/')}_thumb.jpg`

    const thumbnailUrl = await uploadToR2(thumbKey, thumbBuffer, 'image/jpeg')

    return {
      thumbnailUrl: isPrivate
        ? `/storage/private/thumbnails/${tenantSlug}/${baseName.split('/').slice(2).join('/')}_thumb.jpg`
        : thumbnailUrl,
      imageWidth: metadata.width,
      imageHeight: metadata.height,
    }
  } catch {
    // Silently fail — thumbnail is optional
    return null
  }
}
