'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

type CreditTx = {
  id: string
  type: string
  amount: string
  balanceAfter?: string
  note?: string | null
  createdAt: string
}

export default function CustomerCreditPage() {
  const params = useParams()
  const slug = params.slug as string
  const id = params.id as string
  const [rows, setRows] = useState<CreditTx[]>([])
  const [balance, setBalance] = useState<number | null>(null)
  const [limit, setLimit] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      const res = await fetch(`/api/customers/${id}/credit`)
      const data = await res.json()
      if (res.ok) {
        setRows(data.transactions || data.history || [])
        setBalance(
          data.balance !== undefined
            ? Number(data.balance)
            : data.creditBalance !== undefined
              ? Number(data.creditBalance)
              : null
        )
        setLimit(
          data.creditLimit !== undefined ? Number(data.creditLimit) : null
        )
      }
      setLoading(false)
    })()
  }, [id])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Customer credit history</h1>
          <p className="text-sm text-gray-500">
            Balance:{' '}
            {balance === null ? '—' : `${balance.toFixed(2)} LKR`}
            {limit !== null ? ` · Limit: ${limit.toFixed(2)} LKR` : ''}
          </p>
        </div>
        <Link href={`/c/${slug}/customers`} className="text-sm text-teal-700 hover:underline">
          Back to customers
        </Link>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : (
        <div className="bg-white border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Amount</th>
                <th className="px-3 py-2">Note</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2">{new Date(r.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2 capitalize">{r.type}</td>
                  <td className="px-3 py-2">{Number(r.amount).toFixed(2)}</td>
                  <td className="px-3 py-2">{r.note || '—'}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-gray-500">
                    No credit transactions
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
