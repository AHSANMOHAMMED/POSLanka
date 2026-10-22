'use client'

import { useEffect, useState } from 'react'
import { Check, Copy, KeyRound } from 'lucide-react'
import { sharedJson } from '@/lib/client/shared-fetch'

/** PL985633 → PL-985633 (same as formatBusinessId in lib/tenant/business-id, which is server-only) */
export function formatBusinessId(id: string | null | undefined): string {
  if (!id) return ''
  return /^PL\d{6}$/.test(id) ? `${id.slice(0, 2)}-${id.slice(2)}` : id
}

/** Loads the tenant's permanent Business ID (GET /api/tenant) unless one is passed in. */
export function useBusinessId(initial?: string | null): string | null {
  const [businessId, setBusinessId] = useState<string | null>(initial ?? null)
  useEffect(() => {
    if (initial) return
    let cancelled = false
    sharedJson<{ businessId?: string | null }>('/api/tenant', { maxAgeMs: 300_000 })
      .then((t) => { if (!cancelled) setBusinessId(t?.businessId || null) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [initial])
  return initial ?? businessId
}

interface BusinessIdBadgeProps {
  businessId?: string | null
  /** 'banner' = sentence for staff ("Staff sign in with Business ID …"); 'field' = read-only form field */
  variant?: 'banner' | 'field'
  className?: string
}

/**
 * Read-only Business ID with a copy button. Staff type it on the sign-in screen (web and
 * mobile) to identify this business; it never changes.
 */
export function BusinessIdBadge({ businessId: given, variant = 'banner', className = '' }: BusinessIdBadgeProps) {
  const businessId = useBusinessId(given)
  const [copied, setCopied] = useState(false)
  if (!businessId) return null
  const display = formatBusinessId(businessId)

  async function copy() {
    try {
      await navigator.clipboard.writeText(display)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard blocked (insecure context) — the ID stays selectable
    }
  }

  const copyButton = (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 shrink-0"
      aria-label="Copy Business ID"
    >
      {copied ? <Check size={12} className="text-green-600" /> : <Copy size={12} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )

  if (variant === 'field') {
    return (
      <div className={`flex flex-wrap items-center gap-2 ${className}`}>
        <span className="font-mono text-base font-semibold tracking-wider px-3 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white select-all">
          {display}
        </span>
        {copyButton}
      </div>
    )
  }

  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 rounded-md border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 text-sm text-blue-900 dark:text-blue-200 ${className}`}>
      <KeyRound size={14} className="shrink-0" />
      <span className="min-w-0">
        Staff sign in with Business ID{' '}
        <span className="font-mono font-semibold tracking-wider select-all">{display}</span>
      </span>
      {copyButton}
    </div>
  )
}
