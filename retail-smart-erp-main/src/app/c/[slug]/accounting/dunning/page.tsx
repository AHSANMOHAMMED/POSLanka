'use client'

import { useState, useEffect } from 'react'
import {
  Plus,
  Loader2,
  AlertTriangle,
  Send,
  CheckCircle,
} from 'lucide-react'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { usePaginatedData, useCurrency } from '@/hooks'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'
import { Pagination, StatusBadge } from '@/components/ui'
import { formatCurrency } from '@/lib/utils/currency'
import { format } from 'date-fns'

interface Dunning {
  id: string
  dunningNumber: string
  dunningTypeId: string
  customerId: string
  saleId: string
  outstandingAmount: string
  dunningFee: string
  dunningInterest: string
  grandTotal: string
  status: 'draft' | 'unresolved' | 'resolved' | 'cancelled'
  sentAt: string | null
  createdAt: string
  dunningTypeName: string | null
  customerName: string | null
}

interface DunningType {
  id: string
  name: string
  startDay: number
  endDay: number
}

interface Customer {
  id: string
  name: string
}

const inputClass =
  'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500'
const selectClass =
  'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white'

export default function DunningPage() {
  const { currency } = useCurrency()
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ dunningTypeId: '', customerId: '', saleId: '' })
  const [saving, setSaving] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [dunningTypes, setDunningTypes] = useState<DunningType[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])

  const {
    data: dunnings,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<Dunning>({
    endpoint: '/api/accounting/dunnings',
    entityType: 'dunning',
    storageKey: 'dunnings-page-size',
    additionalParams: statusFilter ? { status: statusFilter } : {},
  })

  useEffect(() => {
    Promise.all([
      fetch('/api/accounting/dunning-types?all=true').then((r) => r.json()),
      fetch('/api/customers?all=true').then((r) => r.json()),
    ]).then(([dt, c]) => {
      setDunningTypes(Array.isArray(dt) ? dt : dt.data || [])
      setCustomers(Array.isArray(c) ? c : c.data || [])
    }).catch(() => {})
  }, [])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!form.dunningTypeId || !form.customerId || !form.saleId) {
      toast.error('All fields are required')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/accounting/dunnings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })

      if (res.ok) {
        toast.success('Dunning notice created')
        setShowModal(false)
        setForm({ dunningTypeId: '', customerId: '', saleId: '' })
        refresh()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to create')
      }
    } catch {
      toast.error('Error creating dunning')
    } finally {
      setSaving(false)
    }
  }

  async function updateStatus(id: string, status: string) {
    try {
      const res = await fetch(`/api/accounting/dunnings/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (res.ok) {
        toast.success(`Dunning ${status === 'unresolved' ? 'sent' : 'resolved'}`)
        refresh()
      }
    } catch {
      toast.error('Failed to update')
    }
  }

  if (loading && dunnings.length === 0) {
    return <PageLoading text="Loading dunnings..." />
  }

  return (
    <ListPageLayout
      module="Accounting"
      moduleHref="/accounting"
      title="Dunning"
      search={search}
      setSearch={setSearch}
      onRefresh={refresh}
      searchPlaceholder="Search dunnings..."
      actionContent={
        <button
          onClick={() => { setForm({ dunningTypeId: '', customerId: '', saleId: '' }); setShowModal(true) }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} />
          New Dunning
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
          <option value="unresolved">Unresolved</option>
          <option value="resolved">Resolved</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 list-container-xl overflow-x-auto">
        <table className="w-full">
          <caption className="sr-only">Dunning Notices</caption>
          <thead className="bg-gray-50 dark:bg-gray-900 table-sticky-header">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Dunning #</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Type</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Customer</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Outstanding</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Total (with fees)</th>
              <th scope="col" className="px-4 py-3 text-center text-sm font-medium text-gray-600 dark:text-gray-400">Status</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Date</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {dunnings.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-gray-500 dark:text-gray-400">
                  <div className="flex flex-col items-center gap-2">
                    <AlertTriangle size={32} className="text-gray-300 dark:text-gray-600" />
                    <p>No dunning notices found.</p>
                  </div>
                </td>
              </tr>
            ) : (
              dunnings.map((d) => (
                <tr key={d.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                  <td className="px-4 py-3 font-medium text-blue-600 dark:text-blue-400 text-sm">{d.dunningNumber}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{d.dunningTypeName || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">{d.customerName || '-'}</td>
                  <td className="px-4 py-3 text-sm text-right text-gray-600 dark:text-gray-400">{formatCurrency(Number(d.outstandingAmount), currency)}</td>
                  <td className="px-4 py-3 text-sm text-right font-medium text-gray-900 dark:text-white">{formatCurrency(Number(d.grandTotal), currency)}</td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge status={d.status} size="sm" />
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                    {format(new Date(d.createdAt), 'MMM dd, yyyy')}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {d.status === 'draft' && (
                        <button
                          onClick={() => updateStatus(d.id, 'unresolved')}
                          className="p-1 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                          title="Send / Mark as Sent"
                        >
                          <Send size={16} />
                        </button>
                      )}
                      {d.status === 'unresolved' && (
                        <button
                          onClick={() => updateStatus(d.id, 'resolved')}
                          className="p-1 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded transition-colors"
                          title="Mark as Resolved"
                        >
                          <CheckCircle size={16} />
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
          <div className="bg-white dark:bg-gray-800 rounded shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">New Dunning Notice</h2>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Dunning Type *</label>
                <select value={form.dunningTypeId} onChange={(e) => setForm({ ...form, dunningTypeId: e.target.value })} className={selectClass} required>
                  <option value="">Select type</option>
                  {dunningTypes.map((dt) => (<option key={dt.id} value={dt.id}>{dt.name} (Day {dt.startDay}-{dt.endDay})</option>))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Customer *</label>
                <select value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })} className={selectClass} required>
                  <option value="">Select customer</option>
                  {customers.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Sale Invoice ID *</label>
                <input type="text" value={form.saleId} onChange={(e) => setForm({ ...form, saleId: e.target.value })} className={inputClass} placeholder="Sale ID (UUID)" required />
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
