'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ShareDocumentButtons } from '@/components/shared/ShareDocumentButtons'

type Quotation = {
  id: string
  quotationNo: string
  customerName: string | null
  status: string
  total: string
  validUntil: string | null
  createdAt: string
}

export default function QuotationsPage() {
  const params = useParams()
  const slug = params.slug as string
  const [rows, setRows] = useState<Quotation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch('/api/quotations')
        const data = await res.json()
        if (!res.ok) {
          setError(data.error || 'Failed to load')
          return
        }
        setRows(data.quotations || [])
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  async function convert(id: string) {
    const res = await fetch(`/api/quotations/${id}/convert`, { method: 'POST' })
    const data = await res.json()
    if (!res.ok) {
      alert(data.error || 'Convert failed')
      return
    }
    sessionStorage.setItem('poslanka_quote_cart', JSON.stringify(data))
    window.location.href = `/c/${slug}/pos?fromQuotation=${id}`
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Quotations</h1>
          <p className="text-sm text-gray-500">Create quotes, share via WhatsApp, convert to sale</p>
        </div>
        <Link
          href={`/c/${slug}/quotations/new`}
          className="px-3 py-2 rounded-md bg-teal-700 text-white text-sm"
        >
          New quotation
        </Link>
      </div>

      {error && <div className="text-sm text-red-600">{String(error)}</div>}
      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : (
        <div className="bg-white border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-3 py-2">No</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Total</th>
                <th className="px-3 py-2">Valid until</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((q) => (
                <tr key={q.id} className="border-t">
                  <td className="px-3 py-2 font-medium">{q.quotationNo}</td>
                  <td className="px-3 py-2">{q.customerName || '—'}</td>
                  <td className="px-3 py-2 capitalize">{q.status}</td>
                  <td className="px-3 py-2">{Number(q.total).toFixed(2)}</td>
                  <td className="px-3 py-2">{q.validUntil || '—'}</td>
                  <td className="px-3 py-2 space-x-2">
                    {q.status !== 'converted' && (
                      <button
                        type="button"
                        onClick={() => convert(q.id)}
                        className="text-teal-700 hover:underline"
                      >
                        Convert to sale
                      </button>
                    )}
                    <ShareDocumentButtons
                      documentType="quotation"
                      documentId={q.id}
                      label={q.quotationNo}
                    />
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-gray-500">
                    No quotations yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
