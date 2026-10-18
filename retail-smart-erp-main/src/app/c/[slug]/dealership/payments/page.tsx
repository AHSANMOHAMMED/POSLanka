'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Plus, ArrowDownLeft, ArrowUpRight, CreditCard } from 'lucide-react'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { usePaginatedData } from '@/hooks'
import { Pagination } from '@/components/ui/pagination'

interface DealerPayment {
  id: string
  paymentNo: string
  dealerId: string
  dealerName: string | null
  dealerCode: string | null
  type: string
  direction: string
  amount: string
  paymentMethod: string | null
  referenceNo: string | null
  vehicleInventoryId: string | null
  balanceBefore: string | null
  balanceAfter: string | null
  paymentDate: string | null
  dueDate: string | null
  status: string
  cancellationReason: string | null
  notes: string | null
  createdAt: string
}

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  confirmed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
}

const statusLabels: Record<string, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
}

const typeLabels: Record<string, string> = {
  advance: 'Advance',
  settlement: 'Settlement',
  commission: 'Commission',
  refund: 'Refund',
  adjustment: 'Adjustment',
}

const directionLabels: Record<string, string> = {
  inbound: 'Inbound',
  outbound: 'Outbound',
}

const methodLabels: Record<string, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank Transfer',
  cheque: 'Cheque',
  offset: 'Offset',
}

export default function DealerPaymentsPage() {
  const { tenantSlug } = useCompany()
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [directionFilter, setDirectionFilter] = useState<string>('')

  const {
    data: payments,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<DealerPayment>({
    endpoint: '/api/dealer-payments',
    entityType: 'dealer-payment',
    storageKey: 'dealer-payments-page-size',
    additionalParams: {
      ...(statusFilter !== 'all' && { status: statusFilter }),
      ...(typeFilter && { type: typeFilter }),
      ...(directionFilter && { direction: directionFilter }),
    },
  })

  const statusTabs = [
    { key: 'all', label: 'All' },
    { key: 'pending', label: 'Pending' },
    { key: 'confirmed', label: 'Confirmed' },
    { key: 'cancelled', label: 'Cancelled' },
  ]

  function formatCurrency(value: string | null): string {
    if (!value) return '-'
    return parseFloat(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  function formatDate(value: string | null): string {
    if (!value) return '-'
    return new Date(value).toLocaleDateString()
  }

  return (
    <ListPageLayout
      module="Dealership"
      moduleHref="/dealership/inventory"
      title="Dealer Payments"
      actionContent={
        <div className="flex items-center gap-2">
          <Link
            href={`/c/${tenantSlug}/dealership/payments/new`}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
          >
            <Plus size={16} />
            New Payment
          </Link>
        </div>
      }
      search={search}
      setSearch={setSearch}
      onRefresh={refresh}
      searchPlaceholder="Search by payment #, dealer, reference..."
    >
      {/* Filter Tabs + Extra Filters */}
      <div className="px-4 pb-2 space-y-2">
        <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
          {statusTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                setStatusFilter(tab.key)
                setPage(1)
              }}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition whitespace-nowrap ${
                statusFilter === tab.key
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value)
              setPage(1)
            }}
            className="text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">All Types</option>
            <option value="advance">Advance</option>
            <option value="settlement">Settlement</option>
            <option value="commission">Commission</option>
            <option value="refund">Refund</option>
            <option value="adjustment">Adjustment</option>
          </select>
          <select
            value={directionFilter}
            onChange={(e) => {
              setDirectionFilter(e.target.value)
              setPage(1)
            }}
            className="text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">All Directions</option>
            <option value="inbound">Inbound (Dealer to Company)</option>
            <option value="outbound">Outbound (Company to Dealer)</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 list-container-xl overflow-x-auto mx-4">
        <table className="w-full">
          <caption className="sr-only">Dealer payments list</caption>
          <thead className="bg-gray-50 dark:bg-gray-900 table-sticky-header">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Payment No</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Dealer</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Type</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Direction</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Amount</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Method</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Status</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Date</th>
            </tr>
          </thead>
          <tbody>
            {payments.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                  {loading ? 'Loading...' : search ? 'No payments match your search' : 'No dealer payments yet. Record your first payment!'}
                </td>
              </tr>
            ) : (
              payments.map((payment) => (
                <tr
                  key={payment.id}
                  className="border-t border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                >
                  <td className="px-4 py-3 font-medium text-blue-600 dark:text-blue-400">
                    <Link href={`/c/${tenantSlug}/dealership/payments/${payment.id}`}>
                      {payment.paymentNo}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900 dark:text-white">{payment.dealerName || '-'}</div>
                    {payment.dealerCode && (
                      <div className="text-xs text-gray-500 dark:text-gray-400">{payment.dealerCode}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 text-sm text-gray-700 dark:text-gray-300">
                      <CreditCard size={14} className="text-gray-400" />
                      {typeLabels[payment.type] || payment.type}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 text-sm ${
                      payment.direction === 'inbound'
                        ? 'text-green-700 dark:text-green-400'
                        : 'text-orange-700 dark:text-orange-400'
                    }`}>
                      {payment.direction === 'inbound' ? (
                        <ArrowDownLeft size={14} />
                      ) : (
                        <ArrowUpRight size={14} />
                      )}
                      {directionLabels[payment.direction] || payment.direction}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm font-medium text-gray-900 dark:text-white">
                    {formatCurrency(payment.amount)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                    {methodLabels[payment.paymentMethod || ''] || payment.paymentMethod || '-'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[payment.status] || 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'}`}>
                      {statusLabels[payment.status] || payment.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                    {formatDate(payment.paymentDate || payment.createdAt)}
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
          className="border-t border-gray-200 dark:border-gray-700 px-4 pagination-sticky"
        />
      </div>
    </ListPageLayout>
  )
}
