'use client'

/**
 * Vendor Stock tab: import products from CSV / Excel for the vendor — add new products, change prices,
 * set or add stock. Uses the vendor's own import engine (/api/sys-control/vendors/[id]/import):
 * preview first, then a background job with progress. Stock goes through the stock ledger.
 */
import { useEffect, useRef, useState } from 'react'
import { Download, FileUp } from 'lucide-react'
import { AdminCard, Alert, Button, Checkbox, Field, Select } from '@/components/admin/kit'
import { adminFetch } from '@/components/admin/console-helpers'

type Mode = 'upsert' | 'insert' | 'update'
type StockMode = 'set' | 'add' | 'none'
interface Counts { total: number; insert: number; update: number; skip: number; error: number }
interface Preview { actions: Counts; mappedColumns: Record<string, string>; errors: Array<{ row: number; message: string } | string>; preview: Array<{ row: number; action: string; status: string; error: string | null }> }
interface JobView { status: string; total: number; processed?: number; inserted?: number; updated?: number; failed?: number; skipped?: number; errorMessage?: string | null; errors?: Array<{ row: number; message: string }> }

const TEMPLATE_HEADERS = ['Barcode', 'SKU', 'Name', 'Category', 'Cost Price', 'Selling Price', 'Unit', 'Warehouse', 'Opening Stock', 'Min Stock']
const TEMPLATE_ROWS = [
  ['2000000000015', '', 'Blue Shirt M', 'Shirts', '1200', '1990', 'pcs', '', '25', '5'],
  ['', 'SKU-100', 'Ladies Denim 32', 'Denim', '2500', '3990', 'pcs', '', '10', ''],
]

function downloadTemplate() {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const csv = [TEMPLATE_HEADERS, ...TEMPLATE_ROWS].map((r) => r.map(esc).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'products-import-template.csv'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const errText = (e: { row: number; message: string } | string) => (typeof e === 'string' ? e : `Row ${e.row}: ${e.message}`)

export function VendorImportCard({ vendorId, onImported }: { vendorId: string; onImported: (text: string) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [mode, setMode] = useState<Mode>('upsert')
  const [stockMode, setStockMode] = useState<StockMode>('set')
  const [skipErrors, setSkipErrors] = useState(true)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState<null | 'preview' | 'import'>(null)
  const [error, setError] = useState<string | null>(null)
  const [job, setJob] = useState<{ id: string; view: JobView | null } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const form = () => {
    const fd = new FormData()
    fd.append('file', file!)
    fd.append('entity', 'items')
    fd.append('mode', mode)
    fd.append('stockMode', stockMode)
    fd.append('skipErrors', String(skipErrors))
    return fd
  }

  async function runPreview() {
    if (!file) return
    setBusy('preview')
    setError(null)
    setPreview(null)
    try {
      setPreview(await adminFetch<Preview>(`/api/sys-control/vendors/${vendorId}/import?step=preview`, { method: 'POST', body: form() }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the file')
    } finally {
      setBusy(null)
    }
  }

  async function runImport() {
    if (!file) return
    setBusy('import')
    setError(null)
    try {
      const res = await adminFetch<{ jobId: string }>(`/api/sys-control/vendors/${vendorId}/import?step=execute`, { method: 'POST', body: form() })
      setJob({ id: res.jobId, view: null })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
      setBusy(null)
    }
  }

  // Follow the background job until it finishes
  const jobId = job?.id
  useEffect(() => {
    if (!jobId) return
    let stop = false
    const tick = async () => {
      try {
        const view = await adminFetch<JobView>(`/api/sys-control/vendors/${vendorId}/import?jobId=${jobId}`)
        if (stop) return
        setJob({ id: jobId, view })
        if (['done', 'error', 'cancelled', 'interrupted'].includes(view.status)) {
          setBusy(null)
          setPreview(null)
          setFile(null)
          if (inputRef.current) inputRef.current.value = ''
          onImported(`${view.status === 'done' ? 'Import finished' : `Import ${view.status}${view.errorMessage ? ` (${view.errorMessage})` : ''}`}: ${view.inserted ?? 0} new, ${view.updated ?? 0} updated${view.failed ? `, ${view.failed} failed` : ''}${view.skipped ? `, ${view.skipped} skipped` : ''}.`)
          return
        }
      } catch {
        /* keep polling */
      }
      if (!stop) setTimeout(tick, 1500)
    }
    tick()
    return () => { stop = true }
  }, [jobId, vendorId, onImported])

  const v = job?.view
  const c = preview?.actions

  return (
    <AdminCard
      title="Import products (Excel / CSV)"
      description="Add new products, change prices and update stock from a file. Rows are matched to existing products by Barcode, then SKU, then Item Code. Stock is saved with stock history."
      actions={<Button size="sm" variant="ghost" icon={Download} onClick={downloadTemplate}>Template</Button>}
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="File" htmlFor="imp-file" className="min-w-[220px] flex-1">
            <input
              ref={inputRef}
              id="imp-file"
              type="file"
              accept=".csv,.xlsx,.xls"
              className="block w-full text-[13px]"
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setJob(null); setError(null) }}
            />
          </Field>
          <Field label="Products" htmlFor="imp-mode" className="w-56">
            <Select id="imp-mode" size="sm" value={mode} onChange={(e) => { setMode(e.target.value as Mode); setPreview(null) }}>
              <option value="upsert">Add new + update existing</option>
              <option value="insert">Only add new products</option>
              <option value="update">Only update existing</option>
            </Select>
          </Field>
          <Field label="Stock of existing products" htmlFor="imp-stock" className="w-60">
            <Select id="imp-stock" size="sm" value={stockMode} disabled={mode === 'insert'} onChange={(e) => { setStockMode(e.target.value as StockMode); setPreview(null) }}>
              <option value="set">Set to the file quantity</option>
              <option value="add">Add the file quantity</option>
              <option value="none">Do not change stock</option>
            </Select>
          </Field>
        </div>
        <Checkbox label="Skip rows with errors (import the good rows)" checked={skipErrors} onChange={(e) => setSkipErrors(e.target.checked)} />
        <p className="text-[12.5px] text-adm-subtle">
          Stock columns: <b>Opening Stock</b> (with optional <b>Warehouse</b> code or name; blank = default branch) or one column per branch named
          <code className="mx-1">Stock: MAIN</code>. New products always get the file quantity as opening stock.
        </p>

        {error && <Alert tone="danger">{error}</Alert>}

        {c && !job && (
          <Alert tone={c.error ? 'warning' : 'success'} title={`${c.insert} new, ${c.update} updated${c.skip ? `, ${c.skip} skipped` : ''}${c.error ? `, ${c.error} with errors` : ''} (of ${c.total} rows)`}>
            {Object.keys(preview!.mappedColumns).length > 0 && <div>Columns read: {Object.keys(preview!.mappedColumns).join(', ')}</div>}
            {preview!.errors.length > 0 && (
              <ul className="mt-1 list-disc pl-4">
                {preview!.errors.slice(0, 8).map((e, i) => <li key={i}>{errText(e)}</li>)}
              </ul>
            )}
          </Alert>
        )}

        {job && (
          <Alert tone={v?.status === 'done' && !v.failed ? 'success' : v && ['done', 'error', 'cancelled', 'interrupted'].includes(v.status) ? 'warning' : 'info'}
            title={v ? `${v.status === 'done' ? 'Finished' : v.status === 'processing' || v.status === 'queued' || v.status === 'validating' ? 'Importing' : v.status}: ${v.processed ?? 0} of ${v.total} rows` : 'Starting…'}>
            {v && <div>{v.inserted ?? 0} new · {v.updated ?? 0} updated · {v.failed ?? 0} failed · {v.skipped ?? 0} skipped</div>}
            {v?.errors && v.errors.length > 0 && (
              <ul className="mt-1 list-disc pl-4">{v.errors.slice(0, 8).map((e, i) => <li key={i}>{errText(e)}</li>)}</ul>
            )}
          </Alert>
        )}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={FileUp} onClick={runPreview} loading={busy === 'preview'} disabled={!file || !!busy}>Check file</Button>
          <Button size="sm" variant="primary" onClick={runImport} loading={busy === 'import'}
            disabled={!file || !!busy || !c || c.insert + c.update === 0 || (!skipErrors && c.error > 0)}>
            Import {c ? `${c.insert + c.update} row${c.insert + c.update === 1 ? '' : 's'}` : ''}
          </Button>
        </div>
      </div>
    </AdminCard>
  )
}
