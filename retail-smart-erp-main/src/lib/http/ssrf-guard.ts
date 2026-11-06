import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/**
 * SSRF guard for server-side fetches of user-supplied URLs (e.g. a shop's logo URL).
 * Only http(s) URLs whose host resolves exclusively to public addresses are allowed, so a
 * stored URL can never reach the droplet's metadata service, localhost or the private network.
 */

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((n, part) => (n << 8) + Number(part), 0) >>> 0
}

const PRIVATE_V4: Array<[string, number]> = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]

export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip)
  if (v === 4) {
    const n = ipv4ToInt(ip)
    return PRIVATE_V4.some(([base, bits]) => (n >>> (32 - bits)) === (ipv4ToInt(base) >>> (32 - bits)))
  }
  if (v === 6) {
    const lower = ip.toLowerCase()
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPrivateAddress(mapped[1])
    return lower === '::' || lower === '::1' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) ||
      lower.startsWith('ff') || lower.startsWith('64:ff9b:') || lower.startsWith('2001:db8')
  }
  return true // not an IP at all: treat as unsafe
}

/** Throws unless `rawUrl` is http(s) and every address its host resolves to is public. */
export async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('Invalid URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http(s) URLs are allowed')
  if (url.username || url.password) throw new Error('URLs with credentials are not allowed')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true, verbatim: true })).map((a) => a.address)
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) throw new Error('URL points to a private address')
  return url
}
