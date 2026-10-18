'use client'

import { useState } from 'react'
import { useRouter, useSearchParams, useParams } from 'next/navigation'
import { Car, Download, X } from 'lucide-react'
import { usePaginatedData } from '@/hooks'
import { ExportDialog } from '@/components/import-export/ExportDialog'
import { useExport } from '@/hooks/useExport'
import { PageLoading } from '@/components/ui/loading-spinner'
import { Pagination } from '@/components/ui/pagination'
import { ListPageLayout } from '@/components/layout/ListPageLayout'

interface Customer {
  id: string
  name: string
  phone: string | null
}

interface Vehicle {
  id: string
  make: string
  model: string
  year: number | null
  licensePlate: string | null
  customerId: string | null
}

interface User {
  id: string
  fullName: string
}

interface WorkOrder {
  id: string
  orderNo: string
  status: 'draft' | 'confirmed' | 'in_progress' | 'completed' | 'invoiced' | 'cancelled'
  priority: string
  subtotal: string
  total: string
  createdAt: string
  customerId: string | null
  vehicleId: string | null
  customer: Customer | null
  vehicle: Vehicle | null
  assignedUser: User | null
  cancellationReason: string | null
  paymentStatus: 'paid' | 'partial' | 'unpaid' | 'void' | null
  invoiceNo: string | null
}

// Simplified workflow statuses
const statusColors: Record<string, string> = {
  draft: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  invoiced: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
}

const statusLabels: Record<string, string> = {
  draft: 'Draft',
  invoiced: 'Invoiced',
  cancelled: 'Cancelled',
}

const paymentStatusColors: Record<string, string> = {
  paid: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  partial: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  unpaid: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  void: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
}

const paymentStatusLabels: Record<string, string> = {
  paid: 'Paid',
  partial: 'Partial',
  unpaid: 'Unpaid',
  void: 'Void',
}

export default function WorkOrdersPage() {
  const router = useRouter()
  const params = useParams()
  const { showExportDialog, openExport, closeExport } = useExport()
  const slug = params.slug as string
  const searchParams = useSearchParams()
  const urlStatus = searchParams.get('status')

  const [statusFilter, setStatusFilter] = useState(urlStatus || '')

  // Navigate to detail page
  function handleRowClick(workOrderId: string) {
    router.push(`/c/${slug}/work-orders/${workOrderId}`)
  }

  // Paginated work orders data with server-side filtering
  const {
    data: workOrders,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<WorkOrder>({
    endpoint: '/api/work-orders',
    entityType: 'work-order',
    storageKey: 'work-orders-page-size',
    additionalParams: statusFilter ? { status: statusFilter } : {},
  })

  if (loading && workOrders.length === 0) {
    return <PageLoading text="Loading work orders..." />
  }

  return (
    <>
    <ListPageLayout
      module="Auto Service"
      moduleHref="/auto-service"
      title="Work Order"
      actionContent={
        <div className="flex items-center gap-2">
          <button
            onClick={openExport}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <Download size={14} />
            Export
          </button>
          <button
            onClick={() => router.push(`/c/${slug}/work-orders/new`)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
          >
            New Work Order
          </button>
        </div>
      }
      search={search}
      setSearch={setSearch}
      onRefresh={refresh}
      searchPlaceholder="Search work orders..."
      filterContent={
        <>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          >
            <option value="">All Statuses</option>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          {statusFilter && (
            <button onClick={() => setStatusFilter('')} className="text-xs text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 px-2 py-1.5">
              <X size={14} />
            </button>
          )}
        </>
      }
    >
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 overflow-x-auto">
        <table className="w-full">
          <caption className="sr-only">List of work orders</caption>
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Order No</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Status</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Customer</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Vehicle</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-300">Total</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Payment</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Created</th>
            </tr>
          </thead>
          <tbody>
            {workOrders.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                  {search || statusFilter ? 'No work orders match your filters' : 'No work orders yet. Create your first work order!'}
                </td>
              </tr>
            ) : (
              workOrders.map((wo) => (
                <tr
                  key={wo.id}
                  onClick={() => handleRowClick(wo.id)}
                  className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                >
                  <td className="px-4 py-3">
                    <span className="font-medium text-blue-600 dark:text-blue-400">
                      {wo.orderNo}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${statusColors[wo.status]}`}>
                      {statusLabels[wo.status]}
                    </span>
                    {wo.status === 'cancelled' && wo.cancellationReason && (
                      <p className="text-xs text-red-600 dark:text-red-400 mt-1" title={wo.cancellationReason}>
                        {wo.cancellationReason.length > 30 ? `${wo.cancellationReason.slice(0, 30)}...` : wo.cancellationReason}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                    {wo.customer?.name || '-'}
                  </td>
                  <td className="px-4 py-3">
                    {wo.vehicle ? (
                      <div className="flex items-center gap-2">
                        <Car size={16} className="text-gray-400" />
                        <span className="text-gray-600 dark:text-gray-300">
                          {wo.vehicle.licensePlate && <span className="font-medium">[{wo.vehicle.licensePlate}]</span>}{' '}
                          {wo.vehicle.year ? `${wo.vehicle.year} ` : ''}{wo.vehicle.make} {wo.vehicle.model}
                        </span>
                      </div>
                    ) : '-'}
                  </td>
                  <td className="px-4 py-3 text-right font-medium dark:text-white">
                    {parseFloat(wo.total).toFixed(2)}
                  </td>
                  <td className="px-4 py-3">
                    {wo.paymentStatus ? (
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${paymentStatusColors[wo.paymentStatus]}`}>
                        {paymentStatusLabels[wo.paymentStatus]}
                      </span>
                    ) : (
                      <span className="text-gray-400 text-xs">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-sm">
                    {new Date(wo.createdAt).toLocaleDateString()}{' '}
                    {new Date(wo.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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
    </ListPageLayout>

    <ExportDialog
      isOpen={showExportDialog}
      onClose={closeExport}
      entity="work-orders"
      currentFilters={{ search, status: statusFilter }}
    />
    </>
  )
}
