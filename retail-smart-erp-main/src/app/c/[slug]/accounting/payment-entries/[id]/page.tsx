'use client'

import { useState, useCallback, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Home,
  ChevronRight,
  ArrowDownRight,
  ArrowUpRight,
  ArrowRightLeft,
  CheckCircle,
  XCircle,
} from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { useRealtimeDocument, useCurrency } from '@/hooks'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'
import { StatusBadge } from '@/components/ui'
import { formatCurrency } from '@/lib/utils/currency'
import { format } from 'date-fns'
import { CancellationReasonModal } from '@/components/modals'
import { DocumentCommentsAndActivity } from '@/components/ui/document-comments'
import { DetailPageActions, type ActionConfig } from '@/components/ui/detail-page-actions'

interface PaymentEntryDetail {
  id: string
  entryNumber: string
  paymentType: 'receive' | 'pay' | 'internal_transfer'
  postingDate: string
  partyType: string | null
  partyId: string | null
  partyName: string | null
  paidFromAccountId: string | null
  paidToAccountId: string | null
  modeOfPaymentId: string | null
  paidAmount: string
  receivedAmount: string
  totalAllocatedAmount: string
  unallocatedAmount: string
  writeOffAmount: string
  referenceNo: string | null
  referenceDate: string | null
  bankAccountId: string | null
  clearanceDate: string | null
  status: 'draft' | 'submitted' | 'cancelled'
  remarks: string | null
  cancellationReason: string | null
  submittedAt: string | null
  cancelledAt: string | null
  createdAt: string
  updatedAt: string
  createdByName: string | null
  submittedByName: string | null
  references?: {
    id: string
    referenceType: string
    referenceId: string
    referenceNumber: string
    totalAmount: string
    outstandingAmount: string
    allocatedAmount: string
  }[]
  deductions?: {
    id: string
    accountId: string
    amount: string
    description: string | null
  }[]
  paidFromAccount?: { name: string; accountNumber: string } | null
  paidToAccount?: { name: string; accountNumber: string } | null
  modeOfPayment?: { name: string } | null
}

const typeConfig = {
  receive: { icon: ArrowDownRight, label: 'Receive', color: 'text-green-600 bg-green-50 dark:text-green-400 dark:bg-green-900/20' },
  pay: { icon: ArrowUpRight, label: 'Pay', color: 'text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-900/20' },
  internal_transfer: { icon: ArrowRightLeft, label: 'Internal Transfer', color: 'text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-900/20' },
}

export default function PaymentEntryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { tenantSlug } = useCompany()
  const { currency } = useCurrency()
  const [entry, setEntry] = useState<PaymentEntryDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  const fetchEntry = useCallback(async () => {
    try {
      const res = await fetch(`/api/accounting/payment-entries/${id}`)
      if (res.ok) {
        const data = await res.json()
        setEntry(data)
      } else {
        toast.error('Payment entry not found')
        router.push(`/c/${tenantSlug}/accounting/payment-entries`)
      }
    } catch {
      toast.error('Failed to load payment entry')
    } finally {
      setLoading(false)
    }
  }, [id, router, tenantSlug])

  useRealtimeDocument('payment-entry', id, fetchEntry)

  async function handleSubmit() {
    const res = await fetch(`/api/accounting/payment-entries/${id}/submit`, { method: 'POST' })
    if (res.ok) {
      toast.success('Payment entry submitted')
      fetchEntry()
    } else {
      const err = await res.json()
      toast.error(err.error || 'Failed to submit')
    }
  }

  async function handleCancel(reason: string) {
    setCancelling(true)
    try {
      const res = await fetch(`/api/accounting/payment-entries/${id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cancellationReason: reason }),
      })
      if (res.ok) {
        toast.success('Payment entry cancelled')
        setShowCancelModal(false)
        fetchEntry()
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to cancel')
      }
    } catch {
      toast.error('Error cancelling payment entry')
    } finally {
      setCancelling(false)
    }
  }

  if (loading) return <PageLoading text="Loading payment entry..." />
  if (!entry) return null

  const config = typeConfig[entry.paymentType]
  const TypeIcon = config.icon

  return (
    <div className="h-full flex flex-col -m-5">
      {/* Breadcrumb */}
      <div className="px-4 py-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 text-sm">
        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
          <Link href={`/c/${tenantSlug}/dashboard`} className="hover:text-blue-600"><Home size={14} /></Link>
          <ChevronRight size={14} />
          <Link href={`/c/${tenantSlug}/accounting`} className="hover:text-blue-600">Accounting</Link>
          <ChevronRight size={14} />
          <Link href={`/c/${tenantSlug}/accounting/payment-entries`} className="hover:text-blue-600">Payment Entries</Link>
          <ChevronRight size={14} />
          <span className="text-gray-900 dark:text-white font-medium">{entry.entryNumber}</span>
        </div>
      </div>

      {/* Title Bar */}
      <div className="px-4 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white">{entry.entryNumber}</h1>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${config.color}`}>
              <TypeIcon size={12} />
              {config.label}
            </span>
            <StatusBadge status={entry.status} size="sm" />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900 p-4">
        <div className="max-w-4xl mx-auto space-y-4">
          {/* Details Card */}
          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-gray-500 dark:text-gray-400 block">Posting Date</span>
                <span className="font-medium text-gray-900 dark:text-white">{format(new Date(entry.postingDate), 'MMM dd, yyyy')}</span>
              </div>
              {entry.partyName && (
                <div>
                  <span className="text-gray-500 dark:text-gray-400 block capitalize">{entry.partyType || 'Party'}</span>
                  <span className="font-medium text-gray-900 dark:text-white">{entry.partyName}</span>
                </div>
              )}
              {entry.modeOfPayment && (
                <div>
                  <span className="text-gray-500 dark:text-gray-400 block">Mode of Payment</span>
                  <span className="font-medium text-gray-900 dark:text-white">{entry.modeOfPayment.name}</span>
                </div>
              )}
              {entry.paidFromAccount && (
                <div>
                  <span className="text-gray-500 dark:text-gray-400 block">Paid From</span>
                  <span className="font-medium text-gray-900 dark:text-white">{entry.paidFromAccount.accountNumber} - {entry.paidFromAccount.name}</span>
                </div>
              )}
              {entry.paidToAccount && (
                <div>
                  <span className="text-gray-500 dark:text-gray-400 block">Paid To</span>
                  <span className="font-medium text-gray-900 dark:text-white">{entry.paidToAccount.accountNumber} - {entry.paidToAccount.name}</span>
                </div>
              )}
              {entry.referenceNo && (
                <div>
                  <span className="text-gray-500 dark:text-gray-400 block">Reference No</span>
                  <span className="font-medium text-gray-900 dark:text-white">{entry.referenceNo}</span>
                </div>
              )}
            </div>
          </div>

          {/* Amounts Card */}
          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-3 bg-gray-50 dark:bg-gray-900 rounded">
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Paid Amount</div>
                <div className="text-lg font-semibold text-gray-900 dark:text-white">{formatCurrency(Number(entry.paidAmount), currency)}</div>
              </div>
              <div className="text-center p-3 bg-green-50 dark:bg-green-900/20 rounded">
                <div className="text-xs text-green-600 dark:text-green-400 mb-1">Allocated</div>
                <div className="text-lg font-semibold text-green-700 dark:text-green-300">{formatCurrency(Number(entry.totalAllocatedAmount), currency)}</div>
              </div>
              <div className="text-center p-3 bg-amber-50 dark:bg-amber-900/20 rounded">
                <div className="text-xs text-amber-600 dark:text-amber-400 mb-1">Unallocated</div>
                <div className="text-lg font-semibold text-amber-700 dark:text-amber-300">{formatCurrency(Number(entry.unallocatedAmount), currency)}</div>
              </div>
              {Number(entry.writeOffAmount) > 0 && (
                <div className="text-center p-3 bg-red-50 dark:bg-red-900/20 rounded">
                  <div className="text-xs text-red-600 dark:text-red-400 mb-1">Write-off</div>
                  <div className="text-lg font-semibold text-red-700 dark:text-red-300">{formatCurrency(Number(entry.writeOffAmount), currency)}</div>
                </div>
              )}
            </div>
          </div>

          {/* References */}
          {entry.references && entry.references.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
              <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Invoice References</h3>
              </div>
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Type</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Invoice #</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Total</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Outstanding</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Allocated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {entry.references.map((ref) => (
                    <tr key={ref.id}>
                      <td className="px-4 py-2 text-sm capitalize text-gray-600 dark:text-gray-400">{ref.referenceType}</td>
                      <td className="px-4 py-2 text-sm font-medium text-gray-900 dark:text-white">{ref.referenceNumber}</td>
                      <td className="px-4 py-2 text-sm text-right text-gray-600 dark:text-gray-400">{formatCurrency(Number(ref.totalAmount), currency)}</td>
                      <td className="px-4 py-2 text-sm text-right text-gray-600 dark:text-gray-400">{formatCurrency(Number(ref.outstandingAmount), currency)}</td>
                      <td className="px-4 py-2 text-sm text-right font-medium text-gray-900 dark:text-white">{formatCurrency(Number(ref.allocatedAmount), currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Remarks */}
          {entry.remarks && (
            <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Remarks</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">{entry.remarks}</p>
            </div>
          )}

          {/* Cancellation Info */}
          {entry.status === 'cancelled' && entry.cancellationReason && (
            <div className="bg-red-50 dark:bg-red-900/20 rounded border border-red-200 dark:border-red-800 p-4">
              <h3 className="text-sm font-medium text-red-700 dark:text-red-400 mb-1">Cancellation Reason</h3>
              <p className="text-sm text-red-600 dark:text-red-300">{entry.cancellationReason}</p>
              {entry.cancelledAt && (
                <p className="text-xs text-red-500 mt-1">Cancelled on {format(new Date(entry.cancelledAt), 'MMM dd, yyyy HH:mm')}</p>
              )}
            </div>
          )}

          {/* Comments & Activity */}
          <DocumentCommentsAndActivity
            documentType="payment_entry"
            documentId={id}
            entityType="payment-entry"
          />
        </div>
      </div>

      <DetailPageActions actions={(() => {
        const a: ActionConfig[] = []
        if (entry.status === 'draft') {
          a.push({
            key: 'submit',
            label: 'Submit',
            icon: <CheckCircle size={14} />,
            variant: 'success',
            onClick: handleSubmit,
            confirmation: {
              title: 'Submit Payment Entry',
              message: `Submit ${entry.entryNumber}? This will post the entry to the ledger.`,
              variant: 'success',
              confirmText: 'Submit',
            },
          })
        }
        if (entry.status === 'submitted') {
          a.push({
            key: 'cancel',
            label: 'Cancel',
            icon: <XCircle size={14} />,
            variant: 'danger',
            position: 'left',
            onClick: () => setShowCancelModal(true),
          })
        }
        return a
      })()} />

      <CancellationReasonModal
        isOpen={showCancelModal}
        onClose={() => setShowCancelModal(false)}
        onConfirm={handleCancel}
        title="Cancel Payment Entry"
        itemName={`Payment Entry ${entry.entryNumber}`}
        processing={cancelling}
      />
    </div>
  )
}
