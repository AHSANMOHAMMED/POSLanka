'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Plus, Trash2, Receipt } from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { NewVehicleSaleModal, vehicleLabel } from './NewVehicleSaleModal'
import { PageLoading } from '@/components/ui/loading-spinner'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { CancellationReasonModal } from '@/components/modals'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { toast } from '@/components/ui/toast'
import { usePaginatedData } from '@/hooks'
import { Pagination } from '@/components/ui/pagination'

/** Row of GET /api/vehicle-sales */
interface VehicleSale {
  id: string
  saleId: string
  saleInvoiceNo: string | null
  saleDate: string | null
  createdAt: string
  customerName: string | null
  vehicleYear: number | null
  vehicleMake: string | null
  vehicleModel: string | null
  vehicleStockNo: string | null
  saleTotal: string | null
  salePaid: string | null
  tradeInAllowance: string | null
  financeAmount: string | null
  financingName: string | null
  salespersonName: string | null
  saleStatus: string | null
  voidReason: string | null
  deliveryDate: string | null
}

const money = (v: string | null) => (v && Number(v) ? Number(v).toLocaleString(undefined, { minimumFractionDigits: 2 }) : '-')

function statusOf(sale: VehicleSale): { label: string; className: string } {
  if (sale.saleStatus === 'void') return { label: 'Cancelled', className: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' }
  if (sale.deliveryDate && sale.deliveryDate <= new Date().toISOString().slice(0, 10)) {
    return { label: 'Delivered', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' }
  }
  return { label: 'Sold', className: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' }
}

export default function VehicleSalesPage() {
  const { tenantSlug } = useCompany()
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [showNew, setShowNew] = useState(false)

  // Modal states
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [showCancellationModal, setShowCancellationModal] = useState(false)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)

  const {
    data: sales,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<VehicleSale>({
    endpoint: '/api/vehicle-sales',
    entityType: 'vehicle-sale',
    storageKey: 'vehicle-sales-page-size',
    additionalParams: {
      ...(statusFilter !== 'all' && { status: statusFilter }),
    },
  })

  async function handleDelete() {
    if (!deleteId) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/vehicle-sales/${deleteId}`, { method: 'DELETE' })
      if (res.ok) {
        refresh()
        toast.success('Vehicle sale deleted (copy kept in recycle bin)')
      } else {
        toast.error((await res.json().catch(() => ({}))).error || 'Failed to delete vehicle sale')
      }
    } catch (error) {
      console.error('Error deleting sale:', error)
      toast.error('Error deleting vehicle sale')
    } finally {
      setDeleting(false)
      setDeleteId(null)
    }
  }

  async function handleCancel(reason: string) {
    if (!cancellingId) return
    setCancelling(true)
    try {
      const res = await fetch(`/api/vehicle-sales/${cancellingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled', cancellationReason: reason }),
      })
      if (res.ok) {
        refresh()
        toast.success('Vehicle sale cancelled; the vehicle is back in stock')
      } else {
        toast.error((await res.json().catch(() => ({}))).error || 'Failed to cancel vehicle sale')
      }
    } catch (error) {
      console.error('Error cancelling sale:', error)
      toast.error('Error cancelling vehicle sale')
    } finally {
      setCancelling(false)
      setCancellingId(null)
      setShowCancellationModal(false)
    }
  }

  if (loading && sales.length === 0) {
    return <PageLoading text="Loading vehicle sales..." />
  }

  const statusTabs = [
    { key: 'all', label: 'All' },
    { key: 'active', label: 'Sold' },
    { key: 'cancelled', label: 'Cancelled' },
  ]

  return (
    <ListPageLayout
      module="Dealership"
      moduleHref="/dealership/inventory"
      title="Vehicle Sales"
      actionContent={
        <button
          onClick={() => setShowNew(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} />
          New Sale
        </button>
      }
      search={search}
      setSearch={setSearch}
      onRefresh={refresh}
      searchPlaceholder="Invoice #, customer, vehicle..."
    >
      {/* Filter Tabs */}
      <div className="px-4 pb-2">
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
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 list-container-xl overflow-x-auto mx-4">
        <table className="w-full">
          <caption className="sr-only">Vehicle sales list</caption>
          <thead className="bg-gray-50 dark:bg-gray-900 table-sticky-header">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Invoice #</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Date</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Customer</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Vehicle</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Total</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Paid</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Trade-In</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Finance Amt</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Salesperson</th>
              <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">Status</th>
              <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-400">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sales.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                  {search ? 'No sales match your search' : 'No vehicle sales yet.'}
                </td>
              </tr>
            ) : (
              sales.map((sale) => {
                const st = statusOf(sale)
                const vehicle = vehicleLabel({ year: sale.vehicleYear, makeName: sale.vehicleMake, modelName: sale.vehicleModel, trim: null })
                return (
                <tr key={sale.id} className="border-t border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Receipt size={14} className="text-gray-400 flex-shrink-0" />
                      {sale.saleId ? (
                        <Link href={`/c/${tenantSlug}/sales/${sale.saleId}`} className="font-medium text-blue-600 dark:text-blue-400 hover:underline">{sale.saleInvoiceNo || 'Invoice'}</Link>
                      ) : <span className="font-medium">{sale.saleInvoiceNo || '-'}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                    {new Date(sale.saleDate || sale.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                    {sale.customerName || 'Walk-in'}
                  </td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                    {vehicle || '-'}{sale.vehicleStockNo && <span className="block text-xs text-gray-500">{sale.vehicleStockNo}</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-white">{money(sale.saleTotal)}</td>
                  <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-400">{money(sale.salePaid)}</td>
                  <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-400">{money(sale.tradeInAllowance)}</td>
                  <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-400">
                    {money(sale.financeAmount)}{sale.financingName && <span className="block text-xs text-gray-500">{sale.financingName}</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{sale.salespersonName || '-'}</td>
                  <td className="px-4 py-3">
                    <span title={sale.voidReason || undefined} className={`px-2 py-0.5 rounded-full text-xs font-medium ${st.className}`}>{st.label}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {sale.saleStatus !== 'void' ? (
                        <button
                          onClick={() => {
                            setCancellingId(sale.id)
                            setShowCancellationModal(true)
                          }}
                          aria-label="Cancel sale"
                          className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded"
                        >
                          Cancel
                        </button>
                      ) : (
                        <button
                          onClick={() => setDeleteId(sale.id)}
                          aria-label={`Delete sale ${sale.saleInvoiceNo ?? ''}`}
                          className="p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                )
              })
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

      {showNew && <NewVehicleSaleModal onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); refresh() }} />}

      {/* Delete Confirm */}
      <ConfirmModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Vehicle Sale"
        message="Delete this cancelled sale record? A copy is kept in the recycle bin for the platform administrator."
        confirmText="Delete"
        variant="danger"
        processing={deleting}
      />

      {/* Cancellation Modal */}
      <CancellationReasonModal
        isOpen={showCancellationModal}
        onClose={() => {
          setShowCancellationModal(false)
          setCancellingId(null)
        }}
        onConfirm={handleCancel}
        title="Cancel Vehicle Sale"
        itemName="this vehicle sale (the invoice is voided and the vehicle goes back into stock)"
        processing={cancelling}
      />
    </ListPageLayout>
  )
}
