// Offline receipt references (pure; shared by localdb and the offline queue, tested under Node).
//
//   OFF-<device code>-<seq>          e.g. OFF-K7QD2X-00042   (≤ 40 chars: sales.offline_ref)
//
// The server keeps offline refs unique per tenant, so the tenant is already the scope; an
// optional `prefix` (e.g. a tenant / counter tag) is inserted only while the ref stays ≤ 40.
export const OFFLINE_REF_MAX = 40

export function formatOfflineRef(deviceCode: string, seq: number, prefix?: string | null): string {
  const base = `${deviceCode}-${String(seq).padStart(5, '0')}`
  const tag = String(prefix || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const withTag = tag ? `OFF-${tag}-${base}` : ''
  return withTag && withTag.length <= OFFLINE_REF_MAX ? withTag : `OFF-${base}`.slice(0, OFFLINE_REF_MAX)
}

/**
 * Reference to retry with after OFFLINE_REF_CONFLICT (another sale already uses the printed one):
 * deterministic per sale, so repeated retries reuse it. The printed ref travels as `offlineRefAlias`.
 */
export function conflictOfflineRef(printedRef: string, clientSaleId: string): string {
  const suffix = `-${clientSaleId.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase()}`
  return printedRef.slice(0, OFFLINE_REF_MAX - suffix.length) + suffix
}
