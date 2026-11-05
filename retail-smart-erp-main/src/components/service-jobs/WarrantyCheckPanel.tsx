'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Search, ShieldCheck, ShieldAlert, Loader2 } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { WarrantyCardButton } from './WarrantyCardButton'

interface CheckResult {
  found: boolean; inWarranty: boolean; warrantyUntil: string | null; serialNumberId: string | null; serialNumber: string | null
  itemName: string | null; saleId: string | null; invoiceNo: string | null; saleDate: string | null
  customerName: string | null; customerPhone: string | null; imeiWarning?: string | null
}

/** Quick warranty check at the counter: serial / IMEI / invoice / phone → sold here? until when? */
export function WarrantyCheckPanel({ slug }: { slug: string }) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<CheckResult | null>(null)

  async function check() {
    if (q.trim().length < 3) return
    setBusy(true)
    try {
      const r = await fetch(`/api/service-jobs/warranty-check?q=${encodeURIComponent(q.trim())}`)
      const data = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(data.error || 'Warranty check failed'); return }
      setRes(data)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck size={16} className="text-blue-600" />
        <span className="text-sm font-medium text-gray-800 dark:text-gray-100">Warranty check</span>
        <div className="relative flex-1 min-w-[14rem]">
          <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') check() }}
            placeholder="Serial / IMEI, invoice no. or phone"
            className="h-9 w-full pl-8 pr-3 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>
        <button onClick={check} disabled={busy} className="flex items-center gap-1 h-9 px-3 text-sm rounded bg-blue-600 text-white disabled:opacity-50">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Check
        </button>
      </div>
      {res && (
        res.found ? (
          <div className={`flex flex-wrap items-center gap-3 text-sm rounded px-3 py-2 ${res.inWarranty ? 'bg-green-50 text-green-900 dark:bg-green-900/30 dark:text-green-100' : 'bg-amber-50 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100'}`}>
            {res.inWarranty ? <ShieldCheck size={16} /> : <ShieldAlert size={16} />}
            <span>
              <b>{res.itemName || 'Unit'}</b>{res.serialNumber ? ` (${res.serialNumber})` : ''} — sold {res.saleDate || '—'} on{' '}
              {res.saleId ? <Link className="underline" href={`/c/${slug}/sales/${res.saleId}`}>{res.invoiceNo}</Link> : res.invoiceNo}
              {res.customerName ? ` to ${res.customerName}` : ''} · {res.inWarranty ? `under warranty until ${res.warrantyUntil}` : res.warrantyUntil ? `warranty ended ${res.warrantyUntil}` : 'no warranty recorded'}
            </span>
            {res.saleId && <WarrantyCardButton saleId={res.serialNumberId ? undefined : res.saleId} serialNumberId={res.serialNumberId || undefined} compact />}
          </div>
        ) : (
          <div className="text-sm text-gray-500">Not found in this shop’s sales.{res.imeiWarning ? ` ${res.imeiWarning}.` : ''}</div>
        )
      )}
    </div>
  )
}
