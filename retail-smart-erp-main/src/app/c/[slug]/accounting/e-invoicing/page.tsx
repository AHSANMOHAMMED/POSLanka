'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, FileText, AlertTriangle, RefreshCw } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'

interface OutboxRow {
  id: string
  documentType: 'invoice' | 'credit_note' | 'debit_note'
  documentNo: string
  documentDate: string
  status: 'pending' | 'sent' | 'failed' | 'acknowledged'
  attempts: number
  lastError: string | null
  irn: string | null
  updatedAt: string
}

interface EinvoiceState {
  enabled: boolean
  enabledAt: string | null
  vatRegistered: boolean
  transmitter: string
  transmitterActive: boolean
  outbox: Partial<Record<OutboxRow['status'], number>>
  recent: OutboxRow[]
}

const STATUS_CLASS: Record<OutboxRow['status'], string> = {
  pending: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  sent: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  acknowledged: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
}

const DOC_LABEL: Record<OutboxRow['documentType'], string> = {
  invoice: 'Invoice',
  credit_note: 'Credit note',
  debit_note: 'Debit note',
}

export default function EInvoicingPage() {
  const [state, setState] = useState<EinvoiceState | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/einvoice/settings')
      const data = await res.json()
      if (res.ok) setState(data)
      else toast.error(data.error || 'Failed to load e-invoice settings')
    } catch {
      toast.error('Error loading e-invoice settings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function toggle(enabled: boolean) {
    setSaving(true)
    try {
      const res = await fetch('/api/einvoice/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to update e-invoice settings')
        return
      }
      setState(data)
      toast.success(enabled ? 'E-invoicing enabled' : 'E-invoicing disabled')
    } catch {
      toast.error('Error updating e-invoice settings')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <PageLoading text="Loading e-invoicing..." />
  if (!state) return null

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">E-Invoicing</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Readiness for the Inland Revenue Department (RAMIS) e-invoicing system.
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-sm rounded text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4 space-y-3">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={state.enabled}
            disabled={saving || (!state.enabled && !state.vatRegistered)}
            onChange={(e) => toggle(e.target.checked)}
            className="mt-1 w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
          />
          <span>
            <span className="block text-sm font-medium text-gray-900 dark:text-white">
              Queue invoices, returns, credit notes and debit notes for e-invoicing
              {saving && <Loader2 size={14} className="inline ml-2 animate-spin" />}
            </span>
            <span className="block text-xs text-gray-500 dark:text-gray-400">
              Every document issued from the moment this is switched on gets one outbox entry (built from the issued
              document and never duplicated).{state.enabledAt ? ` Enabled since ${new Date(state.enabledAt).toLocaleString()}.` : ''}
            </span>
          </span>
        </label>
        {!state.vatRegistered && (
          <div className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            Set the company VAT / TIN number in the business profile before enabling e-invoicing.
          </div>
        )}
        <div className="text-sm text-gray-700 dark:text-gray-300">
          Transmitter: <span className="font-mono">{state.transmitter}</span>{' '}
          {state.transmitterActive ? (
            <span className="text-green-600 dark:text-green-400">(active)</span>
          ) : (
            <span className="text-gray-500">(not sending yet — documents stay queued until the IRD API is connected)</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {(['pending', 'sent', 'acknowledged', 'failed'] as const).map((s) => (
            <span key={s} className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CLASS[s]}`}>
              {s}: {state.outbox[s] || 0}
            </span>
          ))}
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900">
            <tr className="text-left text-gray-600 dark:text-gray-400">
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Document</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium text-right">Attempts</th>
              <th className="px-3 py-2 font-medium">IRN / last error</th>
            </tr>
          </thead>
          <tbody>
            {state.recent.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-gray-500 dark:text-gray-400">
                  <FileText size={28} className="mx-auto mb-2 text-gray-300 dark:text-gray-600" />
                  Nothing queued yet.
                </td>
              </tr>
            ) : (
              state.recent.map((r) => (
                <tr key={r.id} className="border-t border-gray-100 dark:border-gray-700">
                  <td className="px-3 py-2 whitespace-nowrap">{r.documentDate}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{DOC_LABEL[r.documentType]} {r.documentNo}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CLASS[r.status]}`}>{r.status}</span>
                  </td>
                  <td className="px-3 py-2 text-right">{r.attempts}</td>
                  <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400">{r.irn || r.lastError || '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
