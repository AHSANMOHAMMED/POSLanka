'use client'

import { useEffect, useState } from 'react'
import { ArrowRightLeft, Loader2 } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { useCurrency } from '@/hooks/useCurrency'

interface Substitute {
  id: string
  name: string
  genericName: string | null
  strength: string | null
  dosageForm: string | null
  drugSchedule: string | null
  sellingPrice: string
  unit: string | null
  trackStock: boolean
  availableStock: number
  sameForm: boolean
}

/**
 * Pharmacy POS: other brands of the same medicine (generic name + strength + dosage form) with the
 * stock in this branch and the price. Picking one swaps it into the cart (GET /api/pharmacy/substitutes).
 */
export function PharmacySubstitutesModal({ item, warehouseId, inCart, onPick, onClose }: {
  item: { id: string; name: string; genericName?: string | null; strength?: string | null; sellingPrice: string }
  warehouseId: string | null
  /** the original is in the cart: the pick replaces it */
  inCart: boolean
  onPick: (substituteId: string) => void
  onClose: () => void
}) {
  const { fCurrency } = useCurrency()
  const [rows, setRows] = useState<Substitute[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const p = new URLSearchParams({ itemId: item.id })
    if (warehouseId) p.set('warehouseId', warehouseId)
    fetch(`/api/pharmacy/substitutes?${p.toString()}`)
      .then(async (r) => {
        const body = await r.json()
        if (!r.ok) throw new Error(body.error || 'Could not load substitutes')
        if (!cancelled) setRows(body.substitutes)
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load substitutes') })
    return () => { cancelled = true }
  }, [item.id, warehouseId])

  const base = Number(item.sellingPrice) || 0

  return (
    <Modal isOpen onClose={onClose} title={`Alternatives for ${item.name}`} size="2xl">
      <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
        Same medicine: <b>{[item.genericName, item.strength].filter(Boolean).join(' ') || '—'}</b>
        {inCart ? ' · choosing one replaces it in the cart' : ''}
      </p>
      {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {!rows && !error ? (
        <div className="flex items-center justify-center py-8 text-gray-500"><Loader2 size={18} className="mr-2 animate-spin" /> Looking for other brands…</div>
      ) : rows && rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500">
          {item.genericName ? 'No other brand with the same generic name and strength.' : 'Add the generic name and strength to this item to find substitutes.'}
        </p>
      ) : rows && (
        <ul className="divide-y rounded border dark:divide-gray-700 dark:border-gray-700">
          {rows.map((s) => {
            const sellable = !s.trackStock || s.availableStock > 0
            const diff = Number(s.sellingPrice) - base
            return (
              <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">
                    {(s.drugSchedule === 'prescription' || s.drugSchedule === 'controlled') && (
                      <span className={`mr-1 rounded px-1 text-xs font-bold ${s.drugSchedule === 'controlled' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>Rx</span>
                    )}
                    {s.name}
                  </div>
                  <div className="text-xs text-gray-500">
                    {[s.strength, s.dosageForm].filter(Boolean).join(' · ')}
                    {!s.sameForm && s.dosageForm === null ? ' · form not recorded' : ''}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-sm">
                  <span className={sellable ? 'text-emerald-700 dark:text-emerald-400' : 'font-semibold text-red-600'}>
                    {s.trackStock ? (s.availableStock > 0 ? `${s.availableStock} in stock` : 'Out of stock') : 'Not stock-tracked'}
                  </span>
                  <span className="w-28 text-right font-mono">
                    {fCurrency(s.sellingPrice)}
                    {base > 0 && diff !== 0 && <span className={`block text-xs ${diff < 0 ? 'text-emerald-600' : 'text-amber-600'}`}>{diff < 0 ? '−' : '+'}{fCurrency(Math.abs(diff))}</span>}
                  </span>
                  <button type="button" disabled={!sellable} onClick={() => onPick(s.id)}
                    className="inline-flex items-center gap-1 rounded theme-btn-primary px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-40">
                    <ArrowRightLeft size={14} /> {inCart ? 'Swap' : 'Add'}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}
