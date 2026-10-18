'use client'

import { useState, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import {
  Home,
  ChevronRight,
  Send,
  XCircle,
  Trash2,
  ArrowLeft,
} from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { useRealtimeData, useDateFormat, useCurrency } from '@/hooks'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'
import { StatusBadge } from '@/components/ui'
import { DetailPageActions, type ActionConfig } from '@/components/ui/detail-page-actions'
import { CancellationReasonModal } from '@/components/modals'
import { DocumentCommentsAndActivity } from '@/components/ui/document-comments'
import { formatCurrency } from '@/lib/utils/currency'

interface JournalEntryItem {
  id: string
  accountId: string
  accountNumber: string
  accountName: string
  debit: string
  credit: string
  partyType: string | null
  remarks: string | null
}

interface JournalEntry {
  id: string
  entryNumber: string
  postingDate: string
  entryType: string
  totalDebit: string
  totalCredit: string
  status: string
  remarks: string | null
  cancellationReason: string | null
  cancelledAt: string | null
  createdAt: string
  updatedAt: string
  createdByName: string | null
  items: JournalEntryItem[]
}

export default function JournalEntryDetailPage() {
  const { tenantSlug } = useCompany()
  const { fDate, fDateTime } = useDateFormat()
  const { currency } = useCurrency()
  const router = useRouter()
  const params = useParams()
  const id = params.id as string

  const [entry, setEntry] = useState<JournalEntry | null>(null)
  const [loading, setLoading] = useState(true)
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  const fetchEntry = useCallback(async () => {
    try {
      const res = await fetch(`/api/accounting/journal-entries/${id}`)
      if (res.ok) {
        const data = await res.json()
        setEntry(data)
      } else {
        toast.error('Failed to load journal entry')
      }
    } catch {
      toast.error('Error loading journal entry')
    } finally {
      setLoading(false)
    }
  }, [id])

  useRealtimeData(fetchEntry, { entityType: 'journal-entry' })

  async function handleSubmit() {
    const res = await fetch(`/api/accounting/journal-entries/${id}/submit`, {
      method: 'POST',
    })
    if (res.ok) {
      toast.success('Journal entry submitted')
      fetchEntry()
    } else {
      const data = await res.json()
      toast.error(data.error || 'Failed to submit journal entry')
    }
  }

  async function handleCancel(reason: string) {
    setCancelling(true)
    try {
      const res = await fetch(`/api/accounting/journal-entries/${id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cancellationReason: reason }),
      })
      if (res.ok) {
        toast.success('Journal entry cancelled')
        setShowCancelModal(false)
        fetchEntry()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to cancel journal entry')
      }
    } catch {
      toast.error('Error cancelling journal entry')
    } finally {
      setCancelling(false)
    }
  }

  async function handleDelete() {
    const res = await fetch(`/api/accounting/journal-entries/${id}`, {
      method: 'DELETE',
    })
    if (res.ok) {
      toast.success('Journal entry deleted')
      router.push(`/c/${tenantSlug}/accounting/journal-entries`)
    } else {
      const data = await res.json()
      toast.error(data.error || 'Failed to delete journal entry')
    }
  }

  if (loading) {
    return <PageLoading text="Loading journal entry..." />
  }

  if (!entry) {
    return (
      <div className="p-6 text-center">
        <p className="text-gray-500 dark:text-gray-400">Journal entry not found.</p>
        <Link
          href={`/c/${tenantSlug}/accounting/journal-entries`}
          className="mt-4 inline-flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 hover:underline"
        >
          <ArrowLeft size={14} />
          Back to Journal Entries
        </Link>
      </div>
    )
  }

  const totalDebit = parseFloat(entry.totalDebit || '0')
  const totalCredit = parseFloat(entry.totalCredit || '0')

  return (
    <div className="space-y-4 p-4 max-w-7xl mx-auto">
      {/* Breadcrumb */}
      <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
        <Link href={`/c/${tenantSlug}/dashboard`} className="hover:text-blue-600 dark:hover:text-blue-400">
          <Home size={14} />
        </Link>
        <ChevronRight size={14} />
        <Link href={`/c/${tenantSlug}/accounting`} className="hover:text-blue-600 dark:hover:text-blue-400">
          Accounting
        </Link>
        <ChevronRight size={14} />
        <Link href={`/c/${tenantSlug}/accounting/journal-entries`} className="hover:text-blue-600 dark:hover:text-blue-400">
          Journal Entries
        </Link>
        <ChevronRight size={14} />
        <span className="text-gray-900 dark:text-white font-medium">{entry.entryNumber}</span>
      </div>

      {/* Header */}
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
                {entry.entryNumber}
              </h1>
              <StatusBadge status={entry.status} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-gray-500 dark:text-gray-400">Posting Date</span>
                <p className="font-medium text-gray-900 dark:text-white">
                  {fDate(entry.postingDate)}
                </p>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">Entry Type</span>
                <p className="font-medium text-gray-900 dark:text-white capitalize">
                  {entry.entryType}
                </p>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">Total Debit</span>
                <p className="font-medium text-gray-900 dark:text-white font-mono">
                  {formatCurrency(totalDebit, currency)}
                </p>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">Total Credit</span>
                <p className="font-medium text-gray-900 dark:text-white font-mono">
                  {formatCurrency(totalCredit, currency)}
                </p>
              </div>
            </div>
            {entry.remarks && (
              <div className="mt-3 text-sm">
                <span className="text-gray-500 dark:text-gray-400">Remarks: </span>
                <span className="text-gray-900 dark:text-white">{entry.remarks}</span>
              </div>
            )}
          </div>

        </div>

        {/* Cancellation Info */}
        {entry.status === 'cancelled' && (
          <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded">
            <p className="text-sm font-medium text-red-800 dark:text-red-300">Cancelled</p>
            {entry.cancellationReason && (
              <p className="text-sm text-red-700 dark:text-red-400 mt-1">
                Reason: {entry.cancellationReason}
              </p>
            )}
            {entry.cancelledAt && (
              <p className="text-xs text-red-600 dark:text-red-500 mt-1">
                Cancelled on: {fDateTime(entry.cancelledAt)}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Line Items */}
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
        <div className="px-4 py-3 border-b dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Line Items</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <caption className="sr-only">Journal entry line items</caption>
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                  Account
                </th>
                <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">
                  Debit
                </th>
                <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">
                  Credit
                </th>
                <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                  Party Type
                </th>
                <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                  Remarks
                </th>
              </tr>
            </thead>
            <tbody>
              {(entry.items || []).map((item) => {
                const debit = parseFloat(item.debit || '0')
                const credit = parseFloat(item.credit || '0')
                return (
                  <tr
                    key={item.id}
                    className="border-t border-gray-100 dark:border-gray-700"
                  >
                    <td className="px-4 py-2.5">
                      <div className="text-sm font-medium text-gray-900 dark:text-white">
                        {item.accountName}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                        {item.accountNumber}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums">
                      {debit > 0 ? (
                        <span className="text-gray-900 dark:text-white">{formatCurrency(debit, currency)}</span>
                      ) : (
                        <span className="text-gray-300 dark:text-gray-600">-</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-right font-mono tabular-nums">
                      {credit > 0 ? (
                        <span className="text-gray-900 dark:text-white">{formatCurrency(credit, currency)}</span>
                      ) : (
                        <span className="text-gray-300 dark:text-gray-600">-</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-gray-600 dark:text-gray-400 capitalize">
                      {item.partyType || '-'}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-gray-500 dark:text-gray-400">
                      {item.remarks || '-'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900">
                <td className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-white text-right">
                  Totals
                </td>
                <td className="px-4 py-3 text-sm font-semibold text-right font-mono tabular-nums text-gray-900 dark:text-white">
                  {formatCurrency(totalDebit, currency)}
                </td>
                <td className="px-4 py-3 text-sm font-semibold text-right font-mono tabular-nums text-gray-900 dark:text-white">
                  {formatCurrency(totalCredit, currency)}
                </td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Comments & Activity */}
      <DocumentCommentsAndActivity
        documentType="journal_entry"
        documentId={id}
        entityType="journal-entry"
      />

      {/* Action Bar */}
      <DetailPageActions actions={(() => {
        const a: ActionConfig[] = []
        if (entry.status === 'draft') {
          a.push({
            key: 'delete',
            label: 'Delete',
            icon: <Trash2 size={14} />,
            variant: 'danger',
            position: 'left',
            onClick: handleDelete,
            confirmation: {
              title: 'Delete Journal Entry',
              message: `Are you sure you want to delete "${entry.entryNumber}"? This action cannot be undone.`,
              variant: 'danger',
            },
          })
          a.push({
            key: 'submit',
            label: 'Submit',
            icon: <Send size={14} />,
            variant: 'success',
            onClick: handleSubmit,
            confirmation: {
              title: 'Submit Journal Entry',
              message: `Submit "${entry.entryNumber}"? This will post debit/credit entries to the general ledger.`,
              variant: 'success',
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

      {/* Cancellation Reason Modal */}
      <CancellationReasonModal
        isOpen={showCancelModal}
        onClose={() => setShowCancelModal(false)}
        onConfirm={handleCancel}
        title="Cancel Journal Entry"
        itemName={`Journal Entry ${entry.entryNumber}`}
        processing={cancelling}
        documentType="journal-entry"
      />
    </div>
  )
}
