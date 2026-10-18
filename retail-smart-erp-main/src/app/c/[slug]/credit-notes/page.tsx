'use client'

import { useEffect, useState } from 'react'
import { ShareDocumentButtons } from '@/components/shared/ShareDocumentButtons'

type CreditNote = {
  id: string
  creditNoteNo: string
  customerName: string | null
  status: string
  total: string
  reason: string | null
  createdAt: string
}

export default function CreditNotesPage() {
  const [rows, setRows] = useState<CreditNote[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      const res = await fetch('/api/credit-notes')
      const data = await res.json()
      setRows(data.creditNotes || [])
      setLoading(false)
    })()
  }, [])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Credit notes</h1>
        <p className="text-sm text-gray-500">Issue credit notes against sales / returns</p>
      </div>
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
                <th className="px-3 py-2">Reason</th>
                <th className="px-3 py-2">Share</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((n) => (
                <tr key={n.id} className="border-t">
                  <td className="px-3 py-2 font-medium">{n.creditNoteNo}</td>
                  <td className="px-3 py-2">{n.customerName || '—'}</td>
                  <td className="px-3 py-2 capitalize">{n.status}</td>
                  <td className="px-3 py-2">{Number(n.total).toFixed(2)}</td>
                  <td className="px-3 py-2">{n.reason || '—'}</td>
                  <td className="px-3 py-2">
                    <ShareDocumentButtons
                      documentType="credit_note"
                      documentId={n.id}
                      label={n.creditNoteNo}
                    />
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-gray-500">
                    No credit notes yet
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
