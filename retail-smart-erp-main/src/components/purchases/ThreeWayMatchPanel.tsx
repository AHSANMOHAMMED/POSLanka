'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, AlertTriangle, ShieldAlert } from 'lucide-react'

interface MatchIssue {
  itemName: string
  type: 'price' | 'qty_over_received' | 'qty_over_ordered' | 'not_on_po'
  message: string
}

interface MatchResult {
  status: 'matched' | 'mismatch' | 'not_applicable'
  action: 'warn' | 'block'
  tolerance: { pricePct: number; qtyPct: number }
  issues: MatchIssue[]
  stored?: boolean
}

const TYPE_LABEL: Record<MatchIssue['type'], string> = {
  price: 'Price',
  qty_over_received: 'Qty > received',
  qty_over_ordered: 'Qty > ordered',
  not_on_po: 'Not on PO',
}

/**
 * H3 — 3-way match (invoice vs purchase order vs goods receipts) of a purchase invoice.
 * Submitted invoices show the result stored at submit; drafts a live preview.
 */
export function ThreeWayMatchPanel({ purchaseId, refreshKey }: { purchaseId: string; refreshKey?: string }) {
  const [match, setMatch] = useState<MatchResult | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/purchases/${purchaseId}/match`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!cancelled) setMatch(data) })
      .catch(() => { if (!cancelled) setMatch(null) })
    return () => { cancelled = true }
  }, [purchaseId, refreshKey])

  if (!match || match.status === 'not_applicable') return null

  const ok = match.status === 'matched'
  const blocking = !ok && match.action === 'block'
  const tone = ok
    ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300'
    : blocking
      ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300'
      : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300'
  const Icon = ok ? CheckCircle2 : blocking ? ShieldAlert : AlertTriangle

  return (
    <div className={`rounded border px-4 py-3 mb-4 text-sm ${tone}`}>
      <div className="flex items-center gap-2 font-medium">
        <Icon size={16} />
        <span>
          3-way match: {ok ? 'matched' : `${match.issues.length} mismatch${match.issues.length === 1 ? '' : 'es'}`}
          {!ok && (blocking ? (match.stored ? '' : ' — submitting will be blocked') : ' (warning only)')}
        </span>
        <span className="ml-auto text-xs opacity-75">
          tolerance: price {match.tolerance.pricePct}% · qty {match.tolerance.qtyPct}%{match.stored === false ? ' · preview' : ''}
        </span>
      </div>
      {!ok && (
        <ul className="mt-2 space-y-1">
          {match.issues.map((i, idx) => (
            <li key={idx} className="flex gap-2">
              <span className="inline-block min-w-[96px] text-xs font-semibold uppercase opacity-80">{TYPE_LABEL[i.type]}</span>
              <span>{i.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
