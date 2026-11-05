'use client'

import { useState } from 'react'
import { ShieldCheck, Loader2 } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { PAPER_SIZES, printWarrantyCard, type PaperSize, type WarrantyCardData } from './print-docs'

/**
 * "Warranty card" for a sale (one card per serial-numbered unit / line with a warranty) or for
 * one unit (serial-number page). Loads /api/warranty-card, then prints on the chosen paper.
 */
export function WarrantyCardButton({ saleId, serialNumberId, className, compact }: {
  saleId?: string; serialNumberId?: string; className?: string; compact?: boolean
}) {
  const [paper, setPaper] = useState<PaperSize>('a5')
  const [busy, setBusy] = useState(false)

  async function print() {
    setBusy(true)
    try {
      const qs = saleId ? `saleId=${encodeURIComponent(saleId)}` : `serialNumberId=${encodeURIComponent(serialNumberId || '')}`
      const res = await fetch(`/api/warranty-card?${qs}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || 'Could not load the warranty card'); return }
      const card = data as WarrantyCardData
      if (!card.lines?.length) { toast.error('No item on this sale has a warranty or a serial number'); return }
      await printWarrantyCard(card, paper)
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className={`flex items-center gap-1 ${className || ''}`}>
      {!compact && (
        <select aria-label="Warranty card paper" className="h-8 px-1 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800" value={paper} onChange={(e) => setPaper(e.target.value as PaperSize)}>
          {PAPER_SIZES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      )}
      <button type="button" onClick={print} disabled={busy}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:border-blue-500 disabled:opacity-50">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />} Warranty card
      </button>
    </span>
  )
}
