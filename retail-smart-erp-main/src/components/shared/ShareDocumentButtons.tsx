'use client'

import { useState } from 'react'

interface ShareDocumentButtonsProps {
  documentType: 'receipt' | 'invoice' | 'quotation' | 'credit_note'
  documentId: string
  label: string
  phone?: string
  amount?: string
}

export function ShareDocumentButtons({
  documentType,
  documentId,
  label,
  phone,
  amount,
}: ShareDocumentButtonsProps) {
  const [busy, setBusy] = useState(false)

  async function shareWhatsApp() {
    setBusy(true)
    try {
      const res = await fetch('/api/documents/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentType,
          documentId,
          label,
          phone,
          amount,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error || 'Share failed')
        return
      }
      window.open(data.whatsappUrl, '_blank', 'noopener,noreferrer')
    } finally {
      setBusy(false)
    }
  }

  async function downloadPdfHtml() {
    setBusy(true)
    try {
      const res = await fetch('/api/documents/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentType,
          documentId,
          label,
          amount,
          document: {
            shopName: 'POSLanka',
            lines: [{ name: label, quantity: 1, unitPrice: Number(amount || 0), total: Number(amount || 0) }],
            subtotal: Number(amount || 0),
            tax: 0,
            total: Number(amount || 0),
            currency: 'LKR',
          },
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.html) {
        alert(data.error || 'PDF failed')
        return
      }
      const blob = new Blob([data.html], { type: 'text/html' })
      const url = URL.createObjectURL(blob)
      const w = window.open(url, '_blank', 'noopener,noreferrer')
      if (w) {
        setTimeout(() => w.print(), 400)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={shareWhatsApp}
        className="text-xs text-green-700 hover:underline disabled:opacity-50"
      >
        WhatsApp
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={downloadPdfHtml}
        className="text-xs text-gray-700 hover:underline disabled:opacity-50"
      >
        PDF
      </button>
    </span>
  )
}
