'use client'

import { useState } from 'react'
import {
  Plus,
  Loader2,
  Mail,
  Send,
} from 'lucide-react'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { usePaginatedData, useCurrency } from '@/hooks'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'
import { Pagination, StatusBadge } from '@/components/ui'
import { formatCurrency } from '@/lib/utils/currency'
import { format } from 'date-fns'

interface PaymentRequest {
  id: string
  requestNumber: string
  requestType: 'inward' | 'outward'
  referenceType: string
  referenceId: string
  partyType: string | null
  partyId: string | null
  amount: string
  currency: string
  emailTo: string | null
  status: 'draft' | 'requested' | 'paid' | 'cancelled'
  paidAt: string | null
  createdAt: string
}

const emptyForm = {
  requestType: 'inward' as 'inward' | 'outward',
  referenceType: 'sale',
  referenceId: '',
  partyType: 'customer',
  partyId: '',
  amount: '',
  currency: 'LKR',
  emailTo: '',
  subject: '',
  message: '',
}

const inputClass =
  'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500'
const selectClass =
  'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white'

export default function PaymentRequestsPage() {
  const { currency } = useCurrency()
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')

  const {
    data: requests,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<PaymentRequest>({
    endpoint: '/api/accounting/payment-requests',
    entityType: 'payment-request',
    storageKey: 'payment-requests-page-size',
    additionalParams: statusFilter ? { status: statusFilter } : {},
  })

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!form.amount || !form.referenceId) {
      toast.error('Amount and reference are required')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/accounting/payment-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          amount: parseFloat(form.amount),
        }),
      })

      if (res.ok) {
        toast.success('Payment request created')
        setShowModal(false)
        setForm(emptyForm)
        refresh()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to create')
      }
    } catch {
      toast.error('Error creating payment request')
    } finally {
      setSaving(false)
    }
  }

  async function markAsSent(id: string) {
    try {
      const res = await fetch(`/api/accounting/payment-requests/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'requested' }),
      })
      if (res.ok) {
        toast.success('Marked as sent')
        refresh()
      }
    } catch {
      toast.error('Failed to update')
    }
  }

  async function markAsPaid(id: string) {
    try {
      const res = await fetch(`/api/accounting/payment-requests/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'paid' }),
      })
      if (res.ok) {
        toast.success('Marked as paid')
        refresh()
      }
    } catch {
      toast.error('Failed to update')
    }
  }

  if (loading && requests.length === 0) {
    return <PageLoading text="Loading payment requests..." />
  }

  return (
    <ListPageLayout
      module="Accounting"
      moduleHref="/accounting"
      title="Payment Requests"
      search={search}
      setSearch={setSearch}
      onRefresh={refresh}
      searchPlaceholder="Search requests..."
      actionContent={
        <button
          onClick={() => { setForm(emptyForm); setShowModal(true) }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} />
          New Request
        </button>
      }
    >
      {/* Filters */}
      <div className="flex items-center gap-3 px-4 py-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
          className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
        >
          <option value="">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="requested">Requested</option>
          <option value="paid">Paid</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 list-container-xl overflow-x-auto">
        <table className="w-full">
          <caption className="sr-only">Payment Requests</caption>
          <thead className="bg-gray-50 dark:bg-gray-900 table-sticky-header">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Request #</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Type</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Email To</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Amount</th>
              <th scope="col" className="px-4 py-3 text-center text-sm font-medium text-gray-600 dark:text-gray-400">Status</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Date</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {requests.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-gray-500 dark:text-gray-400">
                  <div className="flex flex-col items-center gap-2">
                    <Mail size={32} className="text-gray-300 dark:text-gray-600" />
                    <p>No payment requests found.</p>
                  </div>
                </td>
              </tr>
            ) : (
              requests.map((req) => (
                <tr key={req.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                  <td className="px-4 py-3 font-medium text-blue-600 dark:text-blue-400 text-sm">{req.requestNumber}</td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      req.requestType === 'inward' ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
                    }`}>
                      {req.requestType === 'inward' ? 'Inward' : 'Outward'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{req.emailTo || '-'}</td>
                  <td className="px-4 py-3 text-sm text-right font-medium text-gray-900 dark:text-white">
                    {req.currency} {formatCurrency(Number(req.amount), currency)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge status={req.status} size="sm" />
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                    {format(new Date(req.createdAt), 'MMM dd, yyyy')}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {req.status === 'draft' && (
                        <button
                          onClick={() => markAsSent(req.id)}
                          className="p-1 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                          title="Mark as Sent"
                        >
                          <Send size={16} />
                        </button>
                      )}
                      {req.status === 'requested' && (
                        <button
                          onClick={() => markAsPaid(req.id)}
                          className="p-1 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded transition-colors"
                          title="Mark as Paid"
                        >
                          <Mail size={16} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <Pagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          totalPages={pagination.totalPages}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          className="border-t dark:border-gray-700 px-4 pagination-sticky"
        />
      </div>

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">New Payment Request</h2>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Request Type *</label>
                <select value={form.requestType} onChange={(e) => setForm({ ...form, requestType: e.target.value as 'inward' | 'outward' })} className={selectClass}>
                  <option value="inward">Inward (Request payment)</option>
                  <option value="outward">Outward (Request to pay)</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Reference Type</label>
                  <select value={form.referenceType} onChange={(e) => setForm({ ...form, referenceType: e.target.value })} className={selectClass}>
                    <option value="sale">Sale</option>
                    <option value="purchase">Purchase</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Reference ID *</label>
                  <input type="text" value={form.referenceId} onChange={(e) => setForm({ ...form, referenceId: e.target.value })} className={inputClass} placeholder="Invoice ID" required />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Amount *</label>
                  <input type="number" step="0.01" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={inputClass} required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Currency</label>
                  <input type="text" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className={inputClass} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email To</label>
                <input type="email" value={form.emailTo} onChange={(e) => setForm({ ...form, emailTo: e.target.value })} className={inputClass} placeholder="customer@example.com" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Subject</label>
                <input type="text" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Message</label>
                <textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} className={inputClass} rows={3} />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">Cancel</button>
                <button type="submit" disabled={saving} className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors">
                  {saving && <Loader2 size={14} className="animate-spin" />}
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </ListPageLayout>
  )
}
