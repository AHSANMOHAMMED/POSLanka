'use client'

import { useState, useCallback, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { Plus, Loader2, Trash2, CheckCircle } from 'lucide-react'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { usePaginatedData, useCurrency } from '@/hooks'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'
import { Pagination, StatusBadge, ConfirmDialog } from '@/components/ui'
import { formatCurrency } from '@/lib/utils/currency'

interface FiscalYear {
  id: string
  name: string
  startDate: string
  endDate: string
  isClosed: boolean
}

interface Account {
  id: string
  accountNumber: string
  accountName: string
  rootType: string
  isGroup: boolean
}

interface PeriodClosingVoucher {
  id: string
  fiscalYearId: string
  fiscalYearName: string
  closingDate: string
  closingAccountId: string
  closingAccountName: string
  netProfitLoss: number
  status: 'draft' | 'submitted'
  createdAt: string
}

const emptyForm = {
  fiscalYearId: '',
  closingDate: '',
  closingAccountId: '',
}

export default function PeriodClosingPage() {
  const params = useParams()
  const _slug = params.slug as string
  const { currency } = useCurrency()

  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([])
  const [equityAccounts, setEquityAccounts] = useState<Account[]>([])
  const [loadingDropdowns, setLoadingDropdowns] = useState(false)

  // Confirm dialog state
  const [confirmAction, setConfirmAction] = useState<{ type: 'submit' | 'delete'; id: string } | null>(null)
  const [processing, setProcessing] = useState(false)

  const {
    data: vouchers,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<PeriodClosingVoucher>({
    endpoint: '/api/accounting/period-closing',
    entityType: 'period-closing',
    storageKey: 'period-closing-page-size',
  })

  const fetchDropdowns = useCallback(async () => {
    setLoadingDropdowns(true)
    try {
      const [fyRes, accRes] = await Promise.all([
        fetch('/api/accounting/fiscal-years?all=true'),
        fetch('/api/accounting/accounts?all=true'),
      ])

      if (fyRes.ok) {
        const fyData = await fyRes.json()
        const allFy = Array.isArray(fyData) ? fyData : fyData.data || []
        setFiscalYears(allFy.filter((fy: FiscalYear) => !fy.isClosed))
      }

      if (accRes.ok) {
        const accData = await accRes.json()
        const allAcc = Array.isArray(accData) ? accData : accData.data || []
        setEquityAccounts(allAcc.filter((a: Account) => a.rootType === 'equity' && !a.isGroup))
      }
    } catch {
      toast.error('Failed to load dropdown data')
    } finally {
      setLoadingDropdowns(false)
    }
  }, [])

  useEffect(() => {
    if (showModal) {
      fetchDropdowns()
    }
  }, [showModal, fetchDropdowns])

  function handleAdd() {
    setForm(emptyForm)
    setShowModal(true)
  }

  function handleCloseModal() {
    setShowModal(false)
    setForm(emptyForm)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!form.fiscalYearId || !form.closingDate || !form.closingAccountId) {
      toast.error('All fields are required')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/accounting/period-closing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fiscalYearId: form.fiscalYearId,
          closingDate: form.closingDate,
          closingAccountId: form.closingAccountId,
        }),
      })

      if (res.ok) {
        toast.success('Period closing voucher created')
        handleCloseModal()
        refresh()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to create period closing voucher')
      }
    } catch {
      toast.error('Error creating period closing voucher')
    } finally {
      setSaving(false)
    }
  }

  async function handleSubmit(id: string) {
    setProcessing(true)
    try {
      const res = await fetch(`/api/accounting/period-closing/${id}/submit`, {
        method: 'POST',
      })

      if (res.ok) {
        toast.success('Period closing voucher submitted successfully')
        refresh()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to submit voucher')
      }
    } catch {
      toast.error('Error submitting voucher')
    } finally {
      setProcessing(false)
      setConfirmAction(null)
    }
  }

  async function handleDelete(id: string) {
    setProcessing(true)
    try {
      const res = await fetch(`/api/accounting/period-closing/${id}`, {
        method: 'DELETE',
      })

      if (res.ok) {
        toast.success('Period closing voucher deleted')
        refresh()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to delete voucher')
      }
    } catch {
      toast.error('Error deleting voucher')
    } finally {
      setProcessing(false)
      setConfirmAction(null)
    }
  }

  if (loading && vouchers.length === 0) {
    return <PageLoading text="Loading period closing vouchers..." />
  }

  const inputClass =
    'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500'

  return (
    <ListPageLayout
      module="Accounting"
      moduleHref="/accounting"
      title="Period Closing"
      search={search}
      setSearch={setSearch}
      onRefresh={refresh}
      searchPlaceholder="Search period closing vouchers..."
      actionContent={
        <button
          onClick={handleAdd}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} />
          New Period Closing
        </button>
      }
    >
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 list-container-xl overflow-x-auto">
        <table className="w-full">
          <caption className="sr-only">List of period closing vouchers</caption>
          <thead className="bg-gray-50 dark:bg-gray-900 table-sticky-header">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                Fiscal Year
              </th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                Closing Date
              </th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                Closing Account
              </th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">
                Net P&amp;L
              </th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                Status
              </th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {vouchers.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-gray-500 dark:text-gray-400">
                  {search ? 'No period closing vouchers match your search' : 'No period closing vouchers yet. Create your first one.'}
                </td>
              </tr>
            ) : (
              vouchers.map((v) => (
                <tr key={v.id} className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-4 py-3">
                    <span className="font-medium text-gray-900 dark:text-white">{v.fiscalYearName}</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                    {new Date(v.closingDate).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                    {v.closingAccountName}
                  </td>
                  <td className="px-4 py-3 text-sm text-right font-mono tabular-nums">
                    <span className={v.netProfitLoss >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                      {formatCurrency(Math.abs(v.netProfitLoss), currency)}
                      {v.netProfitLoss < 0 && ' (Loss)'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={v.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {v.status === 'draft' && (
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setConfirmAction({ type: 'submit', id: v.id })}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors"
                        >
                          <CheckCircle size={12} />
                          Submit
                        </button>
                        <button
                          onClick={() => setConfirmAction({ type: 'delete', id: v.id })}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
                        >
                          <Trash2 size={12} />
                          Delete
                        </button>
                      </div>
                    )}
                    {v.status === 'submitted' && (
                      <span className="text-xs text-gray-400 dark:text-gray-500">Read-only</span>
                    )}
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
          className="border-t dark:border-gray-700 px-4"
        />
      </div>

      {/* New Period Closing Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              New Period Closing
            </h2>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Fiscal Year *
                </label>
                {loadingDropdowns ? (
                  <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-2">
                    <Loader2 size={14} className="animate-spin" />
                    Loading...
                  </div>
                ) : (
                  <select
                    value={form.fiscalYearId}
                    onChange={(e) => setForm({ ...form, fiscalYearId: e.target.value })}
                    className={inputClass}
                    required
                  >
                    <option value="">Select fiscal year</option>
                    {fiscalYears.map((fy) => (
                      <option key={fy.id} value={fy.id}>
                        {fy.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Closing Date *
                </label>
                <input
                  type="date"
                  value={form.closingDate}
                  onChange={(e) => setForm({ ...form, closingDate: e.target.value })}
                  className={inputClass}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Closing Account (Equity) *
                </label>
                {loadingDropdowns ? (
                  <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-2">
                    <Loader2 size={14} className="animate-spin" />
                    Loading...
                  </div>
                ) : (
                  <select
                    value={form.closingAccountId}
                    onChange={(e) => setForm({ ...form, closingAccountId: e.target.value })}
                    className={inputClass}
                    required
                  >
                    <option value="">Select equity account</option>
                    {equityAccounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.accountNumber} - {acc.accountName}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || loadingDropdowns}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {saving && <Loader2 size={14} className="animate-spin" />}
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Submit Confirmation Dialog */}
      <ConfirmDialog
        isOpen={confirmAction?.type === 'submit'}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => confirmAction && handleSubmit(confirmAction.id)}
        title="Submit Period Closing"
        message="Are you sure you want to submit this period closing voucher? This will post the closing entries to the general ledger and cannot be undone."
        confirmText="Submit"
        variant="warning"
        processing={processing}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={confirmAction?.type === 'delete'}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => confirmAction && handleDelete(confirmAction.id)}
        title="Delete Period Closing"
        message="Are you sure you want to delete this draft period closing voucher? This action cannot be undone."
        confirmText="Delete"
        variant="danger"
        processing={processing}
      />
    </ListPageLayout>
  )
}
