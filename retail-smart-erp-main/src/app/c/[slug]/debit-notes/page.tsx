'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Plus, Receipt } from 'lucide-react'
import { PageLoading } from '@/components/ui/loading-spinner'

type DebitNote = {
  id: string
  debitNoteNo: string
  customerName: string | null
  status: 'draft' | 'issued' | 'cancelled'
  subtotal: string
  tax: string
  total: string
  reason: string | null
  postingDate: string | null
  createdAt: string
}

const STATUS_CLASS: Record<DebitNote['status'], string> = {
  draft: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  issued: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
}

export default function DebitNotesPage() {
  const { slug } = useParams<{ slug: string }>()
  const [rows, setRows] = useState<DebitNote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch('/api/debit-notes')
        const data = await res.json()
        if (!res.ok) setError(typeof data.error === 'string' ? data.error : 'Failed to load debit notes')
        else setRows(data.debitNotes || [])
      } catch {
        setError('Failed to load debit notes')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  if (loading) return <PageLoading text="Loading debit notes..." />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Debit notes</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Additional charges against an issued invoice (posts receivable, revenue and output VAT)</p>
        </div>
        <Link
          href={`/c/${slug}/debit-notes/new`}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} /> New debit note
        </Link>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900">
            <tr className="text-left text-gray-600 dark:text-gray-400">
              <th className="px-3 py-2 font-medium">No</th>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Customer</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium text-right">Value</th>
              <th className="px-3 py-2 font-medium text-right">VAT</th>
              <th className="px-3 py-2 font-medium text-right">Total</th>
              <th className="px-3 py-2 font-medium">Reason</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-gray-500 dark:text-gray-400">
                  <Receipt size={28} className="mx-auto mb-2 text-gray-300 dark:text-gray-600" />
                  No debit notes yet
                </td>
              </tr>
            ) : (
              rows.map((n) => (
                <tr key={n.id} className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-3 py-2 font-medium">
                    <Link href={`/c/${slug}/debit-notes/${n.id}`} className="text-blue-600 dark:text-blue-400 hover:underline">{n.debitNoteNo}</Link>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{n.postingDate || n.createdAt.slice(0, 10)}</td>
                  <td className="px-3 py-2">{n.customerName || '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_CLASS[n.status]}`}>{n.status}</span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{Number(n.subtotal).toFixed(2)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{Number(n.tax).toFixed(2)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{Number(n.total).toFixed(2)}</td>
                  <td className="px-3 py-2">{n.reason || '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
