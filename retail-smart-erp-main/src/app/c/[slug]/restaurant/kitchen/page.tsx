'use client'

import { useState, useCallback, useEffect } from 'react'
import { ChefHat, Clock, CheckCircle, Users, RefreshCw, Loader2 } from 'lucide-react'
import { useRealtimeData } from '@/hooks'
import { PageLoading } from '@/components/ui/loading-spinner'
import { toast } from '@/components/ui/toast'

interface KitchenItem {
  id: string
  status: string
  restaurantOrderItemId: string
  itemName: string
  quantity: number
  modifiers: unknown[]
  notes: string | null
}

interface KitchenOrder {
  id: string
  status: string
  createdAt: string
  updatedAt: string
  restaurantOrderId: string
  orderNo: string
  orderType: 'dine_in' | 'takeaway' | 'delivery'
  tableName: string | null
  tableArea: string | null
  items: KitchenItem[]
  totalItems: number
  pendingItems: number
  preparingItems: number
  readyItems: number
  servedItems: number
}

const statusLabels: Record<string, string> = {
  pending: 'Pending',
  preparing: 'Preparing',
  ready: 'Ready',
  served: 'Served',
  cancelled: 'Cancelled',
}

const statusColors: Record<string, string> = {
  pending: 'bg-gray-100 border-gray-300 dark:bg-gray-700 dark:border-gray-600',
  preparing: 'bg-yellow-50 border-yellow-400 dark:bg-yellow-900/20 dark:border-yellow-600',
  ready: 'bg-green-50 border-green-400 dark:bg-green-900/20 dark:border-green-600',
  served: 'bg-blue-50 border-blue-400 dark:bg-blue-900/20 dark:border-blue-600',
  cancelled: 'bg-red-50 border-red-400 dark:bg-red-900/20 dark:border-red-600',
}

const itemStatusColors: Record<string, string> = {
  pending: 'bg-gray-200 dark:bg-gray-600',
  preparing: 'bg-yellow-200 dark:bg-yellow-700',
  ready: 'bg-green-200 dark:bg-green-700',
  served: 'bg-blue-200 dark:bg-blue-700',
  cancelled: 'bg-red-200 dark:bg-red-700 line-through',
}

const orderTypeLabels: Record<string, string> = {
  dine_in: 'Dine In',
  takeaway: 'Takeaway',
  delivery: 'Delivery',
}

const orderTypeBadgeColors: Record<string, string> = {
  dine_in: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  takeaway: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  delivery: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200',
}

// Get the next status in the workflow
function getNextStatus(currentStatus: string): string | null {
  const workflow: Record<string, string> = {
    pending: 'preparing',
    preparing: 'ready',
    ready: 'served',
  }
  return workflow[currentStatus] || null
}

export default function KitchenDisplayPage() {
  const [orders, setOrders] = useState<KitchenOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [updatingItem, setUpdatingItem] = useState<string | null>(null)
  const [updatingOrder, setUpdatingOrder] = useState<string | null>(null)

  // Fetch active kitchen orders
  const fetchOrders = useCallback(async () => {
    try {
      const res = await fetch('/api/kitchen-orders?activeOnly=true&sortOrder=asc')
      if (!res.ok) throw new Error('Failed to fetch orders')
      const data = await res.json()
      setOrders(data)
    } catch (error) {
      console.error('Error fetching kitchen orders:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial fetch
  useEffect(() => {
    fetchOrders()
  }, [fetchOrders])

  // Real-time updates
  const { isRealtime } = useRealtimeData(fetchOrders, {
    entityType: ['kitchen-order', 'restaurant-order'],
    enabled: true,
  })

  // Update individual item status
  async function handleUpdateItemStatus(kitchenOrderId: string, itemId: string, currentStatus: string) {
    const nextStatus = getNextStatus(currentStatus)
    if (!nextStatus) return

    setUpdatingItem(itemId)
    try {
      const res = await fetch(`/api/kitchen-orders/${kitchenOrderId}/items/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to update item')
      }

      // Optimistically update local state
      setOrders(prev => prev.map(order => {
        if (order.id === kitchenOrderId) {
          return {
            ...order,
            items: order.items.map(item =>
              item.id === itemId ? { ...item, status: nextStatus } : item
            ),
          }
        }
        return order
      }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update item')
    } finally {
      setUpdatingItem(null)
    }
  }

  // Mark all items as ready
  async function handleMarkAllReady(order: KitchenOrder) {
    const pendingOrPreparingItems = order.items.filter(
      item => item.status === 'pending' || item.status === 'preparing'
    )

    if (pendingOrPreparingItems.length === 0) return

    setUpdatingOrder(order.id)
    try {
      // Update all items to ready
      for (const item of pendingOrPreparingItems) {
        await fetch(`/api/kitchen-orders/${order.id}/items/${item.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'ready' }),
        })
      }

      toast.success('All items marked as ready')
    } catch {
      toast.error('Failed to update some items')
    } finally {
      setUpdatingOrder(null)
    }
  }

  // Mark all items as served
  async function handleMarkAllServed(order: KitchenOrder) {
    const readyItems = order.items.filter(item => item.status === 'ready')

    if (readyItems.length === 0) return

    setUpdatingOrder(order.id)
    try {
      for (const item of readyItems) {
        await fetch(`/api/kitchen-orders/${order.id}/items/${item.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'served' }),
        })
      }

      toast.success('All items marked as served')
    } catch {
      toast.error('Failed to update some items')
    } finally {
      setUpdatingOrder(null)
    }
  }

  // Calculate time since order was created
  function getTimeSinceCreated(createdAt: string): string {
    const created = new Date(createdAt)
    const now = new Date()
    const diffMinutes = Math.floor((now.getTime() - created.getTime()) / (1000 * 60))

    if (diffMinutes < 1) return 'Just now'
    if (diffMinutes < 60) return `${diffMinutes}m ago`
    const hours = Math.floor(diffMinutes / 60)
    const mins = diffMinutes % 60
    return `${hours}h ${mins}m ago`
  }

  if (loading) {
    return <PageLoading text="Loading kitchen display..." />
  }

  return (
    <div className="h-full flex flex-col -m-5">
      {/* Header */}
      <div className="px-4 py-3 bg-gray-900 text-white flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ChefHat size={24} />
          <h1 className="text-xl font-bold">Kitchen Display</h1>
          {isRealtime && (
            <span className="flex items-center gap-1 text-xs bg-green-600 px-2 py-0.5 rounded-full">
              <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
              Live
            </span>
          )}
        </div>
        <button
          onClick={fetchOrders}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded transition-colors"
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      {/* Orders Grid */}
      <div className="flex-1 overflow-auto p-4 bg-gray-100 dark:bg-gray-900">
        {orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400">
            <ChefHat size={64} className="mb-4 opacity-50" />
            <p className="text-xl font-medium">No active orders</p>
            <p className="text-sm">New orders will appear here automatically</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {orders.map((order) => (
              <div
                key={order.id}
                className={`rounded border-2 overflow-hidden shadow-sm ${statusColors[order.status]}`}
              >
                {/* Card Header */}
                <div className="p-3 bg-white/50 dark:bg-gray-800/50 border-b dark:border-gray-700">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-bold text-lg text-gray-900 dark:text-white">
                      {order.orderNo}
                    </span>
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${orderTypeBadgeColors[order.orderType]}`}>
                      {orderTypeLabels[order.orderType]}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      {order.tableName && (
                        <span className="font-medium text-gray-700 dark:text-gray-300">
                          {order.tableName}
                          {order.tableArea && (
                            <span className="text-gray-400 text-xs ml-1">({order.tableArea})</span>
                          )}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-gray-500 dark:text-gray-400">
                      <Clock size={14} />
                      <span>{getTimeSinceCreated(order.createdAt)}</span>
                    </div>
                  </div>
                </div>

                {/* Card Body - Items */}
                <div className="p-3 space-y-2">
                  {order.items.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => handleUpdateItemStatus(order.id, item.id, item.status)}
                      disabled={updatingItem === item.id || item.status === 'served' || item.status === 'cancelled'}
                      className={`w-full text-left p-2 rounded transition-all ${itemStatusColors[item.status]} ${
                        item.status !== 'served' && item.status !== 'cancelled'
                          ? 'hover:opacity-80 cursor-pointer'
                          : 'cursor-default'
                      } disabled:opacity-60`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900 dark:text-white">
                              {item.quantity}x {item.itemName}
                            </span>
                            {updatingItem === item.id && (
                              <Loader2 size={14} className="animate-spin text-gray-600" />
                            )}
                          </div>
                          {item.notes && (
                            <p className="text-xs text-gray-600 dark:text-gray-300 mt-1 italic">
                              {item.notes}
                            </p>
                          )}
                        </div>
                        <span className="text-xs font-medium text-gray-600 dark:text-gray-400 ml-2">
                          {statusLabels[item.status]}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>

                {/* Card Footer - Actions */}
                <div className="p-3 bg-white/50 dark:bg-gray-800/50 border-t dark:border-gray-700 flex gap-2">
                  {(order.pendingItems > 0 || order.preparingItems > 0) && (
                    <button
                      onClick={() => handleMarkAllReady(order)}
                      disabled={updatingOrder === order.id}
                      className="flex-1 flex items-center justify-center gap-1 px-3 py-2 text-sm font-medium text-green-700 bg-green-100 hover:bg-green-200 dark:bg-green-800 dark:text-green-100 dark:hover:bg-green-700 rounded transition-colors disabled:opacity-50"
                    >
                      {updatingOrder === order.id ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <CheckCircle size={16} />
                      )}
                      All Ready
                    </button>
                  )}
                  {order.readyItems > 0 && (
                    <button
                      onClick={() => handleMarkAllServed(order)}
                      disabled={updatingOrder === order.id}
                      className="flex-1 flex items-center justify-center gap-1 px-3 py-2 text-sm font-medium text-blue-700 bg-blue-100 hover:bg-blue-200 dark:bg-blue-800 dark:text-blue-100 dark:hover:bg-blue-700 rounded transition-colors disabled:opacity-50"
                    >
                      {updatingOrder === order.id ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Users size={16} />
                      )}
                      Mark Served
                    </button>
                  )}
                </div>

                {/* Progress Bar */}
                <div className="h-1 flex bg-gray-200 dark:bg-gray-700">
                  {order.totalItems > 0 && (
                    <>
                      <div
                        className="bg-green-500 transition-all"
                        style={{ width: `${(order.servedItems / order.totalItems) * 100}%` }}
                      />
                      <div
                        className="bg-blue-500 transition-all"
                        style={{ width: `${(order.readyItems / order.totalItems) * 100}%` }}
                      />
                      <div
                        className="bg-yellow-500 transition-all"
                        style={{ width: `${(order.preparingItems / order.totalItems) * 100}%` }}
                      />
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
