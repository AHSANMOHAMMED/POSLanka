import { getFromR2, keyFromUrl } from '@/lib/files'
import { assertPublicHttpUrl } from '@/lib/http/ssrf-guard'

/** Bytes of the tenant logo (object storage / local uploads, or our own absolute URL). Server-only. */
export async function loadLogoBytes(logoUrl: string): Promise<Buffer | null> {
  const key = keyFromUrl(logoUrl)
  if (key) {
    const obj = await getFromR2(key)
    if (obj) return obj.buffer
  }
  // Fallback: the stored URL is an absolute http(s) URL (set only by our own upload route).
  if (/^https?:\/\//i.test(logoUrl)) {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 8000)
    try {
      // Never follow the URL to localhost / the metadata service / the private network, and
      // refuse redirects so a public URL cannot bounce the request there either.
      await assertPublicHttpUrl(logoUrl)
      const res = await fetch(logoUrl, { signal: ctrl.signal, redirect: 'error' })
      if (!res.ok) return null
      const ab = await res.arrayBuffer()
      if (ab.byteLength > 5 * 1024 * 1024) return null
      return Buffer.from(ab)
    } catch {
      return null
    } finally {
      clearTimeout(t)
    }
  }
  return null
}
