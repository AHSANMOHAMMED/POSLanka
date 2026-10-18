'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Eye, Warehouse, ArrowRight, X } from 'lucide-react'
import { usePaginatedData, useTerminology } from '@/hooks'
import { Pagination } from '@/components/ui/pagination'
import { PageLoading } from '@/components/ui/loading-spinner'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { PermissionGuard } from '@/components/auth/PermissionGuard'

interface StockTransfer {
  id: string
  transferNo: string
  status: 'draft' | 'pending_approval' | 'approved' | 'in_transit' | 'completed' | 'cancelled'
  fromWarehouse: { id: string; name: string; code: string }
  toWarehouse: { id: string; name: string; code: string }
  requestedBy: { id: string; fullName: string } | null
  approvedBy: { id: string; fullName: string } | null
  notes: string | null
  createdAt: string
  approvedAt: string | null
  shippedAt: string | null
  receivedAt: string | null
  _itemCount?: number
}

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  pending_approval: 'bg-amber-100 text-amber-700',
  approved: 'bg-blue-100 text-blue-700',
  in_transit: 'bg-purple-100 text-purple-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
}

const statusLabels: Record<string, string> = {
  draft: 'Draft',
  pending_approval: 'Pending Approval',
  approved: 'Approved',
  in_transit: 'In Transit',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

const statusOptions: [string, string][] = [
  ['draft', 'Draft'],
  ['pending_approval', 'Pending Approval'],
  ['approved', 'Approved'],
  ['in_transit', 'In Transit'],
  ['completed', 'Completed'],
  ['cancelled', 'Cancelled'],
]

export default function StockTransfersPage() {
  const t = useTerminology()
  const { tenantSlug } = useCompany()
  const router = useRouter()
  const [statusFilter, setStatusFilter] = useState<string>('')

  const {
    data: transfers,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<StockTransfer>({
    endpoint: '/api/stock-transfers',
    entityType: 'stock-transfer',
    storageKey: 'stock-transfers-page-size',
    additionalParams: statusFilter ? { status: statusFilter } : undefined,
  })

  function formatDate(dateString: string | null) {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  if (loading && transfers.length === 0) {
    return <PageLoading text="Loading transfers..." />
  }

  return (
    <PermissionGuard permission="manageInventory">
    <ListPageLayout
      module={t.stockModule}
      moduleHref="/stock"
      title="Stock Transfer"
      actionButton={{ label: "New Transfer", onClick: () => router.push(`/c/${tenantSlug}/stock-transfers/new`) }}
      search={search}
      setSearch={setSearch}
      onRefresh={refresh}
      searchPlaceholder="Search by transfer number..."
      filterContent={
        <>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          >
            <option value="">All Statuses</option>
            {statusOptions.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          {statusFilter && (
            <button onClick={() => { setStatusFilter(''); setPage(1) }} className="text-xs text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 px-2 py-1.5">
              <X size={14} />
            </button>
          )}
        </>
      }
    >
      {/* Table */}
      <div className="bg-white rounded border overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Transfer #</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">From / To</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Status</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Requested By</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Date</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {transfers.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  {search || statusFilter ? 'No transfers match your filters' : 'No transfers yet. Create your first transfer!'}
                </td>
              </tr>
            ) : (
              transfers.map((transfer) => (
                <tr key={transfer.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/c/${tenantSlug}/stock-transfers/${transfer.id}`}
                      className="font-medium text-blue-600 hover:underline"
                    >
                      {transfer.transferNo}
                    </Link>
                    {transfer._itemCount !== undefined && (
                      <span className="text-xs text-gray-500 ml-2">
                        ({transfer._itemCount} items)
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="flex items-center gap-1">
                        <Warehouse size={14} className="text-gray-400" />
                        {transfer.fromWarehouse?.code || '-'}
                      </span>
                      <ArrowRight size={14} className="text-gray-400" />
                      <span className="flex items-center gap-1">
                        <Warehouse size={14} className="text-gray-400" />
                        {transfer.toWarehouse?.code || '-'}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${statusColors[transfer.status]}`}>
                      {statusLabels[transfer.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {transfer.requestedBy?.fullName || '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {formatDate(transfer.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/c/${tenantSlug}/stock-transfers/${transfer.id}`}
                      className="p-1.5 text-gray-500 hover:bg-gray-100 rounded inline-flex"
                      title="View Details"
                    >
                      <Eye size={18} />
                    </Link>
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
          className="border-t px-4"
        />
      </div>
    </ListPageLayout>
    </PermissionGuard>
  )
}
