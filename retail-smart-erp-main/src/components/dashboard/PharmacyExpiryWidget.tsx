'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { AlertTriangle, CalendarClock } from 'lucide-react'
import { useCurrency } from '@/hooks/useCurrency'
import { useRealtimeData } from '@/hooks'

interface Row { batchId: string; itemName: string; batchNumber: string; expiryDate: string; daysLeft: number; quantity: string; stockValue: number }
interface Summary { batches: number; expiredBatches: number; expiredValue: number; expiringValue: number }

/**
 * Pharmacy dashboard alert: expired stock still on the shelf and batches expiring within the
 * pharmacy's alert window (Settings: tenants.settings.pharmacy.expiryAlertDays, default 90).
 */
export function PharmacyExpiryWidget() {
  const { slug } = useParams<{ slug: string }>()
  const { fCurrency } = useCurrency()
  const [days, setDays] = useState<number | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)

  const load = useCallback(async () => {
    try {
      // Alert window from the pharmacy settings (default 90 days)
      const s = await fetch('/api/pharmacy/settings').then((r) => (r.ok ? r.json() : null)).catch(() => null)
      const alertDays = Number(s?.expiryAlertDays) || 90
      const res = await fetch(`/api/pharmacy/expiry?days=${alertDays}`)
      if (!res.ok) return
      const body = await res.json()
      setDays(alertDays)
      setRows(body.data || [])
      setSummary(body.summary || null)
    } catch {
      // the dashboard stays usable without this card
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const t = window.setTimeout(() => { if (!cancelled) void load() }, 0)
    return () => { cancelled = true; window.clearTimeout(t) }
  }, [load])
  useRealtimeData(load, { entityType: 'item-batch', refreshOnMount: false })

  if (!summary || summary.batches === 0) return null
  const expiringBatches = summary.batches - summary.expiredBatches

  return (
    <div className="rounded-lg border border-amber-200 bg-white p-4 shadow-sm dark:border-amber-900 dark:bg-gray-800">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold"><CalendarClock size={18} className="text-amber-600" /> Medicine expiry</h3>
        <div className="flex gap-3 text-sm">
          <Link href={`/c/${slug}/pharmacy/expiry`} className="text-blue-600 hover:underline">Expiry report</Link>
          <Link href={`/c/${slug}/pharmacy/return-list`} className="text-blue-600 hover:underline">Return to supplier</Link>
        </div>
      </div>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div className={`rounded border p-3 ${summary.expiredBatches > 0 ? 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30' : 'dark:border-gray-700'}`}>
          <div className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300">{summary.expiredBatches > 0 && <AlertTriangle size={12} className="text-red-600" />} Expired, still in stock</div>
          <div className="text-lg font-semibold text-red-600">{summary.expiredBatches} batch{summary.expiredBatches === 1 ? '' : 'es'}</div>
          <div className="text-xs text-gray-500">{fCurrency(summary.expiredValue)} at cost</div>
        </div>
        <div className="rounded border p-3 dark:border-gray-700">
          <div className="text-xs text-gray-600 dark:text-gray-300">Expiring in {days} days</div>
          <div className="text-lg font-semibold text-amber-600">{expiringBatches} batch{expiringBatches === 1 ? '' : 'es'}</div>
          <div className="text-xs text-gray-500">{fCurrency(summary.expiringValue)} at cost</div>
        </div>
      </div>
      <ul className="divide-y text-sm dark:divide-gray-700">
        {rows.slice(0, 6).map((r) => (
          <li key={r.batchId} className="flex items-center justify-between gap-2 py-1.5">
            <span className="min-w-0 truncate">{r.itemName} <span className="text-xs text-gray-500">({r.batchNumber})</span></span>
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold ${r.daysLeft < 0 ? 'bg-red-100 text-red-700' : r.daysLeft <= 30 ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-700'}`}>
              {r.daysLeft < 0 ? `expired ${-r.daysLeft} d ago` : `${r.daysLeft} d left`} · {Number(r.quantity)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
