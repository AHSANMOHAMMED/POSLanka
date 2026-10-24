'use client'

/**
 * Sticker stock / label printer setups: pick a roll preset, calibrate gaps and
 * offsets against a true-scale preview, print an alignment pattern, then lock
 * the setup so cashiers print with it as is.
 */
import { useEffect, useMemo, useState } from 'react'
import { Lock, Unlock, Trash2, Save, Loader2, Crosshair, Ruler, Star } from 'lucide-react'
import { SectionCard } from '@/components/ui/section-card'
import { FormInput, FormField, FormSelect, FormCheckbox } from '@/components/ui/form-elements'
import { toast } from '@/components/ui/toast'
import { usePermission } from '@/hooks/usePermission'
import { useStickerSetups } from '@/hooks/useStickerSetups'
import { usePrinters } from '@/hooks/usePrinter'
import { StickerRollPreview } from '@/components/labels/StickerRollPreview'
import { labelAlignmentTemplate } from '@/lib/print/label'
import { printLabelsRaw, isRawLabelPrinter } from '@/lib/labels/label-print'
import {
  STICKER_PRESETS,
  newStickerSetup,
  setupFromPreset,
  stickerRollWidthMm,
  type StickerSetup,
} from '@/lib/labels/sticker-stock'

interface Warehouse {
  id: string
  name: string
}

export function StickerSetupsManager() {
  const isAdmin = usePermission('manageSettings')
  const canCalibrate = usePermission('manageInventory') || isAdmin
  const { setups, loading, save } = useStickerSetups()
  const { printers } = usePrinters()
  const labelPrinters = printers.filter((p) => isRawLabelPrinter(p))
  const [draft, setDraft] = useState<StickerSetup[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [testPrinterId, setTestPrinterId] = useState('')
  const [trueSize, setTrueSize] = useState(false)

  const list = draft ?? setups
  const dirty = draft !== null
  const selected = list.find((s) => s.id === selectedId) || list[0] || null
  const readOnly = !canCalibrate || (!!selected?.locked && !isAdmin)

  useEffect(() => {
    fetch('/api/warehouses?all=true&activeOnly=true')
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setWarehouses((Array.isArray(d) ? d : d.data || []).map((w: Warehouse) => ({ id: w.id, name: w.name }))))
      .catch(() => {})
  }, [])

  const alignTemplate = useMemo(
    () => (selected ? labelAlignmentTemplate(selected.labelWidthMm, selected.labelHeightMm) : null),
    [selected]
  )

  const edit = (patch: Partial<StickerSetup>) => {
    if (!selected) return
    setDraft(list.map((s) => (s.id === selected.id ? { ...s, ...patch } : patch.isDefault ? { ...s, isDefault: false } : s)))
  }

  const add = (presetId: string) => {
    const p = STICKER_PRESETS.find((x) => x.id === presetId)
    const s = p ? setupFromPreset(p, { isDefault: list.length === 0 }) : newStickerSetup({ isDefault: list.length === 0 })
    setDraft([...list, s])
    setSelectedId(s.id)
  }

  const remove = () => {
    if (!selected) return
    setDraft(list.filter((s) => s.id !== selected.id))
    setSelectedId(null)
  }

  const persist = async () => {
    if (!draft) return
    setSaving(true)
    const err = await save(draft)
    setSaving(false)
    if (err) toast.error(err)
    else {
      toast.success('Label setups saved')
      setDraft(null)
    }
  }

  const testPrint = async () => {
    const printer = labelPrinters.find((p) => p.id === testPrinterId) || labelPrinters[0]
    if (!selected || !alignTemplate) return
    if (!printer) {
      toast.error('Add a USB / Bluetooth / print-agent label printer first (Manage printers on the print page)')
      return
    }
    const res = await printLabelsRaw(printer, alignTemplate, [{ item: null, quantity: selected.columns * 2 }], { setup: selected })
    if (res.warnings.length) toast.warning(res.warnings.slice(0, 3).join('; '))
    if (res.ok) toast.success(`Alignment pattern sent to ${printer.name}`)
    else toast.error(res.error || 'Test print failed')
  }

  const num = (v: string) => (v === '' ? 0 : Number(v))

  return (
    <SectionCard
      title="Sticker stock & printer setup"
      icon={<Ruler size={16} />}
      actions={
        canCalibrate ? (
          <button
            type="button"
            onClick={persist}
            disabled={!dirty || saving}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-xs font-semibold"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            Save
          </button>
        ) : null
      }
    >
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
        Describe the label roll in the printer: label size, how many labels across, the gaps and the liner margin. Print the
        alignment pattern, nudge the offsets until every border sits evenly inside its sticker, then lock the setup so the
        counter staff cannot change it.
      </p>

      {loading && !list.length ? (
        <p className="text-sm text-gray-400">Loading...</p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {list.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelectedId(s.id)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded border ${
                  selected?.id === s.id
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-gray-50 hover:bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700'
                }`}
              >
                {s.locked && <Lock size={11} />}
                {s.isDefault && <Star size={11} />}
                {s.name}
              </button>
            ))}
            {canCalibrate && (
              <FormSelect
                value=""
                onChange={(e) => e.target.value && add(e.target.value)}
                selectSize="sm"
                className="w-auto"
                aria-label="Add a roll"
              >
                <option value="">+ Add roll...</option>
                {STICKER_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.note})
                  </option>
                ))}
                <option value="custom">Custom size</option>
              </FormSelect>
            )}
          </div>

          {!selected ? (
            <p className="text-sm text-gray-500">
              No setups yet. {canCalibrate ? 'Add the roll you use from the list above.' : 'Ask an admin to add one.'}
            </p>
          ) : (
            <>
              {selected.locked && (
                <div className="flex items-center gap-2 rounded border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-xs p-2">
                  <Lock size={13} />
                  Locked{selected.lockedBy ? ` by ${selected.lockedBy}` : ''}
                  {selected.lockedAt ? ` on ${new Date(selected.lockedAt).toLocaleDateString()}` : ''}.
                  {isAdmin ? ' Unlock to recalibrate.' : ' Only an admin can change it.'}
                </div>
              )}
              <fieldset disabled={readOnly} className="space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <FormField label="Name" className="col-span-2">
                    <FormInput value={selected.name} onChange={(e) => edit({ name: e.target.value })} inputSize="sm" maxLength={60} />
                  </FormField>
                  <FormField label="Branch">
                    <FormSelect value={selected.warehouseId || ''} onChange={(e) => edit({ warehouseId: e.target.value || null })} selectSize="sm">
                      <option value="">All branches</option>
                      {warehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </FormSelect>
                  </FormField>
                  <FormField label="Printer resolution">
                    <FormSelect value={String(selected.dpi)} onChange={(e) => edit({ dpi: e.target.value === '300' ? 300 : 203 })} selectSize="sm">
                      <option value="203">203 dpi</option>
                      <option value="300">300 dpi</option>
                    </FormSelect>
                  </FormField>
                  <FormField label="Label width (mm)">
                    <FormInput type="number" min={10} max={220} step={0.5} value={selected.labelWidthMm} onChange={(e) => edit({ labelWidthMm: num(e.target.value) })} inputSize="sm" />
                  </FormField>
                  <FormField label="Label height (mm)">
                    <FormInput type="number" min={5} max={400} step={0.5} value={selected.labelHeightMm} onChange={(e) => edit({ labelHeightMm: num(e.target.value) })} inputSize="sm" />
                  </FormField>
                  <FormField label="Labels across">
                    <FormSelect value={String(selected.columns)} onChange={(e) => edit({ columns: Number(e.target.value) })} selectSize="sm">
                      {[1, 2, 3, 4].map((n) => (
                        <option key={n} value={n}>
                          {n} across
                        </option>
                      ))}
                    </FormSelect>
                  </FormField>
                  <FormField label="Side margin (mm)" hint="Liner edge to first label">
                    <FormInput type="number" min={0} max={30} step={0.5} value={selected.marginLeftMm} onChange={(e) => edit({ marginLeftMm: num(e.target.value) })} inputSize="sm" />
                  </FormField>
                  <FormField label="Gap across (mm)" hint="Between labels in a row">
                    <FormInput type="number" min={0} max={30} step={0.5} value={selected.columnGapMm} onChange={(e) => edit({ columnGapMm: num(e.target.value) })} inputSize="sm" />
                  </FormField>
                  <FormField label="Gap down (mm)" hint="Between rows">
                    <FormInput type="number" min={0} max={30} step={0.5} value={selected.rowGapMm} onChange={(e) => edit({ rowGapMm: num(e.target.value) })} inputSize="sm" />
                  </FormField>
                  <FormField label="Offset left/right (mm)" hint="+ moves print right">
                    <FormInput type="number" min={-20} max={20} step={0.25} value={selected.offsetXMm} onChange={(e) => edit({ offsetXMm: num(e.target.value) })} inputSize="sm" />
                  </FormField>
                  <FormField label="Offset up/down (mm)" hint="+ moves print down">
                    <FormInput type="number" min={-20} max={20} step={0.25} value={selected.offsetYMm} onChange={(e) => edit({ offsetYMm: num(e.target.value) })} inputSize="sm" />
                  </FormField>
                  <FormField label="Darkness" hint="TSPL/EPL 0-15, ZPL 0-30">
                    <FormInput
                      type="number"
                      min={0}
                      max={30}
                      value={selected.darkness ?? ''}
                      placeholder="default"
                      onChange={(e) => edit({ darkness: e.target.value === '' ? null : Number(e.target.value) })}
                      inputSize="sm"
                    />
                  </FormField>
                  <FormField label="Speed (ips)">
                    <FormInput
                      type="number"
                      min={1}
                      max={14}
                      value={selected.speed ?? ''}
                      placeholder="default"
                      onChange={(e) => edit({ speed: e.target.value === '' ? null : Number(e.target.value) })}
                      inputSize="sm"
                    />
                  </FormField>
                  <FormField label="Print direction" hint="Flip if labels come out upside down">
                    <FormSelect value={String(selected.direction)} onChange={(e) => edit({ direction: e.target.value === '0' ? 0 : 1 })} selectSize="sm">
                      <option value="1">Normal (1)</option>
                      <option value="0">Rotated 180° (0)</option>
                    </FormSelect>
                  </FormField>
                  <FormField label="Liner width">
                    <div className="text-sm font-mono py-1.5">{stickerRollWidthMm(selected)} mm</div>
                  </FormField>
                </div>
                <FormCheckbox label="Default setup for label printing" checked={selected.isDefault} onChange={(e) => edit({ isDefault: e.target.checked })} />
              </fieldset>

              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-gray-50 dark:bg-gray-800/50 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Roll preview (alignment pattern)</span>
                  <label className="text-xs text-gray-500 flex items-center gap-1">
                    <input type="checkbox" checked={trueSize} onChange={(e) => setTrueSize(e.target.checked)} /> Actual size
                  </label>
                </div>
                {alignTemplate && (
                  <StickerRollPreview
                    setup={selected}
                    template={alignTemplate}
                    items={[{ item: null, quantity: selected.columns * 2 }]}
                    zoom={trueSize ? 'true' : 'fit'}
                    maxRows={2}
                  />
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <FormSelect value={testPrinterId} onChange={(e) => setTestPrinterId(e.target.value)} selectSize="sm" className="w-auto" aria-label="Test printer">
                  {labelPrinters.length === 0 && <option value="">No raw label printer on this PC</option>}
                  {labelPrinters.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </FormSelect>
                <button
                  type="button"
                  onClick={testPrint}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border bg-white hover:bg-gray-50 dark:bg-gray-800 dark:border-gray-700"
                >
                  <Crosshair size={13} /> Print alignment pattern
                </button>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => edit({ locked: !selected.locked })}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border ${
                      selected.locked ? 'bg-amber-50 border-amber-300 text-amber-800' : 'bg-white hover:bg-gray-50 dark:bg-gray-800 dark:border-gray-700'
                    }`}
                  >
                    {selected.locked ? <Unlock size={13} /> : <Lock size={13} />}
                    {selected.locked ? 'Unlock setup' : 'Lock setup'}
                  </button>
                )}
                {canCalibrate && !readOnly && (
                  <button type="button" onClick={remove} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border text-red-600 hover:bg-red-50 dark:border-gray-700">
                    <Trash2 size={13} /> Remove
                  </button>
                )}
                {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
              </div>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                Tip: the pattern prints a border 0.5 mm inside each sticker and a centre cross. If the border is cut
                off on the left, increase the left/right offset; if it starts too low, use a negative up/down offset.
              </p>
            </>
          )}
        </div>
      )}
    </SectionCard>
  )
}
