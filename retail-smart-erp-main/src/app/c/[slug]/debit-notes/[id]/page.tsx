'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'
import { ConfirmModal } from '@/components/ui/confirm-modal'

interface DebitNoteDetail {
  id: string
  debitNoteNo: string
  status: 'draft' | 'issued' | 'cancelled'
  reason: string | null
  postingDate: string | null
  createdAt: string
  subtotal: string
  tax: string
  total: string
  glPosted: boolean
  customerName: string | null
  customer: { name: string; taxId: string | null; address: string | null } | null
  sale: { id: string; invoiceNo: string } | null
  items: Array<{ id: string; itemName: string; quantity: string; unitPrice: string; taxRate: string; tax: string; total: string }>
}

const money = (v: string | number) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function DebitNoteDetailPage() {
  const { slug, id } = useParams<{ slug: string; id: string }>()
  const [note, setNote] = useState<DebitNoteDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/debit-notes/${id}`)
      const data = await res.json()
      if (res.ok) setNote(data)
      else toast.error(data.error || 'Debit note not found')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  async function act(action: 'issue' | 'cancel') {
    setBusy(true)
    try {
      const res = await fetch(`/api/debit-notes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(typeof data.error === 'string' ? data.error : 'Failed to update debit note')
        return
      }
      toast.success(action === 'issue' ? 'Debit note issued' : 'Debit note cancelled')
      setConfirmCancel(false)
      await load()
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <PageLoading text="Loading debit note..." />
  if (!note) return <p className="text-sm text-gray-500">Debit note not found.</p>

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href={`/c/${slug}/debit-notes`} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">← Debit notes</Link>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white mt-1">Debit note {note.debitNoteNo}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 capitalize">
            {note.status}{note.glPosted ? ' · posted to ledger' : ''} · {note.postingDate || note.createdAt.slice(0, 10)}
          </p>
        </div>
        <div className="flex gap-2">
          {note.status === 'draft' && (
            <button onClick={() => act('issue')} disabled={busy} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50">
              {busy && <Loader2 size={14} className="animate-spin" />} Issue
            </button>
          )}
          {note.status !== 'cancelled' && (
            <button onClick={() => setConfirmCancel(true)} disabled={busy} className="px-3 py-1.5 border border-red-300 text-red-600 text-sm rounded hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50">
              Cancel note
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4 text-sm">
        <div>
          <p className="text-gray-500 dark:text-gray-400">Customer</p>
          <p className="font-medium">{note.customer?.name || note.customerName || '—'}</p>
          {note.customer?.address && <p>{note.customer.address}</p>}
          {note.customer?.taxId && <p>VAT No: {note.customer.taxId}</p>}
        </div>
        <div>
          <p className="text-gray-500 dark:text-gray-400">Against invoice</p>
          <p className="font-medium">{note.sale?.invoiceNo || '—'}</p>
          {note.reason && <p className="mt-2 text-gray-600 dark:text-gray-400">{note.reason}</p>}
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900">
            <tr className="text-gray-600 dark:text-gray-400">
              <th className="px-3 py-2 text-left font-medium">Description</th>
              <th className="px-3 py-2 text-right font-medium">Qty</th>
              <th className="px-3 py-2 text-right font-medium">Unit price</th>
              <th className="px-3 py-2 text-right font-medium">Value</th>
              <th className="px-3 py-2 text-right font-medium">VAT %</th>
              <th className="px-3 py-2 text-right font-medium">VAT</th>
            </tr>
          </thead>
          <tbody>
            {note.items.map((l) => (
              <tr key={l.id} className="border-t border-gray-100 dark:border-gray-700">
                <td className="px-3 py-2">{l.itemName}</td>
                <td className="px-3 py-2 text-right">{Number(l.quantity)}</td>
                <td className="px-3 py-2 text-right font-mono">{money(l.unitPrice)}</td>
                <td className="px-3 py-2 text-right font-mono">{money(l.total)}</td>
                <td className="px-3 py-2 text-right">{Number(l.taxRate)}</td>
                <td className="px-3 py-2 text-right font-mono">{money(l.tax)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-gray-200 dark:border-gray-600">
            <tr><td colSpan={5} className="px-3 py-1 text-right">Value excl. VAT</td><td className="px-3 py-1 text-right font-mono">{money(note.subtotal)}</td></tr>
            <tr><td colSpan={5} className="px-3 py-1 text-right">VAT</td><td className="px-3 py-1 text-right font-mono">{money(note.tax)}</td></tr>
            <tr className="font-semibold"><td colSpan={5} className="px-3 py-1 text-right">Total</td><td className="px-3 py-1 text-right font-mono">{money(note.total)}</td></tr>
          </tfoot>
        </table>
      </div>

      <ConfirmModal
        isOpen={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={() => act('cancel')}
        title="Cancel debit note"
        message={`Cancel ${note.debitNoteNo}? Its ledger postings are reversed. A note already transmitted to the tax authority cannot be cancelled — issue a credit note instead.`}
        confirmText="Cancel note"
        variant="danger"
        processing={busy}
      />
    </div>
  )
}
