'use client'

/**
 * Click-and-adjust panel for one label element on the print page: move, padding,
 * font size, bold, show / hide (barcode: numbers below the bars, bar height and
 * the numbers' size). Every change is a small step and shows in the preview at once.
 */
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Eye, EyeOff, Minus, Plus, RotateCcw, X } from 'lucide-react'
import type { LabelElement } from '@/lib/labels/types'
import { DEFAULT_HRI_PT } from '@/lib/print/label/barcode-fit'
import { elementLabel, type ElementTweak, type TweakMap } from '@/lib/labels/print-setup'

const STEP = 0.5
const r2 = (n: number) => Math.round(n * 100) / 100

interface Props {
  /** Elements before tweaks (hidden ones included). */
  elements: LabelElement[]
  tweaks: TweakMap
  selectedId: string | null
  onSelect: (id: string | null) => void
  onChange: (id: string, tweak: ElementTweak | null) => void
  disabled?: boolean
}

function Stepper({ label, value, onMinus, onPlus, disabled, minusLabel, plusLabel }: { label: string; value: string; onMinus: () => void; onPlus: () => void; disabled?: boolean; minusLabel: string; plusLabel: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-gray-600">{label}</span>
      <div className="flex items-center gap-1">
        <button type="button" disabled={disabled} onClick={onMinus} aria-label={minusLabel} className="p-1 border rounded hover:bg-gray-100 disabled:opacity-40">
          <Minus size={12} />
        </button>
        <b className="w-16 text-center tabular-nums">{value}</b>
        <button type="button" disabled={disabled} onClick={onPlus} aria-label={plusLabel} className="p-1 border rounded hover:bg-gray-100 disabled:opacity-40">
          <Plus size={12} />
        </button>
      </div>
    </div>
  )
}

export function ElementCustomizer({ elements, tweaks, selectedId, onSelect, onChange, disabled }: Props) {
  const el = elements.find((e) => e.id === selectedId) || null
  const t: ElementTweak = (el && tweaks[el.id]) || {}
  const set = (patch: Partial<ElementTweak>) => {
    if (!el || disabled) return
    const next: ElementTweak = { ...t, ...patch }
    for (const k of Object.keys(next) as (keyof ElementTweak)[]) {
      const v = next[k]
      // zero moves and "not hidden" are no change; an explicit bold / numbers choice is kept
      if (v === undefined || v === 0 || (k === 'hidden' && v === false)) delete next[k]
    }
    onChange(el.id, Object.keys(next).length ? next : null)
  }
  const bump = (k: 'dx' | 'dy' | 'pad' | 'font' | 'dh', d: number) => set({ [k]: r2((t[k] || 0) + d) })

  return (
    <div className="p-2.5 rounded-md border border-blue-200 bg-blue-50/40 space-y-2 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-blue-900">Adjust label parts</span>
        {el && (
          <button type="button" onClick={() => onSelect(null)} className="p-0.5 text-gray-400 hover:text-gray-700" aria-label="Close">
            <X size={14} />
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {elements.map((e) => {
          const hidden = !!tweaks[e.id]?.hidden
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => onSelect(e.id === selectedId ? null : e.id)}
              className={`px-1.5 py-0.5 rounded border transition-colors ${e.id === selectedId ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'} ${hidden ? 'line-through opacity-60' : ''}`}
            >
              {elementLabel(e)}
            </button>
          )
        })}
      </div>
      {!el ? (
        <p className="text-gray-500">Click a part of the label in the preview (or a name above) to move it, change its size or hide it.</p>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <b className="text-gray-900">{elementLabel(el)}</b>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={disabled}
                onClick={() => set({ hidden: !t.hidden })}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded border bg-white hover:bg-gray-100 disabled:opacity-40"
              >
                {t.hidden ? <Eye size={12} /> : <EyeOff size={12} />} {t.hidden ? 'Show' : 'Hide'}
              </button>
              <button
                type="button"
                disabled={disabled || !tweaks[el.id]}
                onClick={() => onChange(el.id, null)}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded border bg-white hover:bg-gray-100 disabled:opacity-40"
                title="Undo every change to this part"
              >
                <RotateCcw size={12} /> Reset
              </button>
            </div>
          </div>
          {!t.hidden && (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="text-gray-600">Move</span>
                <div className="flex items-center gap-1">
                  <button type="button" disabled={disabled} onClick={() => bump('dx', -STEP)} aria-label="Move left" className="p-1 border rounded hover:bg-gray-100 disabled:opacity-40">
                    <ArrowLeft size={12} />
                  </button>
                  <button type="button" disabled={disabled} onClick={() => bump('dy', -STEP)} aria-label="Move up" className="p-1 border rounded hover:bg-gray-100 disabled:opacity-40">
                    <ArrowUp size={12} />
                  </button>
                  <button type="button" disabled={disabled} onClick={() => bump('dy', STEP)} aria-label="Move down" className="p-1 border rounded hover:bg-gray-100 disabled:opacity-40">
                    <ArrowDown size={12} />
                  </button>
                  <button type="button" disabled={disabled} onClick={() => bump('dx', STEP)} aria-label="Move right" className="p-1 border rounded hover:bg-gray-100 disabled:opacity-40">
                    <ArrowRight size={12} />
                  </button>
                  <span className="w-24 text-right tabular-nums text-gray-500">
                    {r2(t.dx || 0)} / {r2(t.dy || 0)} mm
                  </span>
                </div>
              </div>
              <Stepper label="Padding" value={`${r2(t.pad || 0)} mm`} disabled={disabled} onMinus={() => bump('pad', -0.25)} onPlus={() => bump('pad', 0.25)} minusLabel="Less padding" plusLabel="More padding" />
              {el.type === 'text' && (
                <>
                  <Stepper label="Font size" value={`${r2(el.fontSize + (t.font || 0))} pt`} disabled={disabled} onMinus={() => bump('font', -0.5)} onPlus={() => bump('font', 0.5)} minusLabel="Smaller font" plusLabel="Bigger font" />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-gray-600">Weight</span>
                    <div className="flex rounded border overflow-hidden">
                      {(['normal', 'bold'] as const).map((w) => {
                        const cur = t.bold === undefined ? el.fontWeight : t.bold ? 'bold' : 'normal'
                        return (
                          <button
                            key={w}
                            type="button"
                            disabled={disabled}
                            onClick={() => set({ bold: w === 'bold' })}
                            className={`px-2 py-0.5 capitalize ${cur === w ? 'bg-blue-600 text-white' : 'bg-white hover:bg-gray-100'} ${w === 'bold' ? 'font-bold' : ''} disabled:opacity-40`}
                          >
                            {w}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </>
              )}
              {el.type === 'barcode' && (
                <>
                  <Stepper label="Bar height" value={`${r2(el.height + (t.dh || 0))} mm`} disabled={disabled} onMinus={() => bump('dh', -STEP)} onPlus={() => bump('dh', STEP)} minusLabel="Shorter bars" plusLabel="Taller bars" />
                  {el.format !== 'qrcode' && (
                    <>
                      <label className="flex items-center justify-between gap-2 cursor-pointer">
                        <span className="text-gray-600">Numbers below bars</span>
                        <input
                          type="checkbox"
                          disabled={disabled}
                          checked={t.showText ?? el.showText}
                          onChange={(e) => set({ showText: e.target.checked })}
                          className="w-3.5 h-3.5"
                        />
                      </label>
                      {(t.showText ?? el.showText) && (
                        <Stepper
                          label="Numbers size"
                          value={`${r2((el.textSizePt ?? DEFAULT_HRI_PT) + (t.font || 0))} pt`}
                          disabled={disabled}
                          onMinus={() => bump('font', -0.5)}
                          onPlus={() => bump('font', 0.5)}
                          minusLabel="Smaller numbers"
                          plusLabel="Bigger numbers"
                        />
                      )}
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
