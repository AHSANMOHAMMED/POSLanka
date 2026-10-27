'use client'

import { useMemo, useRef, useState } from 'react'
import { X, Ruler, Check, Trash2, Plus } from 'lucide-react'
import { FormInput } from '@/components/ui/form-elements'
import { useCurrency } from '@/hooks/useCurrency'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import {
  calculateSizeLine, round2, SIZE_PRESETS, SIZE_UNITS, AREA_UNIT_LABEL, LENGTH_UNIT_LABEL,
  FINISHING_ADDONS, FINISHING_BY_CODE,
  type SizeUnit, type AreaUnit, type FinishingInput,
} from '@/lib/print-jobs/size-pricing'
import type { CartSizeSpec } from './types'
import { Kbd } from './Kbd'

const LAST_UNIT_KEY = 'pos.sizeEntry.unit'

function readLastUnit(): SizeUnit | null {
  try {
    const v = window.localStorage.getItem(LAST_UNIT_KEY)
    return SIZE_UNITS.some((u) => u.value === v) ? (v as SizeUnit) : null
  } catch {
    return null
  }
}

function saveLastUnit(u: SizeUnit) {
  try { window.localStorage.setItem(LAST_UNIT_KEY, u) } catch { /* private window */ }
}

export { sizeLineName, foldSizeLine } from './size-line'

export interface SizeEntryTarget {
  name: string
  pricingMode: 'area' | 'length'
  areaUnit: AreaUnit
  minChargeArea: number | null
  /** price per sq ft / sq m / running ft (the line's current price when editing) */
  rate: number
  /** editing an existing cart line */
  initial?: CartSizeSpec
}

/**
 * Print studio: width × height (or running length), unit, pieces and sides for an area / length
 * priced item. Uses the shared calculator (src/lib/print-jobs/size-pricing.ts) so the POS line is
 * the same number a print job / quote gives. Mount only while open. Enter confirms, Esc cancels.
 */
export function SizeEntryDialog({ target, onClose, onConfirm, onRemove }: {
  target: SizeEntryTarget
  onClose: () => void
  /** spec.rate / spec.finishing carry the print rate and add-ons (price with foldSizeLine) */
  onConfirm: (spec: CartSizeSpec, billQty: number) => void
  /** editing: remove the line instead */
  onRemove?: () => void
}) {
  const { currency: currencyCode } = useCurrency()
  const init = target.initial
  const isLength = target.pricingMode === 'length'
  const [width, setWidth] = useState(init ? String(init.width) : '')
  const [height, setHeight] = useState(init?.height ? String(init.height) : '')
  const [unit, setUnit] = useState<SizeUnit>(() => init?.sizeUnit || readLastUnit() || (target.areaUnit === 'sqm' ? 'm' : 'ft'))
  const [pieces, setPieces] = useState(init ? String(init.pieces) : '1')
  const [sides, setSides] = useState(init?.sides === 2 ? 2 : 1)
  const [finishing, setFinishing] = useState<FinishingInput[]>(() => (init?.finishing || []).map((f) => ({ ...f })))
  const widthRef = useRef<HTMLInputElement>(null)

  const w = parseFloat(width) || 0
  const h = parseFloat(height) || 0
  const qty = Math.max(0, Math.floor(parseFloat(pieces) || 0))
  const calc = useMemo(() => calculateSizeLine({
    pricingMode: target.pricingMode,
    width: w,
    height: isLength ? null : h,
    sizeUnit: unit,
    quantity: qty,
    rate: target.rate,
    areaUnit: target.areaUnit,
    minChargeArea: target.minChargeArea,
    sides,
    finishing,
  }), [target.pricingMode, target.rate, target.areaUnit, target.minChargeArea, w, h, isLength, unit, qty, sides, finishing])

  const valid = w > 0 && (isLength || h > 0) && qty > 0 && calc.billQty > 0
  const qtyLabel = isLength ? LENGTH_UNIT_LABEL[target.areaUnit] : AREA_UNIT_LABEL[target.areaUnit]

  function confirm() {
    if (!valid) {
      widthRef.current?.focus()
      return
    }
    saveLastUnit(unit)
    onConfirm({
      pricingMode: target.pricingMode,
      areaUnit: target.areaUnit,
      width: w,
      height: isLength ? null : h,
      sizeUnit: unit,
      pieces: qty,
      sides,
      minChargeArea: target.minChargeArea,
      baseName: init?.baseName || target.name,
      rate: target.rate,
      finishing: finishing.length ? finishing : undefined,
    }, calc.billQty)
  }

  useEscapeKey(true, onClose, confirm)

  function pickPreset(p: (typeof SIZE_PRESETS)[number]) {
    setWidth(String(p.width))
    setHeight(String(p.height))
    setUnit(p.unit)
    widthRef.current?.focus()
  }

  const numInput = 'text-xl font-bold text-center'
  const addOnUnit = (basis: string) => basis === 'area' ? `/ ${AREA_UNIT_LABEL[target.areaUnit]}`
    : basis === 'perimeter' ? `/ running ${LENGTH_UNIT_LABEL[target.areaUnit]}` : basis === 'count' ? '/ each' : ''
  function addFinishing(code: string) {
    const def = FINISHING_BY_CODE[code]
    setFinishing((prev) => [...prev, { code, label: def.label, rate: 0, count: def.basis === 'count' || def.basis === 'fixed' ? def.defaultCount ?? 1 : undefined }])
  }
  const patchFinishing = (i: number, patch: Partial<FinishingInput>) => setFinishing((prev) => prev.map((f, j) => (j === i ? { ...f, ...patch } : f)))

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-label={`Size for ${target.name}`}>
      <form
        onSubmit={(e) => { e.preventDefault(); confirm() }}
        className="bg-white dark:bg-gray-800 rounded-3xl w-full max-w-md shadow-2xl border border-gray-100 dark:border-gray-700 overflow-hidden"
      >
        <div className="px-5 py-4 flex items-center justify-between border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-teal-100 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 flex items-center justify-center shrink-0">
              <Ruler size={18} />
            </div>
            <div className="min-w-0">
              <h2 className="font-bold text-gray-900 dark:text-white truncate">{init?.baseName || target.name}</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {currencyCode} {target.rate.toFixed(2)} per {qtyLabel}
                {target.minChargeArea ? ` · min ${target.minChargeArea} ${qtyLabel} per piece` : ''}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400" aria-label="Cancel">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {!isLength && (
            <div className="flex flex-wrap gap-1.5">
              {SIZE_PRESETS.map((p) => (
                <button
                  key={p.code}
                  type="button"
                  onClick={() => pickPreset(p)}
                  className={`px-2 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                    w === p.width && h === p.height && unit === p.unit
                      ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/40 text-teal-800 dark:text-teal-300'
                      : 'border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  {p.group === 'paper' ? p.code : p.label.replace(' in', '″')}
                </button>
              ))}
            </div>
          )}

          <div className={`grid gap-2 items-end ${isLength ? 'grid-cols-2' : 'grid-cols-[1fr_auto_1fr]'}`}>
            <label className="block">
              <span className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">{isLength ? 'Length' : 'Width'}</span>
              <FormInput
                ref={widthRef}
                type="number"
                inputMode="decimal"
                step="any"
                min={0}
                inputSize="lg"
                value={width}
                autoFocus
                onFocus={(e) => e.target.select()}
                onChange={(e) => setWidth(e.target.value)}
                className={numInput}
                aria-label={isLength ? 'Length' : 'Width'}
              />
            </label>
            {!isLength && <span className="pb-3 text-gray-400 font-bold">×</span>}
            {!isLength && (
              <label className="block">
                <span className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Height</span>
                <FormInput
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min={0}
                  inputSize="lg"
                  value={height}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setHeight(e.target.value)}
                  className={numInput}
                  aria-label="Height"
                />
              </label>
            )}
            {isLength && (
              <label className="block">
                <span className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Pieces</span>
                <FormInput type="number" inputMode="numeric" step="1" min={1} inputSize="lg" value={pieces}
                  onFocus={(e) => e.target.select()} onChange={(e) => setPieces(e.target.value)} className={numInput} aria-label="Pieces" />
              </label>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Unit">
            {SIZE_UNITS.map((u) => (
              <button
                key={u.value}
                type="button"
                role="radio"
                aria-checked={unit === u.value}
                onClick={() => setUnit(u.value)}
                className={`px-3 py-1.5 rounded-lg text-sm font-bold border transition-colors ${
                  unit === u.value
                    ? 'theme-btn-primary text-white border-transparent'
                    : 'border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                {u.label}
              </button>
            ))}
          </div>

          <div className={`grid gap-3 ${isLength ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {!isLength && (
              <label className="block">
                <span className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Pieces</span>
                <FormInput type="number" inputMode="numeric" step="1" min={1} inputSize="md" value={pieces}
                  onFocus={(e) => e.target.select()} onChange={(e) => setPieces(e.target.value)} className="font-bold text-center" aria-label="Pieces" />
              </label>
            )}
            <div>
              <span className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Sides</span>
              <div className="flex gap-1.5">
                {[1, 2].map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={sides === n}
                    onClick={() => setSides(n)}
                    className={`flex-1 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                      sides === n
                        ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/40 text-teal-800 dark:text-teal-300'
                        : 'border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
                    }`}
                  >
                    {n === 1 ? 'Single' : 'Double'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Finishing add-ons (folded into this line's price, see foldSizeLine) */}
          <div className="space-y-1.5">
            <span className="block text-xs font-semibold text-gray-600 dark:text-gray-300">Finishing</span>
            {finishing.map((f, i) => {
              const def = FINISHING_BY_CODE[f.code] || FINISHING_BY_CODE.other
              const res = calc.finishing[i]
              return (
                <div key={i} className="flex flex-wrap items-center gap-1.5 text-sm">
                  {def.code === 'other' ? (
                    <FormInput inputSize="sm" className="w-28" value={f.label || ''} placeholder="Add-on" onChange={(e) => patchFinishing(i, { label: e.target.value })} aria-label="Add-on name" />
                  ) : (
                    <span className="w-28 truncate font-medium text-gray-700 dark:text-gray-200">{def.label}</span>
                  )}
                  {(def.basis === 'count' || def.basis === 'fixed') && (
                    <FormInput type="number" inputSize="sm" min={0} step="1" className="w-14 text-center" value={f.count ?? ''} title={def.countLabel}
                      aria-label={def.countLabel || 'Count'}
                      onChange={(e) => patchFinishing(i, { count: e.target.value === '' ? null : parseFloat(e.target.value) })} />
                  )}
                  <FormInput type="number" inputSize="sm" min={0} step="0.01" className="w-20 text-right" value={f.rate || ''} placeholder="Rate"
                    aria-label={`${def.label} rate`} onChange={(e) => patchFinishing(i, { rate: parseFloat(e.target.value) || 0 })} />
                  <span className="text-xs text-gray-500 dark:text-gray-400">{addOnUnit(def.basis)}</span>
                  <span className="ml-auto font-mono text-xs text-gray-700 dark:text-gray-200">{res ? res.amount.toFixed(2) : ''}</span>
                  <button type="button" onClick={() => setFinishing((prev) => prev.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600" aria-label={`Remove ${def.label}`}>
                    <X size={14} />
                  </button>
                </div>
              )
            })}
            <div className="flex flex-wrap gap-1">
              {FINISHING_ADDONS.filter((f) => f.code !== 'other' ? !finishing.some((x) => x.code === f.code) : true).map((f) => (
                <button key={f.code} type="button" onClick={() => addFinishing(f.code)}
                  className="px-2 py-0.5 text-xs rounded-full border border-dashed border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-teal-500 hover:text-teal-700 flex items-center gap-0.5">
                  <Plus size={11} /> {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl bg-gray-50 dark:bg-gray-700/40 p-4 text-sm space-y-1">
            <div className="flex justify-between text-gray-600 dark:text-gray-300">
              <span>{isLength ? 'Length per piece' : 'Area per piece'}</span>
              <span className="font-mono">
                {round2(isLength ? calc.billablePerPiece : calc.areaPerPiece)} {qtyLabel}
                {calc.minChargeApplied && <span className="ml-1 text-amber-700 dark:text-amber-400">(min {round2(calc.billablePerPiece)})</span>}
              </span>
            </div>
            <div className="flex justify-between text-gray-600 dark:text-gray-300">
              <span>Billable</span>
              <span className="font-mono font-semibold">{round2(calc.billQty)} {qtyLabel}</span>
            </div>
            {calc.finishing.length > 0 && (
              <>
                <div className="flex justify-between text-gray-600 dark:text-gray-300">
                  <span>Print</span>
                  <span className="font-mono">{calc.baseAmount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-gray-600 dark:text-gray-300">
                  <span>Finishing</span>
                  <span className="font-mono">{calc.finishingAmount.toFixed(2)}</span>
                </div>
              </>
            )}
            <div className="flex justify-between items-baseline pt-1 border-t border-gray-200 dark:border-gray-600">
              <span className="font-semibold text-gray-800 dark:text-gray-100">Amount</span>
              <span className="text-2xl font-bold font-mono text-gray-900 dark:text-white">{currencyCode} {calc.amount.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 bg-gray-50 dark:bg-gray-900/40 border-t border-gray-100 dark:border-gray-700 flex gap-2">
          {onRemove ? (
            <button type="button" onClick={onRemove} className="px-3 py-3 rounded-xl border-2 border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30" aria-label="Remove line" title="Remove line">
              <Trash2 size={18} />
            </button>
          ) : null}
          <button type="button" onClick={onClose} className="flex-1 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-medium hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center gap-2">
            Cancel <Kbd>Esc</Kbd>
          </button>
          <button type="submit" disabled={!valid} className="flex-1 py-3 rounded-xl theme-btn-primary text-white font-bold disabled:opacity-50 flex items-center justify-center gap-2">
            <Check size={18} /> {init ? 'Update' : 'Add'} <Kbd tone="dark">Enter</Kbd>
          </button>
        </div>
      </form>
    </div>
  )
}
