/**
 * H5: offline copy of the pricing data (price lists, promotions, units, unit barcodes) for the web
 * POS — GET /api/price-quote/bundle, kept in localStorage per company so a till that loses the
 * connection keeps applying the same price lists and promotions (the shared engine,
 * src/lib/pricing/engine.ts). The server re-prices every queued sale when it syncs.
 */
import type { OfflinePricingBundle } from '@/lib/pricing/load-context'

const key = (tenantSlug: string | null | undefined) => `poslanka:pricing-bundle:${tenantSlug || 'default'}`
const mem = new Map<string, { at: number; bundle: OfflinePricingBundle }>()
const MAX_AGE_MS = 5 * 60_000

/** Refresh the cached bundle (at most every 5 minutes unless forced). Never throws. */
export async function refreshPricingBundle(tenantSlug: string | null | undefined, force = false): Promise<OfflinePricingBundle | null> {
  const k = key(tenantSlug)
  const cached = mem.get(k)
  if (!force && cached && Date.now() - cached.at < MAX_AGE_MS) return cached.bundle
  try {
    const res = await fetch('/api/price-quote/bundle')
    if (res.ok) {
      const bundle = (await res.json()) as OfflinePricingBundle
      mem.set(k, { at: Date.now(), bundle })
      try { localStorage.setItem(k, JSON.stringify(bundle)) } catch { /* quota: memory only */ }
      return bundle
    }
  } catch {
    /* offline */
  }
  return loadPricingBundleCache(tenantSlug)
}

/** Last downloaded bundle (memory, else localStorage), or null. */
export function loadPricingBundleCache(tenantSlug: string | null | undefined): OfflinePricingBundle | null {
  const k = key(tenantSlug)
  const cached = mem.get(k)
  if (cached) return cached.bundle
  try {
    const raw = localStorage.getItem(k)
    if (!raw) return null
    const bundle = JSON.parse(raw) as OfflinePricingBundle
    mem.set(k, { at: 0, bundle })
    return bundle
  } catch {
    return null
  }
}
