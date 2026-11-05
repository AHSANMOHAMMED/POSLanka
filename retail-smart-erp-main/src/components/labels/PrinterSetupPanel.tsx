'use client'

/**
 * Printer setup on the print page: the user picks the printer brand (sets the
 * command language), can change the language, dpi, darkness, speed, exact /
 * fast mode and type the roll (label size, gaps, columns, offsets) themselves,
 * then test print and Lock. Values are the shop's (stored in label_settings).
 */
import { useState } from 'react'
import { Lock, LockOpen, Printer, Settings2 } from 'lucide-react'
import {
  brandById,
  LABEL_DPIS,
  LABEL_PRINTER_BRANDS,
  PRINT_LANGUAGES,
  type LabelPrintSetup,
  type PrintLanguage,
  type PrintSetupMedia,
} from '@/lib/labels/print-setup'
import type { StickerSetup } from '@/lib/labels/sticker-stock'
import type { SaveState } from './useLabelPrintSetup'

interface Props {
  setup: LabelPrintSetup
  /** Roll in use (typed one or the one from the list). */
  roll: StickerSetup | null
  update: (fn: (s: LabelPrintSetup) => LabelPrintSetup) => boolean
  canManage: boolean
  mode: 'chrome' | 'direct'
  /** Language guessed from the chosen printer's name (direct mode). */
  guessedLanguage?: string | null
  onTestPrint: () => void
  testing?: boolean
  onLock: () => void
  onUnlock: () => void
  saveState: SaveState
}

const MEDIA_FIELDS: { key: keyof PrintSetupMedia; label: string; min: number; max: number; step: number }[] = [
  { key: 'labelWidthMm', label: 'Label width (mm)', min: 10, max: 220, step: 0.5 },
  { key: 'labelHeightMm', label: 'Label height (mm)', min: 5, max: 400, step: 0.5 },
  { key: 'rowGapMm', label: 'Gap between rows (mm)', min: 0, max: 30, step: 0.5 },
  { key: 'columns', label: 'Labels across', min: 1, max: 4, step: 1 },
  { key: 'columnGapMm', label: 'Gap between columns (mm)', min: 0, max: 30, step: 0.5 },
  { key: 'marginLeftMm', label: 'Left margin (mm)', min: 0, max: 30, step: 0.5 },
  { key: 'offsetXMm', label: 'Shift right (mm, - = left)', min: -20, max: 20, step: 0.5 },
  { key: 'offsetYMm', label: 'Shift down (mm, - = up)', min: -20, max: 20, step: 0.5 },
]

/** Number box that applies its value on Enter / leaving the box (so typing "38" does not jump through "3"). */
function NumField({ value, min, max, step, onCommit, placeholder }: { value: number | null; min: number; max: number; step?: number; onCommit: (v: number | null) => void; placeholder?: string }) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft === null) return
    const t = draft.trim()
    setDraft(null)
    if (t === '') return onCommit(null)
    const n = Number(t)
    if (Number.isFinite(n)) onCommit(Math.min(max, Math.max(min, n)))
  }
  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      value={draft ?? (value ?? '')}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
      }}
      className="w-full border rounded px-2 py-1"
    />
  )
}

const LANG_NAME: Record<string, string> = { zpl: 'ZPL', tspl: 'TSPL', epl: 'EPL', 'escpos-raster': 'ESC/POS picture', driver: 'Windows driver' }

export function PrinterSetupPanel({ setup, roll, update, canManage, mode, guessedLanguage, onTestPrint, testing, onLock, onUnlock, saveState }: Props) {
  const locked = setup.locked
  const p = setup.printer
  const brand = brandById(p.brand)
  const lang = p.language
  const effLang = lang || guessedLanguage || null
  const media: PrintSetupMedia | null =
    setup.media ||
    (roll
      ? {
          labelWidthMm: roll.labelWidthMm,
          labelHeightMm: roll.labelHeightMm,
          rowGapMm: roll.rowGapMm,
          columns: roll.columns,
          columnGapMm: roll.columnGapMm,
          marginLeftMm: roll.marginLeftMm,
          offsetXMm: roll.offsetXMm,
          offsetYMm: roll.offsetYMm,
        }
      : null)
  const setPrinter = (patch: Partial<LabelPrintSetup['printer']>) => update((s) => ({ ...s, printer: { ...s.printer, ...patch } }))
  const setMedia = (k: keyof PrintSetupMedia, v: number) => {
    if (!media || !Number.isFinite(v)) return
    update((s) => ({ ...s, media: { ...media, ...(s.media || {}), [k]: v } }))
  }

  return (
    <div className="bg-white rounded-lg border p-4 space-y-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
          <Settings2 size={16} className="text-blue-600" /> Printer setup
        </span>
        <span className="text-[11px] text-gray-500">
          {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved for the shop' : saveState === 'error' ? 'Not saved' : ''}
        </span>
      </div>

      {locked ? (
        <div className="flex items-center justify-between gap-2 p-2 rounded border border-amber-300 bg-amber-50 text-xs text-amber-900">
          <span className="flex items-center gap-1.5">
            <Lock size={13} /> Locked{setup.lockedBy ? ` by ${setup.lockedBy}` : ''}. Everything prints exactly like this.
          </span>
          {canManage && (
            <button type="button" onClick={onUnlock} className="flex items-center gap-1 px-2 py-1 rounded border border-amber-400 bg-white hover:bg-amber-100 font-medium">
              <LockOpen size={12} /> Unlock
            </button>
          )}
        </div>
      ) : canManage ? (
        <div className="flex items-center justify-between gap-2 p-2 rounded border border-gray-200 bg-gray-50 text-xs text-gray-700">
          <span>Set everything up, print a test, then lock it so nobody changes it by mistake.</span>
          <button type="button" onClick={onLock} className="flex items-center gap-1 px-2 py-1 rounded bg-gray-900 text-white hover:bg-gray-700 font-medium shrink-0">
            <Lock size={12} /> Lock setup
          </button>
        </div>
      ) : (
        <p className="text-[11px] text-gray-500">Your changes are kept on this PC only. The owner / a manager can save and lock one setup for everyone.</p>
      )}

      <fieldset disabled={locked} className="space-y-3 disabled:opacity-80">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <label className="col-span-2 space-y-0.5">
            <span className="text-gray-600">Printer brand</span>
            <select
              value={p.brand || ''}
              onChange={(e) => {
                const b = brandById(e.target.value)
                setPrinter({ brand: b?.id ?? null, language: b ? b.language : null })
              }}
              className="w-full border rounded px-2 py-1.5 bg-white"
            >
              <option value="">Detect from the printer name</option>
              {LABEL_PRINTER_BRANDS.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-0.5">
            <span className="text-gray-600">Printer language</span>
            <select value={lang || ''} onChange={(e) => setPrinter({ language: (e.target.value || null) as PrintLanguage | null })} className="w-full border rounded px-2 py-1.5 bg-white">
              <option value="">Auto{guessedLanguage ? ` (${LANG_NAME[guessedLanguage] || guessedLanguage})` : ''}</option>
              {PRINT_LANGUAGES.map((l) => (
                <option key={l.value} value={l.value} title={l.hint}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-0.5">
            <span className="text-gray-600">Resolution</span>
            <select
              value={p.dpi ?? ''}
              onChange={(e) => setPrinter({ dpi: e.target.value ? (Number(e.target.value) as LabelPrintSetup['printer']['dpi']) : null })}
              className="w-full border rounded px-2 py-1.5 bg-white"
            >
              <option value="">From the roll ({roll?.dpi ?? 203} dpi)</option>
              {LABEL_DPIS.map((d) => (
                <option key={d} value={d}>
                  {d} dpi{d === 203 ? ' (8 dots/mm)' : d === 300 ? ' (12 dots/mm)' : ' (24 dots/mm)'}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-0.5">
            <span className="text-gray-600">Darkness (0-30)</span>
            <NumField value={p.darkness} min={0} max={30} placeholder="printer default" onCommit={(v) => setPrinter({ darkness: v })} />
          </label>
          <label className="space-y-0.5">
            <span className="text-gray-600">Speed (inch/s)</span>
            <NumField value={p.speed} min={1} max={14} placeholder="printer default" onCommit={(v) => setPrinter({ speed: v })} />
          </label>
        </div>
        {brand?.note && <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded p-1.5">{brand.note}</p>}

        {mode === 'direct' && effLang !== 'driver' && effLang !== 'escpos-raster' && (
          <div className="text-xs space-y-1">
            <span className="text-gray-600">How labels are sent</span>
            <div className="grid grid-cols-2 gap-1 p-1 bg-gray-100 rounded-lg" role="radiogroup" aria-label="Print mode">
              {(
                [
                  ['exact', 'Exact (as preview)', 'Prints the preview as a picture'],
                  ['fast', 'Fast text', "Printer's own fonts"],
                ] as const
              ).map(([m, title, sub]) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={p.renderMode === m}
                  onClick={() => setPrinter({ renderMode: m })}
                  className={`px-2 py-1 rounded-md text-left ${p.renderMode === m ? 'bg-white text-blue-700 font-semibold shadow-xs border border-blue-400' : 'text-gray-600 hover:bg-gray-200/50'}`}
                >
                  <span className="block">{title}</span>
                  <span className="block text-[10px] font-normal opacity-80">{sub}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {media && (
          <div className="text-xs space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-medium text-gray-700">Label roll {setup.media ? '(typed here)' : `(from "${roll?.name || 'roll'}")`}</span>
              {setup.media && (
                <button type="button" onClick={() => update((s) => ({ ...s, media: null }))} className="text-blue-600 hover:underline">
                  Use the roll list
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
              {MEDIA_FIELDS.map((f) => (
                <label key={f.key} className="space-y-0.5">
                  <span className="text-gray-600">{f.label}</span>
                  <NumField value={media[f.key]} min={f.min} max={f.max} step={f.step} onCommit={(v) => v !== null && setMedia(f.key, v)} />
                </label>
              ))}
            </div>
          </div>
        )}
      </fieldset>

      <button
        type="button"
        onClick={onTestPrint}
        disabled={testing}
        className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded border border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-800 font-medium disabled:opacity-50"
      >
        <Printer size={13} /> {testing ? 'Sending test…' : 'Test print (numbered boxes 1 2 / 3 4)'}
      </button>
    </div>
  )
}
