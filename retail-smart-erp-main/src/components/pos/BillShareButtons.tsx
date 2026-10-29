'use client'

/**
 * "WhatsApp" and "PDF" for one bill (POS after a sale, Bills history, sale page).
 *  - WhatsApp: opens the customer's chat (phone from the customer record, nobody types it; no number →
 *    WhatsApp asks for the chat) with the bill total and a link to the PDF of the receipt.
 *  - PDF: the receipt as a PDF file, handed to the phone / Windows share window (pick WhatsApp there),
 *    or downloaded when this browser cannot share files.
 */
import { useState } from 'react'
import { FileDown, Loader2, MessageCircle } from 'lucide-react'
import { buildWhatsAppShareUrl } from '@/lib/whatsapp'
import { useCurrency } from '@/hooks'

interface ShareInfo { invoiceNo: string; total: string | number; isReturn: boolean; customerName: string | null; phone: string | null; pageUrl: string; pdfUrl: string }

async function loadShare(saleId: string): Promise<ShareInfo> {
  const res = await fetch(`/api/sales/${saleId}/share`)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || 'Could not prepare the bill')
  return body as ShareInfo
}

export function BillShareButtons({ saleId, shopName, phone, showWhatsApp = true, compact }: {
  saleId: string
  shopName?: string
  /** Phone known on this screen (used when the customer record has none). */
  phone?: string | null
  showWhatsApp?: boolean
  compact?: boolean
}) {
  const { currency } = useCurrency()
  const [busy, setBusy] = useState<'wa' | 'pdf' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function whatsApp() {
    setBusy('wa')
    setError(null)
    // Open the tab inside the click (popup blockers), point it at WhatsApp once the link is ready
    const tab = window.open('about:blank', '_blank')
    try {
      const s = await loadShare(saleId)
      const total = Number(s.total).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      const text = [
        `🧾 *${shopName || 'Your bill'}*`,
        `${s.isReturn ? 'Credit note' : 'Bill'}: *${s.invoiceNo}*`,
        s.customerName ? `Customer: ${s.customerName}` : null,
        `Total: *${currency} ${total}*`,
        `Your bill (PDF): ${s.pdfUrl}`,
        'Thank you!',
      ].filter(Boolean).join('\n')
      const url = buildWhatsAppShareUrl({ phone: s.phone || phone || undefined, text })
      if (tab) {
        tab.opener = null
        tab.location.href = url
      } else window.location.href = url
    } catch (e) {
      tab?.close()
      setError(e instanceof Error ? e.message : 'Could not open WhatsApp')
    } finally {
      setBusy(null)
    }
  }

  async function pdf() {
    setBusy('pdf')
    setError(null)
    try {
      const s = await loadShare(saleId)
      const res = await fetch(s.pdfUrl)
      if (!res.ok) throw new Error('Could not make the PDF')
      const file = new File([await res.blob()], `${s.isReturn ? 'credit-note' : 'bill'}-${s.invoiceNo}.pdf`, { type: 'application/pdf' })
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
      if (nav.canShare?.({ files: [file] })) {
        try {
          await nav.share({ files: [file], title: `Bill ${s.invoiceNo}` })
          return
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') return // closed the share window
          /* not allowed here: download instead */
        }
      }
      const a = document.createElement('a')
      a.href = URL.createObjectURL(file)
      a.download = file.name
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not make the PDF')
    } finally {
      setBusy(null)
    }
  }

  const btn = compact
    ? 'px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-60'
    : 'flex-1 py-3 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 shadow-sm active:scale-[0.98] disabled:opacity-60'
  const size = compact ? 14 : 18
  return (
    <div className={compact ? 'contents' : 'space-y-1'}>
      <div className={compact ? 'flex items-center gap-1.5' : 'flex gap-2'}>
        {showWhatsApp && (
          <button type="button" onClick={whatsApp} disabled={!!busy} title="Open the customer's WhatsApp chat with the bill PDF link"
            className={`${btn} ${compact ? 'bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 text-emerald-700 dark:text-emerald-300' : 'bg-emerald-600 hover:bg-emerald-700 text-white'}`}>
            {busy === 'wa' ? <Loader2 size={size} className="animate-spin" /> : <MessageCircle size={size} />}
            WhatsApp
          </button>
        )}
        <button type="button" onClick={pdf} disabled={!!busy} title="Bill as a PDF (share or download)"
          className={`${btn} ${compact ? 'bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 text-gray-700 dark:text-gray-200' : 'border-2 border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
          {busy === 'pdf' ? <Loader2 size={size} className="animate-spin" /> : <FileDown size={size} />}
          PDF
        </button>
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400" role="alert">{error}</p>}
    </div>
  )
}
