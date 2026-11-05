/**
 * Optional network lock for attendance terminals. ADMS push sends only the serial number, so a
 * device can be limited to the shop's internet address(es). Pure (no node:net) so the validation
 * schema can use it in the browser too.
 */

const V4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/
const V6 = /^[0-9a-f:]+$/i

function v4ToInt(ip: string): number {
  return ip.split('.').reduce((n, part) => (n * 256) + Number(part), 0)
}

function isV6(ip: string): boolean {
  return ip.includes(':') && V6.test(ip) && ip.length <= 39
}

/** "203.0.113.10", "203.0.113.0/24" or an IPv6 address */
export function isIpOrCidr(value: string): boolean {
  const v = value.trim()
  const slash = v.indexOf('/')
  if (slash === -1) return V4.test(v) || isV6(v)
  const bits = v.slice(slash + 1)
  return V4.test(v.slice(0, slash)) && /^\d{1,2}$/.test(bits) && Number(bits) <= 32
}

/** Strip an IPv4-mapped IPv6 prefix (::ffff:1.2.3.4) so it matches an IPv4 entry. */
function normalize(ip: string): string {
  const v = ip.trim().toLowerCase()
  return v.startsWith('::ffff:') && V4.test(v.slice(7)) ? v.slice(7) : v
}

/** True when no lock is set, or `ip` matches one of the entries. */
export function ipAllowed(ip: string, allowed: readonly string[] | null | undefined): boolean {
  if (!allowed || allowed.length === 0) return true
  const addr = normalize(ip)
  return allowed.some((entry) => {
    const e = entry.trim().toLowerCase()
    const slash = e.indexOf('/')
    if (slash === -1) return normalize(e) === addr
    if (!V4.test(addr)) return false
    const bits = Number(e.slice(slash + 1))
    if (bits === 0) return true
    const mask = bits >= 32 ? 0xffffffff : (~((1 << (32 - bits)) - 1)) >>> 0
    return ((v4ToInt(addr) & mask) >>> 0) === ((v4ToInt(e.slice(0, slash)) & mask) >>> 0)
  })
}
