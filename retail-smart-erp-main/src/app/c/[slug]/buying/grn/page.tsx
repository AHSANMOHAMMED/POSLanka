'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'

type GRN = {
  id: string
  receiptNo: string
  purchaseOrderId: string | null
  status: string
  receivedAt: string | null
  createdAt: string
}

export default function GRNListPage() {
  const params = useParams()
  const slug = params.slug as string
  const [rows, setRows] = useState<GRN[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      const res = await fetch('/api/purchase-receipts')
      if (res.ok) {
        const data = await res.json()
        setRows(data.receipts || data.purchaseReceipts || data || [])
      }
      setLoading(false)
    })()
  }, [])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Goods Received Notes (GRN)</h1>
        <p className="text-sm text-gray-500">
          Receipts created when purchase orders are received
        </p>
      </div>
      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : (
        <div className="bg-white border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-3 py-2">GRN No</th>
                <th className="px-3 py-2">PO</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Received</th>
              </tr>
            </thead>
            <tbody>
              {(Array.isArray(rows) ? rows : []).map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2 font-medium">{r.receiptNo || r.id.slice(0, 8)}</td>
                  <td className="px-3 py-2">
                    {r.purchaseOrderId ? (
                      <Link
                        href={`/c/${slug}/purchase-orders/${r.purchaseOrderId}`}
                        className="text-teal-700 hover:underline"
                      >
                        View PO
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2 capitalize">{r.status}</td>
                  <td className="px-3 py-2">
                    {r.receivedAt || r.createdAt
                      ? new Date(r.receivedAt || r.createdAt).toLocaleString()
                      : '—'}
                  </td>
                </tr>
              ))}
              {(!rows || rows.length === 0) && (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-gray-500">
                    No GRNs yet — receive a purchase order to create one
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
