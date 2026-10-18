'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'

export default function NewQuotationPage() {
  const params = useParams()
  const slug = params.slug as string
  const router = useRouter()
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [itemName, setItemName] = useState('')
  const [qty, setQty] = useState(1)
  const [unitPrice, setUnitPrice] = useState(0)
  const [validUntil, setValidUntil] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const lineTotal = qty * unitPrice

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/quotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName,
          customerPhone,
          validUntil: validUntil || undefined,
          subtotal: lineTotal,
          discount: 0,
          tax: 0,
          total: lineTotal,
          items: [
            {
              itemName,
              quantity: qty,
              unitPrice,
              discount: 0,
              tax: 0,
              total: lineTotal,
            },
          ],
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Failed to create')
        return
      }
      router.push(`/c/${slug}/quotations`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="max-w-xl space-y-4">
      <h1 className="text-2xl font-bold">New quotation</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <label className="block text-sm">
        Customer name
        <input
          className="mt-1 w-full border rounded-md px-3 py-2"
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          required
        />
      </label>
      <label className="block text-sm">
        Phone (WhatsApp)
        <input
          className="mt-1 w-full border rounded-md px-3 py-2"
          value={customerPhone}
          onChange={(e) => setCustomerPhone(e.target.value)}
        />
      </label>
      <label className="block text-sm">
        Valid until
        <input
          type="date"
          className="mt-1 w-full border rounded-md px-3 py-2"
          value={validUntil}
          onChange={(e) => setValidUntil(e.target.value)}
        />
      </label>
      <label className="block text-sm">
        Item
        <input
          className="mt-1 w-full border rounded-md px-3 py-2"
          value={itemName}
          onChange={(e) => setItemName(e.target.value)}
          required
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">
          Qty
          <input
            type="number"
            min={0.001}
            step="any"
            className="mt-1 w-full border rounded-md px-3 py-2"
            value={qty}
            onChange={(e) => setQty(Number(e.target.value))}
            required
          />
        </label>
        <label className="block text-sm">
          Unit price (LKR)
          <input
            type="number"
            min={0}
            step="any"
            className="mt-1 w-full border rounded-md px-3 py-2"
            value={unitPrice}
            onChange={(e) => setUnitPrice(Number(e.target.value))}
            required
          />
        </label>
      </div>
      <p className="text-sm text-gray-600">Line total: {lineTotal.toFixed(2)} LKR</p>
      <button
        type="submit"
        disabled={saving}
        className="px-4 py-2 rounded-md bg-teal-700 text-white text-sm disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save quotation'}
      </button>
    </form>
  )
}
