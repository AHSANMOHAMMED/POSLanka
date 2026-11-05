'use client'

import { useEffect, useState } from 'react'

/**
 * Branch filter for pharmacy reports: "All branches" (the server limits branch-restricted staff to
 * their own) or one branch. Hidden when there is only one branch.
 */
export function BranchFilter({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [branches, setBranches] = useState<Array<{ id: string; name: string; code?: string | null }>>([])
  useEffect(() => {
    let cancelled = false
    fetch('/api/warehouses?all=true&activeOnly=true')
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Array<{ id: string; name: string; code?: string | null }>) => {
        if (!cancelled && Array.isArray(list)) setBranches(list.filter((b) => (b.code || '').trim().toUpperCase() !== 'QUARANTINE'))
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [])
  if (branches.length <= 1) return null
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded border px-2 py-1 text-sm dark:bg-gray-700" aria-label="Branch">
      <option value="">All branches</option>
      {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
    </select>
  )
}

/** Open a print window with a simple A4 document (the popup inherits the app CSP: no scripts) */
export function printHtml(title: string, body: string) {
  const win = window.open('', '_blank', 'width=900,height=700')
  if (!win) return false
  win.document.open()
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    @page { size: A4; margin: 12mm } body { font-family: Arial, sans-serif; font-size: 10pt; color: #000 }
    h1 { font-size: 14pt; margin: 0 0 2mm } h2 { font-size: 11pt; margin: 6mm 0 1mm } p { margin: 0 0 2mm }
    table { width: 100%; border-collapse: collapse; margin-bottom: 3mm } th, td { border: .2mm solid #999; padding: 1mm 1.5mm; text-align: left; vertical-align: top }
    th { background: #eee } td.n, th.n { text-align: right } tr.sum td { font-weight: bold; background: #f6f6f6 }
    section { page-break-inside: avoid }
  </style></head><body>${body}</body></html>`)
  win.document.close()
  win.onafterprint = () => win.close()
  win.focus()
  win.print()
  return true
}

export const escapeHtml = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
