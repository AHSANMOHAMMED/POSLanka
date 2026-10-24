'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { X, Layers, Check, Loader2, AlertCircle } from 'lucide-react'
import { useCurrency } from '@/hooks/useCurrency'
import type { Item } from './types'
import {
  buildVariantRows,
  findVariant,
  initialSelection,
  matchTypedOption,
  optionStock,
  selectOption,
  stepOption,
  variantStock,
  TYPE_RESET_MS,
  type VariantRow,
  type VariantSelection,
} from '@/lib/pos/variant-options'

interface VariantPickerModalProps {
  isOpen: boolean
  parentItem: Item | null
  warehouseId: string | null
  onClose: () => void
  onSelectVariant: (variantItem: Item) => void
}

interface VariantResponse {
  parent: Item
  variants: Item[]
  attributeKeys: string[]
  attributeValues: Record<string, string[]>
}

/**
 * Variant picker (sizes, colours …): one row of large tab buttons per attribute with the stock of
 * each option. Keyboard: ← → move, Tab / ↑ ↓ change row, type "m" / "xl" / "xxl" or a digit to pick,
 * Enter adds to the cart, Esc cancels. Touch / mouse work the same.
 */
export function VariantPickerModal({
  isOpen,
  parentItem,
  warehouseId,
  onClose,
  onSelectVariant,
}: VariantPickerModalProps) {
  const { currency: currencyCode } = useCurrency()
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<VariantResponse | null>(null)
  const [selection, setSelection] = useState<VariantSelection>({})
  const [activeRow, setActiveRow] = useState(0)
  const typeRef = useRef<{ buffer: string; at: number }>({ buffer: '', at: 0 })
  /** Barcode scanners type very fast: collect those keys and treat Enter as a scan */
  const scanRef = useRef<{ buffer: string; at: number }>({ buffer: '', at: 0 })
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen || !parentItem) return
    let isMounted = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setData(null)
    setSelection({})
    setActiveRow(0)
    typeRef.current = { buffer: '', at: 0 }

    const url = `/api/items/${parentItem.id}/variants${warehouseId ? `?warehouseId=${warehouseId}` : ''}`
    fetch(url)
      .then((res) => (res.ok ? res.json() : null))
      .then((res: VariantResponse | null) => {
        if (!isMounted) return
        setData(res)
        if (res && res.variants.length > 0) {
          const rows = buildVariantRows(res.variants, res.attributeKeys, res.attributeValues)
          setSelection(initialSelection(res.variants, rows))
        }
      })
      .catch(() => { if (isMounted) setData(null) })
      .finally(() => { if (isMounted) setLoading(false) })
    return () => { isMounted = false }
  }, [isOpen, parentItem, warehouseId])

  const variants = useMemo(() => data?.variants ?? [], [data])
  const rows: VariantRow[] = useMemo(
    () => buildVariantRows(variants, data?.attributeKeys, data?.attributeValues),
    [variants, data],
  )

  const matchedVariant = useMemo(() => findVariant(variants, rows, selection), [variants, rows, selection])
  const isOutOfStock = !!matchedVariant && variantStock(matchedVariant) <= 0

  /** Per row: stock + disabled state of each option for the current selection */
  const rowInfo = useMemo(() => rows.map((r) => r.options.map((opt) => {
    const s = optionStock(variants, rows, selection, r.key, opt)
    return { ...s, disabled: !s.sellable }
  })), [rows, variants, selection])

  const pick = useCallback((rowIdx: number, value: string) => {
    const row = rows[rowIdx]
    if (!row) return
    setSelection((sel) => selectOption(variants, rows, sel, row.key, value))
    setActiveRow(rowIdx)
  }, [rows, variants])

  const confirm = useCallback(() => {
    if (!matchedVariant || isOutOfStock) return
    onSelectVariant(matchedVariant)
    onClose()
  }, [matchedVariant, isOutOfStock, onSelectVariant, onClose])

  // Keyboard (capture phase so nothing underneath sees the keys while the picker is open)
  useEffect(() => {
    if (!isOpen || !parentItem) return
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const key = e.key
      if (key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return }
      if (loading) return
      if (!data || variants.length === 0) {
        if (key === 'Enter' && parentItem) { e.preventDefault(); e.stopPropagation(); onSelectVariant(parentItem); onClose() }
        return
      }
      const row = rows[activeRow]
      const info = rowInfo[activeRow] || []
      const disabled = info.map((o) => o.disabled)
      const curIdx = row ? row.options.indexOf(selection[row.key]) : -1
      const stop = () => { e.preventDefault(); e.stopPropagation() }

      if (key === 'Enter') {
        // Enter on a focused Cancel / close button keeps its own meaning
        const el = document.activeElement as HTMLElement | null
        if (el?.dataset?.variantCancel) return
        stop()
        const scanned = scanRef.current
        scanRef.current = { buffer: '', at: 0 }
        if (scanned.buffer.length >= 4 && Date.now() - scanned.at < 150) {
          // A variant barcode / SKU scanned while the picker is open → add that variant directly
          const code = scanned.buffer.trim().toLowerCase()
          const hit = variants.find((x) => (x.barcode || '').toLowerCase() === code || (x.sku || '').toLowerCase() === code)
          if (hit && variantStock(hit) > 0) { onSelectVariant(hit); onClose() }
          return
        }
        confirm(); return
      }
      if (key === 'ArrowRight' || key === 'ArrowLeft') {
        if (!row) return
        stop()
        const next = stepOption(disabled, curIdx < 0 ? (key === 'ArrowRight' ? -1 : 0) : curIdx, key === 'ArrowRight' ? 1 : -1)
        if (next >= 0 && !disabled[next]) pick(activeRow, row.options[next])
        return
      }
      if (key === 'Tab' || key === 'ArrowDown' || key === 'ArrowUp') {
        if (rows.length <= 1 && key === 'Tab') { stop(); return }
        stop()
        const back = key === 'ArrowUp' || (key === 'Tab' && e.shiftKey)
        setActiveRow((r) => (r + (back ? rows.length - 1 : 1)) % Math.max(1, rows.length))
        typeRef.current = { buffer: '', at: 0 }
        return
      }
      if (key.length === 1) {
        const now = Date.now()
        const sc = scanRef.current
        scanRef.current = now - sc.at < 40 ? { buffer: sc.buffer + key, at: now } : { buffer: key, at: now }
      }
      if (key.length === 1 && /[\p{L}\p{N}.\-/ ]/u.test(key) && row) {
        stop()
        const now = Date.now()
        if (scanRef.current.buffer.length >= 3) return // scanner burst, not the cashier typing
        const prev = now - typeRef.current.at > TYPE_RESET_MS ? '' : typeRef.current.buffer
        const res = matchTypedOption(row.options, disabled, prev, key)
        typeRef.current = { buffer: res.buffer, at: now }
        if (res.index !== null) pick(activeRow, row.options[res.index])
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [isOpen, parentItem, loading, data, variants, rows, rowInfo, activeRow, selection, pick, confirm, onClose, onSelectVariant])

  // Keep focus inside the dialog (so the POS search box does not receive the typed letters)
  useEffect(() => {
    if (isOpen && !loading) dialogRef.current?.focus()
  }, [isOpen, loading])

  if (!isOpen || !parentItem) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-150 p-4">
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`Choose a variant of ${parentItem.name}`}
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl min-[1920px]:max-w-3xl mx-auto overflow-hidden border border-slate-100 dark:border-gray-700 flex flex-col max-h-[90vh] outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-gray-700 bg-slate-50/70 dark:bg-gray-800/60">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-700 flex items-center justify-center shrink-0">
              <Layers size={20} />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-slate-900 dark:text-white text-base leading-tight">Choose variant</h3>
              <p className="text-sm text-slate-500 dark:text-gray-400 font-medium truncate">{parentItem.name}</p>
            </div>
          </div>
          <button
            type="button"
            data-variant-cancel="1"
            onClick={onClose}
            className="p-1.5 hover:bg-slate-200/60 text-slate-500 rounded-lg transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-5 flex-1">
          {loading && (
            <div className="flex flex-col items-center justify-center py-12 text-slate-500">
              <Loader2 size={32} className="animate-spin text-purple-600 mb-2" />
              <p className="text-sm font-medium">Loading variants...</p>
            </div>
          )}

          {!loading && (!data || variants.length === 0) && (
            <div className="text-center py-10">
              <AlertCircle className="w-12 h-12 text-amber-500 mx-auto mb-2" />
              <p className="font-bold text-slate-800 dark:text-gray-100 text-sm">No variants found</p>
              <p className="text-xs text-slate-500 mt-1">
                You can add the base product directly or configure variants in inventory.
              </p>
              <button
                type="button"
                onClick={() => { onSelectVariant(parentItem); onClose() }}
                className="mt-4 px-4 py-2 bg-purple-600 text-white rounded-xl text-xs font-bold hover:bg-purple-700 transition-colors"
              >
                Add Base Item to Cart <kbd className="ml-1 font-mono opacity-80">Enter</kbd>
              </button>
            </div>
          )}

          {!loading && variants.length > 0 && rows.map((row, rowIdx) => {
            const current = selection[row.key]
            const isActiveRow = rowIdx === activeRow
            return (
              <div key={row.key} className="space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`text-sm font-bold uppercase tracking-wider ${isActiveRow ? 'text-purple-800 dark:text-purple-300' : 'text-slate-600 dark:text-gray-400'}`}>
                    {row.label}: <span className="font-extrabold">{current || 'Select'}</span>
                  </span>
                  {isActiveRow && rows.length > 1 && (
                    <span className="text-[11px] text-slate-400 font-mono">Tab → next</span>
                  )}
                </div>
                <div
                  role="radiogroup"
                  aria-label={row.label}
                  className={`flex flex-wrap gap-2 rounded-xl p-1 -m-1 ${isActiveRow ? 'ring-2 ring-purple-200 dark:ring-purple-800' : ''}`}
                >
                  {row.options.map((opt, optIdx) => {
                    const info = rowInfo[rowIdx]?.[optIdx]
                    const selected = current === opt
                    const disabled = !!info?.disabled
                    const stock = info?.stock ?? 0
                    const stockText = !info?.exists ? '—' : stock === Infinity ? '' : stock <= 0 ? 'Out' : `${stock % 1 === 0 ? stock : stock.toFixed(2)}`
                    return (
                      <button
                        key={opt}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        disabled={disabled}
                        tabIndex={-1}
                        onClick={() => pick(rowIdx, opt)}
                        className={`relative min-w-[4.5rem] min-[1920px]:min-w-[5.5rem] px-4 py-3 min-[1920px]:py-4 rounded-xl border-2 text-center transition-all ${
                          selected
                            ? 'bg-purple-600 border-purple-600 text-white shadow-md'
                            : disabled
                              ? 'bg-slate-50 dark:bg-gray-800 border-slate-200 dark:border-gray-700 text-slate-300 dark:text-gray-600 line-through cursor-not-allowed'
                              : 'bg-white dark:bg-gray-800 border-slate-200 dark:border-gray-600 text-slate-800 dark:text-gray-100 hover:border-purple-400'
                        }`}
                      >
                        {optIdx < 9 && (
                          <span className={`absolute top-0.5 left-1.5 text-[10px] font-mono ${selected ? 'text-purple-200' : 'text-slate-400'}`}>{optIdx + 1}</span>
                        )}
                        <span className="block text-lg min-[1920px]:text-xl font-extrabold leading-tight">{opt}</span>
                        {stockText && (
                          <span className={`block text-[11px] font-semibold mt-0.5 ${
                            selected ? 'text-purple-100' : stockText === 'Out' || stockText === '—' ? 'text-red-500' : 'text-emerald-600 dark:text-emerald-400'
                          }`}>
                            {stockText === 'Out' || stockText === '—' ? stockText : `${stockText} left`}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {/* Selected variant */}
          {!loading && variants.length > 0 && (
            <div className={`rounded-xl p-3.5 flex items-center justify-between gap-3 border ${
              matchedVariant && !isOutOfStock
                ? 'bg-purple-50/80 dark:bg-purple-950/30 border-purple-200/80 dark:border-purple-800'
                : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800'
            }`}>
              <div className="min-w-0">
                <span className="text-sm font-bold text-slate-900 dark:text-white block truncate">
                  {matchedVariant ? matchedVariant.name : 'This combination does not exist'}
                </span>
                {matchedVariant && (
                  <span className="text-xs text-slate-500 font-mono">{matchedVariant.barcode || matchedVariant.sku || ''}</span>
                )}
              </div>
              {matchedVariant && (
                <div className="text-right shrink-0">
                  <span className="text-lg font-extrabold text-purple-900 dark:text-purple-200 font-mono block">
                    {currencyCode} {parseFloat(matchedVariant.sellingPrice).toFixed(2)}
                  </span>
                  {matchedVariant.trackStock && (
                    <span className={`text-xs font-semibold block ${isOutOfStock ? 'text-red-600' : 'text-slate-600 dark:text-gray-400'}`}>
                      {isOutOfStock ? 'Out of stock' : `Stock: ${parseFloat(matchedVariant.availableStock || '0').toFixed(0)}`}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center gap-2.5 p-4 border-t border-slate-100 dark:border-gray-700 bg-slate-50/50 dark:bg-gray-800/40">
          <p className="w-full text-[11px] text-slate-400 font-mono hidden sm:block">
            ← → choose · type m / xl / 2 · {rows.length > 1 ? 'Tab next row · ' : ''}Enter add · Esc cancel
          </p>
          <button
            type="button"
            data-variant-cancel="1"
            onClick={onClose}
            className="flex-1 py-3 px-4 bg-slate-100 dark:bg-gray-700 text-slate-700 dark:text-gray-200 rounded-xl font-semibold text-sm hover:bg-slate-200 transition-colors"
          >
            Cancel <kbd className="ml-1 text-[11px] font-mono opacity-70">Esc</kbd>
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={!matchedVariant || isOutOfStock}
            className="flex-[2] py-3 px-4 bg-purple-600 text-white rounded-xl font-bold text-sm hover:bg-purple-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm"
          >
            <Check size={16} />
            {isOutOfStock ? 'Out of Stock' : 'Add to cart'}
            <kbd className="ml-1 text-[11px] font-mono bg-white/20 px-1 rounded">Enter</kbd>
          </button>
        </div>
      </div>
    </div>
  )
}
