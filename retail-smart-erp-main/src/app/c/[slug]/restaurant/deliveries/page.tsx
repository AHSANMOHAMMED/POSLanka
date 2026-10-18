'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { Truck, MapPin, Phone, X } from 'lucide-react'
import { usePaginatedData } from '@/hooks'
import { PageLoading } from '@/components/ui/loading-spinner'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { Pagination } from '@/components/ui/pagination'
import { DeliveryStatusTracker } from '@/components/restaurant/DeliveryStatusTracker'
import { Modal } from '@/components/ui/modal'

import { toast } from '@/components/ui/toast'

interface DeliveryOrder {
  id: string
  orderNo: string
  deliveryAddress: string | null
  deliveryPhone: string | null
  deliveryNotes: string | null
  driverName: string | null
  driverPhone: string | null
  estimatedDeliveryTime: string | null
  actualDeliveryTime: string | null
  deliveryStatus: string
  deliveryFee: string | null
  total: string
  status: string
  customer: { name: string; phone: string | null } | null
  createdAt: string
}

const deliveryStatusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  dispatched: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  in_transit: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  delivered: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
}

const deliveryStatusLabels: Record<string, string> = {
  pending: 'Pending',
  dispatched: 'Dispatched',
  in_transit: 'In Transit',
  delivered: 'Delivered',
  failed: 'Failed',
}

export default function DeliveriesPage() {
  const params = useParams()
  const _slug = params.slug as string

  const [selectedOrder, setSelectedOrder] = useState<DeliveryOrder | null>(null)
  const [showDispatchModal, setShowDispatchModal] = useState(false)
  const [dispatchForm, setDispatchForm] = useState({
    driverName: '',
    driverPhone: '',
    estimatedDeliveryTime: '',
  })
  const [updating, setUpdating] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')

  const {
    data: orders,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<DeliveryOrder>({
    endpoint: '/api/restaurant-orders',
    entityType: ['restaurant-order'],
    storageKey: 'deliveries-page-size',
    additionalParams: {
      orderType: 'delivery',
      ...(statusFilter && { deliveryStatus: statusFilter }),
    },
  })

  async function updateDeliveryStatus(orderId: string, newStatus: string, extraData?: Record<string, string>) {
    setUpdating(true)
    try {
      const body: Record<string, string> = { deliveryStatus: newStatus, ...extraData }
      const res = await fetch(`/api/restaurant-orders/${orderId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to update')
      }
      toast.success(`Delivery status updated to ${deliveryStatusLabels[newStatus]}`)
      refresh()
      setSelectedOrder(null)
      setShowDispatchModal(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update')
    } finally {
      setUpdating(false)
    }
  }

  function handleDispatch(order: DeliveryOrder) {
    setSelectedOrder(order)
    setDispatchForm({
      driverName: order.driverName || '',
      driverPhone: order.driverPhone || '',
      estimatedDeliveryTime: '',
    })
    setShowDispatchModal(true)
  }

  if (loading && orders.length === 0) {
    return <PageLoading text="Loading deliveries..." />
  }

  return (
    <>
      <ListPageLayout
        module="Restaurant"
        moduleHref="/restaurant"
        title="Deliveries"
        search={search}
        setSearch={setSearch}
        onRefresh={refresh}
        searchPlaceholder="Search orders..."
        filterContent={
          <>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
            >
              <option value="">All Statuses</option>
              {Object.entries(deliveryStatusLabels).map(([value, label]) => (
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
        <div className="space-y-3">
          {orders.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 border rounded p-12 text-center">
              <Truck size={48} className="mx-auto text-gray-300 mb-4" />
              <h3 className="text-lg font-medium text-gray-500">No delivery orders</h3>
              <p className="text-sm text-gray-400 mt-1">Delivery orders will appear here</p>
            </div>
          ) : (
            orders.map(order => (
              <div key={order.id} className="bg-white dark:bg-gray-800 border rounded p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900 dark:text-white">#{order.orderNo}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${deliveryStatusColors[order.deliveryStatus] || deliveryStatusColors.pending}`}>
                        {deliveryStatusLabels[order.deliveryStatus] || 'Pending'}
                      </span>
                    </div>
                    {order.customer && (
                      <p className="text-sm text-gray-500 mt-1">{order.customer.name}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-gray-900 dark:text-white">
                      {parseFloat(order.total).toFixed(2)}
                    </div>
                    <div className="text-xs text-gray-400">
                      {new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>

                {order.deliveryAddress && (
                  <div className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400 mb-2">
                    <MapPin size={14} className="mt-0.5 shrink-0" />
                    <span>{order.deliveryAddress}</span>
                  </div>
                )}
                {order.deliveryPhone && (
                  <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 mb-2">
                    <Phone size={14} className="shrink-0" />
                    <span>{order.deliveryPhone}</span>
                  </div>
                )}
                {order.driverName && (
                  <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 mb-2">
                    <Truck size={14} className="shrink-0" />
                    <span>{order.driverName} {order.driverPhone && `(${order.driverPhone})`}</span>
                  </div>
                )}

                <DeliveryStatusTracker
                  status={order.deliveryStatus || 'pending'}
                  estimatedTime={order.estimatedDeliveryTime}
                  actualTime={order.actualDeliveryTime}
                />

                <div className="flex gap-2 mt-3 border-t pt-3">
                  {(!order.deliveryStatus || order.deliveryStatus === 'pending') && (
                    <button
                      onClick={() => handleDispatch(order)}
                      disabled={updating}
                      className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                      Dispatch
                    </button>
                  )}
                  {order.deliveryStatus === 'dispatched' && (
                    <button
                      onClick={() => updateDeliveryStatus(order.id, 'in_transit')}
                      disabled={updating}
                      className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
                    >
                      Mark In Transit
                    </button>
                  )}
                  {order.deliveryStatus === 'in_transit' && (
                    <>
                      <button
                        onClick={() => updateDeliveryStatus(order.id, 'delivered')}
                        disabled={updating}
                        className="px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                      >
                        Mark Delivered
                      </button>
                      <button
                        onClick={() => updateDeliveryStatus(order.id, 'failed')}
                        disabled={updating}
                        className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                      >
                        Mark Failed
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {orders.length > 0 && (
          <Pagination
            page={pagination.page}
            pageSize={pagination.pageSize}
            total={pagination.total}
            totalPages={pagination.totalPages}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            className="mt-4"
          />
        )}
      </ListPageLayout>

      {/* Dispatch Modal */}
      <Modal
        isOpen={showDispatchModal}
        onClose={() => setShowDispatchModal(false)}
        title="Dispatch Delivery"
        size="sm"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1 dark:text-gray-300">Driver Name *</label>
            <input
              value={dispatchForm.driverName}
              onChange={e => setDispatchForm(f => ({ ...f, driverName: e.target.value }))}
              placeholder="Enter driver name"
              required
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 dark:text-gray-300">Driver Phone</label>
            <input
              value={dispatchForm.driverPhone}
              onChange={e => setDispatchForm(f => ({ ...f, driverPhone: e.target.value }))}
              placeholder="Enter driver phone"
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 dark:text-gray-300">Estimated Delivery Time</label>
            <input
              type="datetime-local"
              value={dispatchForm.estimatedDeliveryTime}
              onChange={e => setDispatchForm(f => ({ ...f, estimatedDeliveryTime: e.target.value }))}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6 pt-4 border-t">
          <button
            onClick={() => setShowDispatchModal(false)}
            className="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (selectedOrder) {
                updateDeliveryStatus(selectedOrder.id, 'dispatched', {
                  driverName: dispatchForm.driverName,
                  driverPhone: dispatchForm.driverPhone,
                  ...(dispatchForm.estimatedDeliveryTime && { estimatedDeliveryTime: new Date(dispatchForm.estimatedDeliveryTime).toISOString() }),
                })
              }
            }}
            disabled={!dispatchForm.driverName || updating}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {updating ? 'Dispatching...' : 'Dispatch'}
          </button>
        </div>
      </Modal>
    </>
  )
}
