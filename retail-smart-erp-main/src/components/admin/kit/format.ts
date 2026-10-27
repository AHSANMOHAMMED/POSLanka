/** Formatting helpers shared by console pages. */

export function fmtNumber(n: number | null | undefined, digits = 0): string {
  return (n ?? 0).toLocaleString('en-LK', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/** "LKR 12,450" (no decimals by default). */
export function fmtLKR(n: number | null | undefined, digits = 0): string {
  return `LKR ${fmtNumber(n, digits)}`
}

/** 1.2M / 45.3k / 950 */
export function fmtCompact(n: number | null | undefined): string {
  const v = n ?? 0
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}k`
  return v.toFixed(0)
}

export function timeAgo(iso: string | Date | null | undefined): string {
  if (!iso) return '—'
  const t = typeof iso === 'string' ? Date.parse(iso) : iso.getTime()
  if (!Number.isFinite(t)) return '—'
  const diff = Date.now() - t
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(t).toLocaleDateString('en-LK', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function fmtDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '—'
  const d = typeof iso === 'string' ? new Date(iso) : iso
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-LK', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export const BUSINESS_TYPE_LABELS: Record<string, string> = {
  retail: 'Retail',
  restaurant: 'Restaurant',
  supermarket: 'Supermarket',
  auto_service: 'Auto service',
  dealership: 'Dealership',
  pharmacy: 'Pharmacy',
  electronics: 'Electronics & appliances',
  hardware: 'Hardware',
  print_studio: 'Printing & photo studio',
  office: 'Office & services',
}

export function businessTypeLabel(t: string | null | undefined): string {
  if (!t) return '—'
  return BUSINESS_TYPE_LABELS[t] ?? t.replace(/_/g, ' ')
}
