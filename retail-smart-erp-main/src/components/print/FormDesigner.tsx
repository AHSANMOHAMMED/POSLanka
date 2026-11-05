'use client'

/**
 * Pre-printed form designer (print template designer → "Pre-printed form" tab).
 *
 * FormDesignerPanel: settings (background upload, print background, calibration offset, items
 * region / columns, the selected field's mm position / font / alignment).
 * FormDesignerCanvas: the page at its exact paper size with the uploaded form behind it; drag
 * fields and item columns onto the form's boxes (0.5 mm snap; arrow keys nudge, Shift = 5 mm).
 *
 * Positions are mm from the paper's top-left corner (form-layout.ts). The calibration offset is
 * not shown here (it compensates the printer's feed, not the layout).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ImagePlus, Loader2, Plus, Trash2, Copy, Grid3x3, Printer, ZoomIn, ZoomOut, Wand2 } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { pdfFirstPageToPng } from '@/lib/print/pdf-to-image'
import {
  FORM_COLUMN_KEYS,
  FORM_COLUMN_LABELS,
  FORM_FIELD_KEYS,
  FORM_FIELD_LABELS,
  FORM_LINE_HEIGHT,
  formItemsHeightMm,
  formPreset,
  newFormFieldId,
  type FormColumn,
  type FormField,
  type FormFieldKey,
} from '@/lib/print/form-layout'
import {
  formFieldText,
  formItemRows,
  safeImageUrl,
  templatePageMm,
  type InvoiceCompany,
  type InvoiceDoc,
  type InvoiceTemplateConfig,
} from '@/lib/print/invoice-template'

export type FormSelection = { type: 'field'; id: string } | { type: 'items' } | { type: 'column'; index: number } | null

type Update = (path: string, value: unknown) => void

const PT_TO_MM = 25.4 / 72
const MAX_INLINE_BYTES = 1.5 * 1024 * 1024
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
const snap = (v: number) => Math.round(v * 2) / 2

const inputCls = 'w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500'

function NumIn({ label, value, onChange, step = 0.5, min, max }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium text-gray-600 dark:text-gray-300 mb-0.5">{label}</span>
      <input type="number" value={value} step={step} min={min} max={max} onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))} className={inputCls} />
    </label>
  )
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-gray-700 dark:text-gray-300">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="rounded border-gray-300 dark:border-gray-600" />
      {label}
    </label>
  )
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || ''))
    r.onerror = () => reject(new Error('Could not read the image'))
    r.readAsDataURL(file)
  })
}

/** Upload through the file manager (public file, attached to the template); data URL fallback for small images. */
async function uploadBackground(file: File, templateId: string): Promise<string> {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('attachedToType', 'print_template')
  fd.append('attachedToId', templateId)
  fd.append('category', 'print-template')
  fd.append('description', 'Pre-printed form background')
  try {
    const res = await fetch('/api/files', { method: 'POST', body: fd })
    const data = (await res.json().catch(() => ({}))) as { fileUrl?: string; error?: string }
    if (res.ok && data.fileUrl && safeImageUrl(data.fileUrl)) return data.fileUrl
    if (file.size > MAX_INLINE_BYTES) throw new Error(data.error || 'Upload failed')
  } catch (e) {
    if (file.size > MAX_INLINE_BYTES) throw e instanceof Error ? e : new Error('Upload failed')
  }
  return readAsDataUrl(file)
}

// ─── Panel ─────────────────────────────────────────────────────────────────

export function FormDesignerPanel({
  cfg, update, selection, setSelection, templateId, onCalibrate, onPrintSample,
}: {
  cfg: InvoiceTemplateConfig
  update: Update
  selection: FormSelection
  setSelection: (s: FormSelection) => void
  templateId: string
  onCalibrate: () => void
  onPrintSample: () => void
}) {
  const f = cfg.form
  const [uploading, setUploading] = useState(false)
  const [newKey, setNewKey] = useState<FormFieldKey>('customer.name')
  const page = templatePageMm(cfg)

  const setFields = (fields: FormField[]) => update('form.fields', fields)
  const setColumns = (cols: FormColumn[]) => update('form.columns', cols)
  const patchField = (id: string, patch: Partial<FormField>) => setFields(f.fields.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  const patchColumn = (i: number, patch: Partial<FormColumn>) => setColumns(f.columns.map((c, j) => (j === i ? { ...c, ...patch } : c)))

  async function onFile(file: File | undefined) {
    if (!file) return
    if (file.type !== 'application/pdf' && !/^image\/(png|jpe?g)$/.test(file.type)) { toast.error('Upload a PDF, PNG or JPG of your form'); return }
    setUploading(true)
    try {
      if (file.type === 'application/pdf') {
        // Page 1 at 300 dpi; warn when the PDF page is not the template's paper size
        const { file: png, widthMm, heightMm } = await pdfFirstPageToPng(file)
        if (Math.abs(widthMm - page.width) > 2 || Math.abs(heightMm - page.height) > 2) {
          toast.warning(`The PDF page is ${Math.round(widthMm)} × ${Math.round(heightMm)} mm but the template paper is ${Math.round(page.width)} × ${Math.round(page.height)} mm — change the paper size to match.`)
        }
        file = png
      }
      if (file.size > MAX_UPLOAD_BYTES) { toast.error('Image must be under 10 MB'); return }
      update('form.backgroundImage', await uploadBackground(file, templateId))
      toast.success('Form image uploaded')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  function addField() {
    const fl: FormField = { id: newFormFieldId(), key: newKey, x: 20, y: 20, width: newKey === 'totals.words' || newKey.endsWith('address') ? 100 : 60, lines: newKey.endsWith('address') || newKey === 'notes' || newKey === 'serials' || newKey === 'totals.words' ? 3 : 1, fontSize: 10, bold: false, align: newKey.startsWith('totals.') && newKey !== 'totals.words' ? 'right' : 'left', pages: newKey.startsWith('totals.') ? 'last' : 'all', text: newKey === 'text' ? 'Text' : '' }
    setFields([...f.fields, fl])
    setSelection({ type: 'field', id: fl.id })
  }

  function applyPreset() {
    if ((f.fields.length || f.columns.length) && !confirm('Replace the current fields with the starter layout?')) return
    const p = formPreset(page.width, page.height)
    update('form.fields', p.fields)
    update('form.items', p.items)
    update('form.columns', p.columns)
    setSelection(null)
  }

  const selField = selection?.type === 'field' ? f.fields.find((x) => x.id === selection.id) : undefined
  const selColIndex = selection?.type === 'column' ? selection.index : -1
  const bg = safeImageUrl(f.backgroundImage)

  return (
    <div className="space-y-4">
      <Check label="Print on my own form (pre-printed / uploaded template)" checked={f.enabled} onChange={(v) => update('form.enabled', v)} />
      <p className="text-[11px] text-gray-500 dark:text-gray-400">
        Upload a scan or design of your form at the template&apos;s paper size ({Math.round(page.width * 10) / 10} × {Math.round(page.height * 10) / 10} mm — set paper in General),
        then drag each field onto its box. Print at 100 % scale with margins &quot;None&quot; / &quot;Default&quot;.
      </p>
      {f.enabled && (
        <>
          <div className="space-y-2 border-t border-gray-200 dark:border-gray-700 pt-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Form image</h3>
            {bg && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={bg} alt="" className="max-h-24 rounded border border-gray-200 dark:border-gray-700 bg-white" />
            )}
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border border-gray-300 dark:border-gray-600 rounded cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200">
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />} Upload PDF / PNG / JPG
                <input type="file" accept="image/png,image/jpeg,application/pdf" className="hidden" disabled={uploading} onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = '' }} />
              </label>
              {bg && <button type="button" onClick={() => update('form.backgroundImage', '')} className="flex items-center gap-1 text-xs text-red-600 hover:underline"><Trash2 size={12} /> Remove</button>}
            </div>
            <Check label="Print the form image too (plain paper)" checked={f.printBackground} onChange={(v) => update('form.printBackground', v)} />
            <p className="text-[11px] text-gray-400">Off = paper already has the form printed; only the data is printed.</p>
          </div>

          <div className="space-y-2 border-t border-gray-200 dark:border-gray-700 pt-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Printer calibration</h3>
            <div className="grid grid-cols-2 gap-2">
              <NumIn label="Offset X (mm, + = right)" value={f.offsetX} min={-50} max={50} onChange={(v) => update('form.offsetX', v)} />
              <NumIn label="Offset Y (mm, + = down)" value={f.offsetY} min={-50} max={50} onChange={(v) => update('form.offsetY', v)} />
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={onCalibrate} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"><Grid3x3 size={14} /> Test print (mm grid)</button>
              <button type="button" onClick={onPrintSample} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"><Printer size={14} /> Print sample</button>
            </div>
          </div>

          <div className="space-y-2 border-t border-gray-200 dark:border-gray-700 pt-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Fields</h3>
            <div className="flex gap-2">
              <select value={newKey} onChange={(e) => setNewKey(e.target.value as FormFieldKey)} className={inputCls}>
                {FORM_FIELD_KEYS.map((k) => <option key={k} value={k}>{FORM_FIELD_LABELS[k]}</option>)}
              </select>
              <button type="button" onClick={addField} className="shrink-0 flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700"><Plus size={14} /> Add</button>
            </div>
            <button type="button" onClick={applyPreset} className="flex items-center gap-1.5 text-xs text-blue-600 hover:underline"><Wand2 size={12} /> Starter layout (typical invoice form)</button>
            <div className="max-h-40 overflow-y-auto rounded border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
              {f.fields.length === 0 && <p className="p-2 text-xs text-gray-400">No fields yet.</p>}
              {f.fields.map((x) => (
                <button key={x.id} type="button" onClick={() => setSelection({ type: 'field', id: x.id })}
                  className={`w-full text-left px-2 py-1 text-xs ${selField?.id === x.id ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                  {x.key === 'text' ? `"${x.text}"` : FORM_FIELD_LABELS[x.key]} <span className="text-gray-400">({x.x}, {x.y} mm)</span>
                </button>
              ))}
            </div>
          </div>

          {selField && (
            <div className="space-y-2 border-t border-gray-200 dark:border-gray-700 pt-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Selected field</h3>
              <select value={selField.key} onChange={(e) => patchField(selField.id, { key: e.target.value as FormFieldKey })} className={inputCls}>
                {FORM_FIELD_KEYS.map((k) => <option key={k} value={k}>{FORM_FIELD_LABELS[k]}</option>)}
              </select>
              <label className="block">
                <span className="block text-[11px] font-medium text-gray-600 dark:text-gray-300 mb-0.5">{selField.key === 'text' ? 'Text' : 'Prefix (optional, e.g. "Rs. ")'}</span>
                <input value={selField.text} onChange={(e) => patchField(selField.id, { text: e.target.value })} className={inputCls} />
              </label>
              <div className="grid grid-cols-3 gap-2">
                <NumIn label="X (mm)" value={selField.x} min={0} onChange={(v) => patchField(selField.id, { x: v })} />
                <NumIn label="Y (mm)" value={selField.y} min={0} onChange={(v) => patchField(selField.id, { y: v })} />
                <NumIn label="Width (mm)" value={selField.width} min={2} onChange={(v) => patchField(selField.id, { width: v })} />
                <NumIn label="Lines" value={selField.lines} step={1} min={1} max={30} onChange={(v) => patchField(selField.id, { lines: Math.max(1, Math.round(v)) })} />
                <NumIn label="Font (pt)" value={selField.fontSize} min={4} max={40} onChange={(v) => patchField(selField.id, { fontSize: v })} />
                <label className="block">
                  <span className="block text-[11px] font-medium text-gray-600 dark:text-gray-300 mb-0.5">Align</span>
                  <select value={selField.align} onChange={(e) => patchField(selField.id, { align: e.target.value as FormField['align'] })} className={inputCls}>
                    <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
                  </select>
                </label>
              </div>
              <div className="flex items-center gap-3">
                <Check label="Bold" checked={selField.bold} onChange={(v) => patchField(selField.id, { bold: v })} />
                <select value={selField.pages} onChange={(e) => patchField(selField.id, { pages: e.target.value as FormField['pages'] })} className={`${inputCls} !w-auto`} title="Pages">
                  <option value="all">Every page</option><option value="first">First page</option><option value="last">Last page</option>
                </select>
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => { const c = { ...selField, id: newFormFieldId(), y: selField.y + 6 }; setFields([...f.fields, c]); setSelection({ type: 'field', id: c.id }) }} className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300 hover:underline"><Copy size={12} /> Duplicate</button>
                <button type="button" onClick={() => { setFields(f.fields.filter((x) => x.id !== selField.id)); setSelection(null) }} className="flex items-center gap-1 text-xs text-red-600 hover:underline"><Trash2 size={12} /> Delete</button>
              </div>
            </div>
          )}

          <div className="space-y-2 border-t border-gray-200 dark:border-gray-700 pt-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Items table</h3>
            <Check label="Print item rows" checked={f.items.show} onChange={(v) => update('form.items.show', v)} />
            <div className="grid grid-cols-3 gap-2">
              <NumIn label="X (mm)" value={f.items.x} min={0} onChange={(v) => update('form.items.x', v)} />
              <NumIn label="First row Y" value={f.items.y} min={0} onChange={(v) => update('form.items.y', v)} />
              <NumIn label="Width (mm)" value={f.items.width} min={0} onChange={(v) => update('form.items.width', v)} />
              <NumIn label="Row height" value={f.items.rowHeight} step={0.1} min={2} max={60} onChange={(v) => update('form.items.rowHeight', v)} />
              <NumIn label="Rows / page" value={f.items.maxRows} step={1} min={1} max={300} onChange={(v) => update('form.items.maxRows', Math.max(1, Math.round(v)))} />
              <NumIn label="Font (pt)" value={f.items.fontSize} min={4} max={40} onChange={(v) => update('form.items.fontSize', v)} />
            </div>
            <Check label="Serial numbers / warranty on an extra row" checked={f.items.serialRow} onChange={(v) => update('form.items.serialRow', v)} />
            <p className="text-[11px] text-gray-400">More items than rows continue on the next sheet; fields set to &quot;Last page&quot; (totals) print on the last sheet only.</p>
            <div className="space-y-1.5">
              {f.columns.map((c, i) => (
                <div key={i} className={`grid grid-cols-[1fr_56px_56px_64px_20px] gap-1 items-end rounded ${selColIndex === i ? 'bg-blue-50 dark:bg-blue-900/30' : ''}`} onClick={() => setSelection({ type: 'column', index: i })}>
                  <select value={c.key} onChange={(e) => patchColumn(i, { key: e.target.value as FormColumn['key'] })} className={inputCls}>
                    {FORM_COLUMN_KEYS.map((k) => <option key={k} value={k}>{FORM_COLUMN_LABELS[k]}</option>)}
                  </select>
                  <input type="number" title="X from the table's left edge (mm)" value={c.x} step={0.5} onChange={(e) => patchColumn(i, { x: Number(e.target.value) || 0 })} className={inputCls} />
                  <input type="number" title="Width (mm)" value={c.width} step={0.5} onChange={(e) => patchColumn(i, { width: Math.max(2, Number(e.target.value) || 2) })} className={inputCls} />
                  <select value={c.align} onChange={(e) => patchColumn(i, { align: e.target.value as FormColumn['align'] })} className={inputCls}>
                    <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
                  </select>
                  <button type="button" onClick={(e) => { e.stopPropagation(); setColumns(f.columns.filter((_, j) => j !== i)); setSelection(null) }} className="text-red-500 pb-1.5" title="Remove column"><Trash2 size={13} /></button>
                </div>
              ))}
              <button type="button" onClick={() => { const last = f.columns[f.columns.length - 1]; setColumns([...f.columns, { key: 'amount', x: last ? last.x + last.width + 2 : 0, width: 25, align: 'right' }]) }}
                className="flex items-center gap-1 text-xs text-blue-600 hover:underline"><Plus size={12} /> Add column</button>
              <p className="text-[11px] text-gray-400">Columns: X and width in mm from the table&apos;s left edge (drag them on the page).</p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Canvas ────────────────────────────────────────────────────────────────

type Drag =
  | { kind: 'field'; id: string; mode: 'move' | 'resize'; sx: number; sy: number; ox: number; oy: number; ow: number }
  | { kind: 'items'; sx: number; sy: number; ox: number; oy: number }
  | { kind: 'column'; index: number; mode: 'move' | 'resize'; sx: number; ox: number; ow: number }

export function FormDesignerCanvas({
  cfg, doc, company, update, selection, setSelection,
}: {
  cfg: InvoiceTemplateConfig
  doc: InvoiceDoc
  company: InvoiceCompany
  update: Update
  selection: FormSelection
  setSelection: (s: FormSelection) => void
}) {
  const f = cfg.form
  const page = templatePageMm(cfg)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [fitScale, setFitScale] = useState(3)
  const [zoom, setZoom] = useState(1)
  const [grid, setGrid] = useState(true)
  const drag = useRef<Drag | null>(null)
  const s = fitScale * zoom // px per mm

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setFitScale(Math.max(1, (el.clientWidth - 48) / page.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [page.width])

  const fieldsRef = useRef(f.fields)
  const columnsRef = useRef(f.columns)
  useEffect(() => { fieldsRef.current = f.fields; columnsRef.current = f.columns }, [f.fields, f.columns])

  const onMove = useCallback((e: PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = (e.clientX - d.sx) / s
    if (d.kind === 'field') {
      const dy = (e.clientY - d.sy) / s
      update('form.fields', fieldsRef.current.map((x) => {
        if (x.id !== d.id) return x
        return d.mode === 'move'
          ? { ...x, x: Math.max(0, snap(d.ox + dx)), y: Math.max(0, snap(d.oy + dy)) }
          : { ...x, width: Math.max(2, snap(d.ow + dx)) }
      }))
    } else if (d.kind === 'items') {
      const dy = (e.clientY - d.sy) / s
      update('form.items.x', Math.max(0, snap(d.ox + dx)))
      update('form.items.y', Math.max(0, snap(d.oy + dy)))
    } else {
      update('form.columns', columnsRef.current.map((c, i) => {
        if (i !== d.index) return c
        return d.mode === 'move' ? { ...c, x: Math.max(0, snap(d.ox + dx)) } : { ...c, width: Math.max(2, snap(d.ow + dx)) }
      }))
    }
  }, [s, update])

  useEffect(() => {
    const up = () => { drag.current = null }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', up)
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', up) }
  }, [onMove])

  function onKey(e: React.KeyboardEvent) {
    if (selection?.type !== 'field' || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
    e.preventDefault()
    const step = e.shiftKey ? 5 : 0.5
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
    update('form.fields', f.fields.map((x) => (x.id === selection.id ? { ...x, x: Math.max(0, snap(x.x + dx)), y: Math.max(0, snap(x.y + dy)) } : x)))
  }

  const bg = safeImageUrl(f.backgroundImage)
  const rows = formItemRows(cfg, doc).slice(0, f.items.maxRows)
  const itemsH = formItemsHeightMm(f.items)
  const mm = (v: number) => `${v * s}px`
  const fontPx = (pt: number) => `${pt * PT_TO_MM * s}px`

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center gap-2 px-4 py-1.5 border-b border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-800/70 text-xs text-gray-600 dark:text-gray-300">
        <button type="button" onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 100) / 100))} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700" title="Zoom out"><ZoomOut size={14} /></button>
        <span className="w-10 text-center">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => setZoom((z) => Math.min(4, Math.round((z + 0.25) * 100) / 100))} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700" title="Zoom in"><ZoomIn size={14} /></button>
        <label className="flex items-center gap-1 ml-2"><input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} /> 10 mm grid</label>
        <span className="ml-auto">{Math.round(page.width * 10) / 10} × {Math.round(page.height * 10) / 10} mm · drag to place · arrows nudge 0.5 mm (Shift 5 mm)</span>
      </div>
      <div ref={wrapRef} className="flex-1 overflow-auto bg-gray-200 dark:bg-gray-900 p-6 outline-none" tabIndex={0} onKeyDown={onKey}>
        <div
          className="relative mx-auto bg-white shadow-lg select-none"
          style={{
            width: mm(page.width), height: mm(page.height),
            backgroundImage: grid ? `linear-gradient(to right, rgba(59,130,246,.15) 1px, transparent 1px), linear-gradient(to bottom, rgba(59,130,246,.15) 1px, transparent 1px)` : undefined,
            backgroundSize: grid ? `${10 * s}px ${10 * s}px` : undefined,
          }}
          onPointerDown={(e) => { if (e.target === e.currentTarget) setSelection(null) }}
        >
          {bg && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={bg} alt="" draggable={false} className="absolute inset-0 w-full h-full pointer-events-none" style={{ opacity: f.printBackground ? 1 : 0.6 }} />
          )}

          {f.items.show && (
            <div
              className={`absolute border ${selection?.type === 'items' ? 'border-emerald-600' : 'border-emerald-400/70 border-dashed'} cursor-move`}
              style={{ left: mm(f.items.x), top: mm(f.items.y), width: mm(Math.max(10, f.items.width)), height: mm(itemsH), background: 'rgba(16,185,129,.06)' }}
              onPointerDown={(e) => { if (e.target !== e.currentTarget) return; e.preventDefault(); setSelection({ type: 'items' }); drag.current = { kind: 'items', sx: e.clientX, sy: e.clientY, ox: f.items.x, oy: f.items.y } }}
              title="Items table (drag to move)"
            >
              {f.columns.map((c, i) => (
                <div key={i}
                  className={`absolute top-0 bottom-0 ${selection?.type === 'column' && selection.index === i ? 'bg-blue-500/15 border-x border-blue-500' : 'border-x border-blue-300/60 border-dashed'} cursor-ew-resize`}
                  style={{ left: mm(c.x), width: mm(c.width) }}
                  onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); setSelection({ type: 'column', index: i }); drag.current = { kind: 'column', index: i, mode: 'move', sx: e.clientX, ox: c.x, ow: c.width } }}
                  title={`${FORM_COLUMN_LABELS[c.key]} (drag to move)`}
                >
                  <span className="absolute -top-4 left-0 text-[10px] text-blue-700 bg-white/80 px-0.5 whitespace-nowrap">{FORM_COLUMN_LABELS[c.key]}</span>
                  {rows.map((r, ri) => (
                    <div key={ri} className="absolute left-0 right-0 overflow-hidden whitespace-nowrap leading-none text-gray-900" style={{ top: mm(ri * f.items.rowHeight), fontSize: fontPx(f.items.fontSize), textAlign: c.align }}>
                      {r.cells[c.key] || ''}
                    </div>
                  ))}
                  <div className="absolute top-0 bottom-0 -right-1 w-2 cursor-col-resize"
                    onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); setSelection({ type: 'column', index: i }); drag.current = { kind: 'column', index: i, mode: 'resize', sx: e.clientX, ox: c.x, ow: c.width } }} />
                </div>
              ))}
            </div>
          )}

          {f.fields.map((fl) => {
            const sel = selection?.type === 'field' && selection.id === fl.id
            const text = formFieldText(fl, cfg, doc, company, 0, 2) || (fl.key === 'text' ? fl.text : `[${FORM_FIELD_LABELS[fl.key]}]`)
            return (
              <div key={fl.id}
                className={`absolute cursor-move ${sel ? 'outline outline-2 outline-blue-600 bg-blue-500/10' : 'outline outline-1 outline-dashed outline-blue-400/70'}`}
                style={{
                  left: mm(fl.x), top: mm(fl.y), width: mm(fl.width), height: mm(Math.max(2, fl.lines * fl.fontSize * FORM_LINE_HEIGHT * PT_TO_MM)),
                  fontSize: fontPx(fl.fontSize), lineHeight: FORM_LINE_HEIGHT, fontWeight: fl.bold ? 700 : 400, textAlign: fl.align,
                  whiteSpace: fl.lines > 1 ? 'pre-wrap' : 'nowrap', overflow: 'hidden', color: '#111',
                }}
                onPointerDown={(e) => { e.preventDefault(); setSelection({ type: 'field', id: fl.id }); wrapRef.current?.focus(); drag.current = { kind: 'field', id: fl.id, mode: 'move', sx: e.clientX, sy: e.clientY, ox: fl.x, oy: fl.y, ow: fl.width } }}
                title={`${FORM_FIELD_LABELS[fl.key]} — ${fl.x}, ${fl.y} mm`}
              >
                {text}
                <div className="absolute top-0 bottom-0 -right-1 w-2 cursor-ew-resize"
                  onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); setSelection({ type: 'field', id: fl.id }); drag.current = { kind: 'field', id: fl.id, mode: 'resize', sx: e.clientX, sy: e.clientY, ox: fl.x, oy: fl.y, ow: fl.width } }} />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
