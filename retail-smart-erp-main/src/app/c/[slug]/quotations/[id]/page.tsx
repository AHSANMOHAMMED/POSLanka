'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ShoppingCart, Share2, AlertCircle, Pencil, Send, CheckCircle2, XCircle, Ban, Undo2, Trash2 } from 'lucide-react'
import { PrintA4Button } from '@/components/print/PrintA4Button'
import { quotationToDoc, companyFromTenant, TEMPLATE_DOC_TYPES, type QuotationApi } from '@/lib/print/invoice-document'

interface QuotationItem {
  id: string
  itemName: string
  quantity: string | number
  unitPrice: string | number
  discount: string | number
  tax?: string | number
  taxRate?: string | number | null
  uom?: string | null
  uomFactor?: string | number | null
  warrantyMonths?: number | null
  total: string | number
}

interface QuotationData {
  id: string
  quotationNo: string
  customerName: string | null
  customerPhone: string | null
  customerEmail: string | null
  validUntil: string | null
  notes: string | null
  status: string
  subtotal: string | number
  discount: string | number
  tax: string | number
  total: string | number
  createdAt: string
  items: QuotationItem[]
}

interface TenantData {
  name: string
  legalName: string | null
  businessId: string
  email: string
  phone: string | null
  address: string | null
  logoUrl: string | null
  brn: string | null
  taxId: string | null
  currency: string
  website?: string | null
  taxInclusive?: boolean
}

/** Status changes offered per status (PATCH /api/quotations/[id]). */
const STATUS_ACTIONS: Record<string, Array<{ to: string; label: string }>> = {
  draft: [{ to: 'sent', label: 'Mark as sent' }, { to: 'accepted', label: 'Accepted' }, { to: 'rejected', label: 'Rejected' }, { to: 'cancelled', label: 'Cancel' }],
  sent: [{ to: 'accepted', label: 'Accepted' }, { to: 'rejected', label: 'Rejected' }, { to: 'draft', label: 'Back to draft' }, { to: 'cancelled', label: 'Cancel' }],
  accepted: [{ to: 'sent', label: 'Back to sent' }, { to: 'rejected', label: 'Rejected' }, { to: 'cancelled', label: 'Cancel' }],
  rejected: [{ to: 'draft', label: 'Reopen as draft' }, { to: 'sent', label: 'Mark as sent' }],
  expired: [{ to: 'draft', label: 'Reopen as draft' }, { to: 'cancelled', label: 'Cancel' }],
  cancelled: [{ to: 'draft', label: 'Reopen as draft' }],
}
const STATUS_ICONS: Record<string, typeof Send> = { sent: Send, accepted: CheckCircle2, rejected: XCircle, cancelled: Ban, draft: Undo2 }

export default function QuotationDetailPage() {
  const params = useParams()
  const slug = params.slug as string
  const id = params.id as string
  const router = useRouter()

  const [quotation, setQuotation] = useState<QuotationData | null>(null)
  const [tenant, setTenant] = useState<TenantData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [converting, setConverting] = useState(false)
  const [busyStatus, setBusyStatus] = useState<string | null>(null)
  // ?print=1 (POS "Save as quotation" link) opens the print dialog once loaded
  const [autoPrint] = useState(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('print') === '1')

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/quotations/${id}`)
        const data = await res.json()
        if (!res.ok) {
          setError(data.error || 'Failed to load quotation')
          return
        }
        setQuotation(data.quotation)
        setTenant(data.tenant)
      } catch {
        setError('Error fetching quotation details')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  async function convertToSale() {
    if (!quotation) return
    setConverting(true)
    try {
      const res = await fetch(`/api/quotations/${id}/convert`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error || 'Conversion failed')
        return
      }
      sessionStorage.setItem('poslanka_quote_cart', JSON.stringify(data))
      router.push(`/c/${slug}/pos?fromQuotation=${id}`)
    } catch {
      alert('Network error while converting quotation')
    } finally {
      setConverting(false)
    }
  }

  async function changeStatus(to: string) {
    if (!quotation) return
    if (to === 'cancelled' && !confirm('Cancel this quotation?')) return
    setBusyStatus(to)
    try {
      const res = await fetch(`/api/quotations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: to }),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(typeof data.error === 'string' ? data.error : 'Failed to update status')
        return
      }
      setQuotation((q) => (q ? { ...q, status: data.status || to } : q))
    } catch {
      alert('Network error while updating status')
    } finally {
      setBusyStatus(null)
    }
  }

  async function deleteQuotation() {
    if (!confirm('Delete this draft quotation?')) return
    try {
      const res = await fetch(`/api/quotations/${id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(typeof data.error === 'string' ? data.error : 'Failed to delete quotation')
        return
      }
      router.push(`/c/${slug}/quotations`)
    } catch {
      alert('Network error while deleting quotation')
    }
  }

  async function loadPrintDocument() {
    if (!quotation) throw new Error('Quotation not loaded')
    return {
      doc: quotationToDoc(quotation as unknown as QuotationApi, { taxInclusive: !!tenant?.taxInclusive }),
      company: companyFromTenant(tenant as unknown as Record<string, unknown>),
    }
  }

  if (loading) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3">
        <div className="w-8 h-8 border-4 border-teal-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-slate-500">Loading quotation details...</p>
      </div>
    )
  }

  if (error || !quotation) {
    return (
      <div className="max-w-md mx-auto my-12 p-6 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-2xl text-center">
        <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-red-800 dark:text-red-200 mb-1">Quotation Not Found</h2>
        <p className="text-sm text-red-600 dark:text-red-300 mb-5">{error || 'This quotation does not exist or has been removed.'}</p>
        <Link
          href={`/c/${slug}/quotations`}
          className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800 text-white text-sm font-semibold rounded-xl hover:bg-slate-700"
        >
          <ArrowLeft size={16} /> Back to Quotations
        </Link>
      </div>
    )
  }

  const subtotalNum = Number(quotation.subtotal) || 0
  const discountNum = Number(quotation.discount) || 0
  const totalNum = Number(quotation.total) || 0
  const currencyCode = tenant?.currency || 'LKR'

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-900 pb-20 print:bg-white print:p-0">
      {/* Top action toolbar (Hidden in Print) */}
      <header className="sticky top-0 z-30 bg-white/95 dark:bg-slate-800/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-700 px-6 py-4 flex items-center justify-between shadow-sm print:hidden">
        <div className="flex items-center gap-3">
          <Link
            href={`/c/${slug}/quotations`}
            className="p-2 rounded-xl text-slate-500 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            title="Back"
          >
            <ArrowLeft size={20} />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-extrabold text-slate-900 dark:text-white">
                {quotation.quotationNo}
              </h1>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold capitalize ${
                quotation.status === 'converted'
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                  : quotation.status === 'sent'
                  ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300'
                  : 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
              }`}>
                {quotation.status}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Created on {new Date(quotation.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {quotation.customerPhone && (
            <a
              href={`https://wa.me/${quotation.customerPhone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(
                `Hello ${quotation.customerName || 'Customer'}, here is your quotation ${quotation.quotationNo} from ${tenant?.name || 'POSLanka'}: Total ${currencyCode} ${totalNum.toFixed(2)}.`
              )}`}
              target="_blank"
              rel="noreferrer"
              className="px-3.5 py-2 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300 rounded-xl text-xs font-bold hover:bg-emerald-100 transition-colors flex items-center gap-1.5 border border-emerald-200 dark:border-emerald-800"
            >
              <Share2 size={15} /> WhatsApp
            </a>
          )}
          {['draft', 'sent', 'expired'].includes(quotation.status) && (
            <Link
              href={`/c/${slug}/quotations/${id}/edit`}
              className="px-3.5 py-2 bg-white dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-100 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border border-slate-300 dark:border-slate-600"
            >
              <Pencil size={15} /> Edit
            </Link>
          )}
          {quotation.status === 'draft' && (
            <button
              type="button"
              onClick={deleteQuotation}
              title="Delete draft"
              className="p-2 rounded-xl text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 border border-slate-300 dark:border-slate-600 transition-colors"
            >
              <Trash2 size={15} />
            </button>
          )}
          <PrintA4Button
            documentTypes={TEMPLATE_DOC_TYPES.quotation}
            loadDocument={loadPrintDocument}
            label="Print / Save PDF"
            autoPrint={autoPrint}
            className="px-4 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-100 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border border-slate-300 dark:border-slate-600 shadow-xs disabled:opacity-50"
          />
          {!['converted', 'cancelled', 'rejected'].includes(quotation.status) && (
            <button
              type="button"
              onClick={convertToSale}
              disabled={converting}
              className="px-5 py-2 theme-btn-primary rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-sm disabled:opacity-50"
            >
              <ShoppingCart size={16} />
              {converting ? 'Converting...' : 'Convert to Sale'}
            </button>
          )}
        </div>
      </header>

      {(STATUS_ACTIONS[quotation.status] || []).length > 0 && (
        <div className="max-w-4xl mx-auto mt-4 px-4 sm:px-6 flex flex-wrap items-center gap-2 print:hidden">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 mr-1">Status:</span>
          {STATUS_ACTIONS[quotation.status].map((a) => {
            const Icon = STATUS_ICONS[a.to] || Send
            return (
              <button
                key={a.to}
                type="button"
                disabled={busyStatus !== null}
                onClick={() => changeStatus(a.to)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-1.5 disabled:opacity-50"
              >
                <Icon size={13} /> {busyStatus === a.to ? 'Saving...' : a.label}
              </button>
            )
          })}
        </div>
      )}

      {/* Printable Quotation Document Paper */}
      <main className="max-w-4xl mx-auto mt-8 px-4 sm:px-6 print:m-0 print:p-0 print:max-w-none">
        <div className="bg-white text-slate-900 rounded-2xl shadow-xl border border-slate-200 p-8 sm:p-12 print:shadow-none print:border-none print:p-6 print:rounded-none">
          {/* Header row: Company branding + Quotation Title */}
          <div className="flex justify-between items-start pb-8 border-b-2 border-slate-900 gap-6">
            <div className="max-w-md">
              {tenant?.logoUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={tenant.logoUrl}
                  alt={tenant.name}
                  className="h-14 object-contain mb-3"
                />
              )}
              <h2 className="text-2xl font-black tracking-tight text-slate-950 uppercase">
                {tenant?.legalName || tenant?.name || 'Company Name'}
              </h2>
              {tenant?.address && (
                <p className="text-xs text-slate-600 mt-1 whitespace-pre-line leading-relaxed">
                  {tenant.address}
                </p>
              )}
              <div className="mt-2 text-xs text-slate-600 space-y-0.5">
                {tenant?.phone && <p><strong>Tel:</strong> {tenant.phone}</p>}
                {tenant?.email && <p><strong>Email:</strong> {tenant.email}</p>}
                {tenant?.brn && <p><strong>Business Reg No:</strong> {tenant.brn}</p>}
                {tenant?.taxId && <p><strong>Tax ID / VAT:</strong> {tenant.taxId}</p>}
              </div>
            </div>

            <div className="text-right">
              <div className="inline-block px-4 py-1.5 bg-slate-900 text-white rounded-lg text-sm font-black uppercase tracking-wider mb-3">
                Quotation
              </div>
              <p className="font-mono text-xl font-black text-slate-900">
                {quotation.quotationNo}
              </p>
              <div className="text-xs text-slate-600 mt-2 space-y-1">
                <p><strong>Date:</strong> {new Date(quotation.createdAt).toLocaleDateString('en-GB')}</p>
                {quotation.validUntil && (
                  <p className="text-amber-800 font-semibold">
                    <strong>Valid Until:</strong> {new Date(quotation.validUntil).toLocaleDateString('en-GB')}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Client Details */}
          <div className="grid grid-cols-2 gap-6 my-8 p-4 bg-slate-50 rounded-xl border border-slate-100 print:bg-transparent print:border print:border-slate-300">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Quotation Issued To
              </p>
              <p className="text-base font-extrabold text-slate-900">
                {quotation.customerName || 'Valued Customer'}
              </p>
              {quotation.customerPhone && (
                <p className="text-xs text-slate-600 mt-0.5">
                  <strong>Phone:</strong> {quotation.customerPhone}
                </p>
              )}
              {quotation.customerEmail && (
                <p className="text-xs text-slate-600 mt-0.5">
                  <strong>Email:</strong> {quotation.customerEmail}
                </p>
              )}
            </div>
            <div className="text-right flex flex-col justify-end">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Status</span>
              <span className="text-sm font-black uppercase tracking-wide text-teal-800">
                {quotation.status}
              </span>
            </div>
          </div>

          {/* Items Table */}
          <div className="overflow-hidden border border-slate-300 rounded-xl mb-8 print:border-slate-400">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="bg-slate-900 text-white text-xs uppercase font-extrabold print:bg-slate-200 print:text-slate-900">
                  <th className="py-3 px-4 w-12 text-center">#</th>
                  <th className="py-3 px-4">Description</th>
                  <th className="py-3 px-3 w-24 text-right">Qty</th>
                  <th className="py-3 px-3 w-32 text-right">Unit Price</th>
                  <th className="py-3 px-3 w-28 text-right">Discount</th>
                  <th className="py-3 px-3 w-20 text-right">Tax</th>
                  <th className="py-3 px-4 w-36 text-right">Line Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {quotation.items?.map((item, idx) => {
                  const q = Number(item.quantity) || 1
                  const p = Number(item.unitPrice) || 0
                  const d = Number(item.discount) || 0
                  const lineTot = Number(item.total) || Math.max(0, q * p - d)
                  return (
                    <tr key={item.id || idx} className="hover:bg-slate-50/50">
                      <td className="py-3 px-4 text-center text-xs text-slate-400 font-mono">
                        {idx + 1}
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-800">
                        {item.itemName}
                        {(item.warrantyMonths || 0) > 0 && (
                          <div className="text-[11px] font-medium text-slate-500">Warranty: {item.warrantyMonths} month{item.warrantyMonths === 1 ? '' : 's'}</div>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-medium">
                        {q}{item.uom ? <span className="text-xs text-slate-500"> {item.uom}</span> : null}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-slate-700">
                        {p.toFixed(2)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-rose-600">
                        {d > 0 ? `-${d.toFixed(2)}` : '—'}
                      </td>
                      <td className="py-3 px-3 text-right text-xs text-slate-600">
                        {Number(item.taxRate) > 0 ? `${Number(item.taxRate)}%` : '—'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                        {lineTot.toFixed(2)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Bottom section: Notes & Financial Totals */}
          <div className="grid grid-cols-2 gap-8 items-start pt-4">
            <div className="text-xs text-slate-600 space-y-3">
              <div>
                <h4 className="font-bold uppercase tracking-wider text-slate-900 text-[11px] mb-1">
                  Terms & Notes
                </h4>
                <p className="whitespace-pre-line leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-100 print:bg-transparent print:border-none print:p-0">
                  {quotation.notes || 'Quotation valid for 14 days from issue date. Subject to standard terms and stock availability.'}
                </p>
              </div>

              <div className="pt-8 print:pt-16">
                <div className="w-48 border-b border-slate-400 mb-1" />
                <p className="font-bold text-[11px] uppercase tracking-wider text-slate-500">
                  Authorized Signatory & Stamp
                </p>
              </div>
            </div>

            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 space-y-2.5 print:bg-transparent print:border print:border-slate-300">
              <div className="flex justify-between text-sm text-slate-600">
                <span>Subtotal</span>
                <span className="font-mono font-bold">{currencyCode} {subtotalNum.toFixed(2)}</span>
              </div>
              {discountNum > 0 && (
                <div className="flex justify-between text-sm text-rose-600">
                  <span>Discounts</span>
                  <span className="font-mono font-bold">-{currencyCode} {discountNum.toFixed(2)}</span>
                </div>
              )}
              {Number(quotation.tax) > 0 && (
                <div className="flex justify-between text-sm text-slate-600">
                  <span>Tax{tenant?.taxInclusive ? ' (included)' : ''}</span>
                  <span className="font-mono font-bold">{currencyCode} {Number(quotation.tax).toFixed(2)}</span>
                </div>
              )}
              <div className="pt-3 border-t-2 border-slate-300 flex justify-between items-baseline">
                <span className="text-base font-black text-slate-900 uppercase tracking-tight">Grand Total</span>
                <span className="text-2xl font-mono font-black text-teal-800">
                  {currencyCode} {totalNum.toFixed(2)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
