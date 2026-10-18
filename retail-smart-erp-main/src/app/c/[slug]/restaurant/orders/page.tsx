'use client'

import { useState, useCallback, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { Users, ChevronRight, Plus, Download, X } from 'lucide-react'
import { usePaginatedData, useRealtimeData } from '@/hooks'
import { useExport } from '@/hooks/useExport'
import { PageLoading } from '@/components/ui/loading-spinner'
import { Pagination } from '@/components/ui/pagination'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { Modal, ModalFooter } from '@/components/ui/modal'
import { FormInput, FormSelect, FormLabel } from '@/components/ui/form-elements'
import { toast } from '@/components/ui/toast'
import { OrderDetailDrawer } from '@/components/restaurant/OrderDetailDrawer'
import { ExportDialog } from '@/components/import-export/ExportDialog'

interface Table {
  id: string
  name: string
  area: string | null
  capacity: number
  status: string
}

interface Customer {
  id: string
  name: string
  phone: string | null
}

interface OrderItem {
  id: string
  itemName: string
  quantity: number
  unitPrice: string
  status: string | null
}

interface RestaurantOrder {
  id: string
  orderNo: string
  tableId: string | null
  customerId: string | null
  orderType: 'dine_in' | 'takeaway' | 'delivery'
  status: string
  customerCount: number
  subtotal: string
  taxAmount: string
  tipAmount: string
  total: string
  cancellationReason: string | null
  cancelledAt: string | null
  createdAt: string
  updatedAt: string
  table: Table | null
  customer: Customer | null
  items: OrderItem[]
}

const statusColors: Record<string, string> = {
  open: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  closed: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  completed: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
}

const statusLabels: Record<string, string> = {
  open: 'Open',
  closed: 'Closed',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

const orderTypeLabels: Record<string, string> = {
  dine_in: 'Dine In',
  takeaway: 'Takeaway',
  delivery: 'Delivery',
}

const orderTypeColors: Record<string, string> = {
  dine_in: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  takeaway: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  delivery: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200',
}

export default function RestaurantOrdersPage() {
  const params = useParams()
  const { data: session } = useSession()
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const slug = params.slug as string
  const userRole = session?.user?.role
  const userId = session?.user?.id

  const { showExportDialog, openExport, closeExport } = useExport()

  const [statusFilter, setStatusFilter] = useState('')
  const [orderTypeFilter, setOrderTypeFilter] = useState('')
  const [tableFilter, setTableFilter] = useState('')
  const [myOrdersOnly, setMyOrdersOnly] = useState(userRole === 'waiter')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)
  const [tables, setTables] = useState<Table[]>([])

  // Create order form
  const [createForm, setCreateForm] = useState({
    orderType: 'dine_in',
    tableId: '',
    customerId: '',
    customerCount: 1,
  })
  const [creating, setCreating] = useState(false)

  // Fetch tables for filter and create modal
  const fetchTables = useCallback(async () => {
    try {
      const res = await fetch('/api/restaurant-tables?all=true')
      if (res.ok) {
        const data = await res.json()
        setTables(data)
      }
    } catch (error) {
      console.error('Error fetching tables:', error)
    }
  }, [])

  useEffect(() => {
    fetchTables()
  }, [fetchTables])

  // Subscribe to table updates
  useRealtimeData(fetchTables, { entityType: 'table' })

  // Paginated orders data
  const {
    data: orders,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<RestaurantOrder>({
    endpoint: '/api/restaurant-orders',
    entityType: ['restaurant-order', 'kitchen-order'],
    storageKey: 'restaurant-orders-page-size',
    additionalParams: {
      ...(statusFilter && { status: statusFilter }),
      ...(orderTypeFilter && { orderType: orderTypeFilter }),
      ...(tableFilter && { tableId: tableFilter }),
      ...(myOrdersOnly && userId && { createdBy: userId }),
    },
  })

  // Handle row click to open detail drawer
  function handleRowClick(orderId: string) {
    setSelectedOrderId(orderId)
  }

  // Handle create order
  async function handleCreateOrder() {
    if (createForm.orderType === 'dine_in' && !createForm.tableId) {
      toast.error('Please select a table for dine-in orders')
      return
    }

    setCreating(true)
    try {
      const res = await fetch('/api/restaurant-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderType: createForm.orderType,
          tableId: createForm.tableId || null,
          customerId: createForm.customerId || null,
          customerCount: createForm.customerCount,
        }),
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to create order')
      }

      const newOrder = await res.json()
      toast.success('Order created successfully')
      setShowCreateModal(false)
      setCreateForm({
        orderType: 'dine_in',
        tableId: '',
        customerId: '',
        customerCount: 1,
      })
      // Open the new order detail
      setSelectedOrderId(newOrder.id)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create order')
    } finally {
      setCreating(false)
    }
  }

  // Reset form when modal opens
  useEffect(() => {
    if (showCreateModal) {
      setCreateForm({
        orderType: 'dine_in',
        tableId: '',
        customerId: '',
        customerCount: 1,
      })
    }
  }, [showCreateModal])

  // Filter available tables
  const availableTables = tables.filter(t => t.status === 'available' || t.status === 'reserved')

  if (loading && orders.length === 0) {
    return <PageLoading text="Loading orders..." />
  }

  return (
    <>
      <ListPageLayout
        module="Restaurant"
        moduleHref="/restaurant"
        title="Orders"
        actionContent={
          <div className="flex items-center gap-2">
            <button
              onClick={openExport}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              <Download size={16} />
              Export
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
            >
              <Plus size={16} />
              New Order
            </button>
          </div>
        }
        search={search}
        setSearch={setSearch}
        onRefresh={refresh}
        searchPlaceholder="Search orders..."
        filterContent={
          <>
            <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 rounded p-0.5">
              <button
                onClick={() => setMyOrdersOnly(true)}
                className={`text-xs font-medium px-3 py-1 rounded transition-colors ${
                  myOrdersOnly ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400'
                }`}
              >
                My Orders
              </button>
              <button
                onClick={() => setMyOrdersOnly(false)}
                className={`text-xs font-medium px-3 py-1 rounded transition-colors ${
                  !myOrdersOnly ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400'
                }`}
              >
                All Orders
              </button>
            </div>
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
            <select
              value={orderTypeFilter}
              onChange={(e) => setOrderTypeFilter(e.target.value)}
              className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
            >
              <option value="">All Types</option>
              {Object.entries(orderTypeLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <FormSelect
              value={tableFilter}
              onChange={(e) => setTableFilter(e.target.value)}
              selectSize="sm"
            >
              <option value="">All Tables</option>
              {tables.map((table) => (
                <option key={table.id} value={table.id}>
                  {table.name}{table.area ? ` (${table.area})` : ''}
                </option>
              ))}
            </FormSelect>
            {(statusFilter || orderTypeFilter || tableFilter) && (
              <button
                onClick={() => { setStatusFilter(''); setOrderTypeFilter(''); setTableFilter('') }}
                className="text-xs text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 px-2 py-1.5"
              >
                <X size={14} />
              </button>
            )}
          </>
        }
      >
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 overflow-x-auto">
          <table className="w-full">
            <caption className="sr-only">List of restaurant orders</caption>
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Order No</th>
                <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Table</th>
                <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Type</th>
                <th scope="col" className="px-4 py-3 text-center text-sm font-medium text-gray-600 dark:text-gray-300">Guests</th>
                <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600 dark:text-gray-300">Total</th>
                <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Status</th>
                <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600 dark:text-gray-300">Created</th>
                <th scope="col" className="px-4 py-3 text-center text-sm font-medium text-gray-600 dark:text-gray-300"></th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                    {search || statusFilter || orderTypeFilter || tableFilter
                      ? 'No orders match your filters'
                      : 'No orders yet. Create your first order!'}
                  </td>
                </tr>
              ) : (
                orders.map((order) => (
                  <tr
                    key={order.id}
                    onClick={() => handleRowClick(order.id)}
                    className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <span className="font-medium text-blue-600 dark:text-blue-400">
                        {order.orderNo}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                      {order.table ? (
                        <span>
                          {order.table.name}
                          {order.table.area && (
                            <span className="text-gray-400 text-xs ml-1">({order.table.area})</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${orderTypeColors[order.orderType]}`}>
                        {orderTypeLabels[order.orderType]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1 text-gray-600 dark:text-gray-300">
                        <Users size={14} />
                        <span>{order.customerCount}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-medium dark:text-white">
                      {parseFloat(order.total).toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${statusColors[order.status]}`}>
                        {statusLabels[order.status] || order.status}
                      </span>
                      {order.status === 'cancelled' && order.cancellationReason && (
                        <p className="text-xs text-red-600 dark:text-red-400 mt-1" title={order.cancellationReason}>
                          {order.cancellationReason.length > 20 ? `${order.cancellationReason.slice(0, 20)}...` : order.cancellationReason}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-sm">
                      {new Date(order.createdAt).toLocaleDateString()}{' '}
                      {new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <ChevronRight size={16} className="text-gray-400" />
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

      {/* Create Order Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="New Order"
        size="md"
        footer={
          <ModalFooter>
            <button
              onClick={() => setShowCreateModal(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleCreateOrder}
              disabled={creating}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Create Order'}
            </button>
          </ModalFooter>
        }
      >
        <div className="space-y-4">
          {/* Order Type */}
          <div>
            <FormLabel required>Order Type</FormLabel>
            <FormSelect
              value={createForm.orderType}
              onChange={(e) => setCreateForm({ ...createForm, orderType: e.target.value as 'dine_in' | 'takeaway' | 'delivery', tableId: '' })}
            >
              <option value="dine_in">Dine In</option>
              <option value="takeaway">Takeaway</option>
              <option value="delivery">Delivery</option>
            </FormSelect>
          </div>

          {/* Table (required for dine_in) */}
          {createForm.orderType === 'dine_in' && (
            <div>
              <FormLabel required>Table</FormLabel>
              <FormSelect
                value={createForm.tableId}
                onChange={(e) => setCreateForm({ ...createForm, tableId: e.target.value })}
              >
                <option value="">Select a table...</option>
                {availableTables.map((table) => (
                  <option key={table.id} value={table.id}>
                    {table.name}{table.area ? ` (${table.area})` : ''} - {table.capacity} seats
                  </option>
                ))}
              </FormSelect>
              {availableTables.length === 0 && (
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                  No tables available. All tables are currently occupied.
                </p>
              )}
            </div>
          )}

          {/* Customer Count */}
          <div>
            <FormLabel>Number of Guests</FormLabel>
            <FormInput
              type="number"
              min={1}
              value={createForm.customerCount}
              onChange={(e) => setCreateForm({ ...createForm, customerCount: parseInt(e.target.value) || 1 })}
            />
          </div>
        </div>
      </Modal>

      {/* Order Detail Drawer */}
      <OrderDetailDrawer
        orderId={selectedOrderId}
        isOpen={!!selectedOrderId}
        onClose={() => setSelectedOrderId(null)}
        onOrderUpdated={refresh}
      />

      <ExportDialog
        isOpen={showExportDialog}
        onClose={closeExport}
        entity="restaurant-orders"
        currentFilters={{ search: search || '', status: statusFilter, orderType: orderTypeFilter || '' }}
      />
    </>
  )
}
