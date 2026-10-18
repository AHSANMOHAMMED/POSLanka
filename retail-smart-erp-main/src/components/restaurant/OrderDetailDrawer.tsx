'use client'

import { useState, useEffect, useCallback } from 'react'
import { Drawer } from '@/components/ui/modal'
import { FormInput } from '@/components/ui/form-elements'
import { toast } from '@/components/ui/toast'
import { useRealtimeData, useDebouncedValue } from '@/hooks'
import { CancellationReasonModal } from '@/components/modals'
import {
  Plus, Trash2, Search, Minus, Users, ChefHat,
  Clock, CheckCircle, XCircle, AlertCircle, Loader2
} from 'lucide-react'
import { isItemAvailable, formatAvailabilityWindow } from '@/lib/utils/menu-availability'

interface Table {
  id: string
  name: string
  area: string | null
}

interface Customer {
  id: string
  name: string
}

interface OrderItem {
  id: string
  itemId: string | null
  itemName: string
  quantity: number
  unitPrice: string
  modifiers: unknown[]
  notes: string | null
  status: string | null
}

interface Order {
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
  createdAt: string
  updatedAt: string
  table: Table | null
  customer: Customer | null
  items: OrderItem[]
}

interface MenuItem {
  id: string
  name: string
  sellingPrice: string
  categoryId: string | null
  availableFrom: string | null
  availableTo: string | null
}

interface OrderDetailDrawerProps {
  orderId: string | null
  isOpen: boolean
  onClose: () => void
  onOrderUpdated?: () => void
}

const statusColors: Record<string, string> = {
  open: 'bg-blue-100 text-blue-800',
  closed: 'bg-yellow-100 text-yellow-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
}

const itemStatusIcons: Record<string, React.ReactNode> = {
  pending: <Clock size={14} className="text-gray-400" />,
  preparing: <Loader2 size={14} className="text-yellow-500 animate-spin" />,
  ready: <CheckCircle size={14} className="text-green-500" />,
  served: <CheckCircle size={14} className="text-blue-500" />,
  cancelled: <XCircle size={14} className="text-red-500" />,
}

const orderTypeLabels: Record<string, string> = {
  dine_in: 'Dine In',
  takeaway: 'Takeaway',
  delivery: 'Delivery',
}

export function OrderDetailDrawer({
  orderId,
  isOpen,
  onClose,
  onOrderUpdated,
}: OrderDetailDrawerProps) {
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(false)
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [menuSearch, setMenuSearch] = useState('')
  const debouncedMenuSearch = useDebouncedValue(menuSearch, 300)
  const [loadingMenu, setLoadingMenu] = useState(false)
  const [addingItem, setAddingItem] = useState<string | null>(null)
  const [removingItem, setRemovingItem] = useState<string | null>(null)
  const [tipAmount, setTipAmount] = useState('')
  const [savingTip, setSavingTip] = useState(false)
  const [processingAction, setProcessingAction] = useState(false)
  const [showCancellationModal, setShowCancellationModal] = useState(false)

  // Fetch order details
  const fetchOrder = useCallback(async () => {
    if (!orderId) return

    setLoading(true)
    try {
      const res = await fetch(`/api/restaurant-orders/${orderId}`)
      if (!res.ok) throw new Error('Failed to fetch order')
      const data = await res.json()
      setOrder(data)
      setTipAmount(data.tipAmount || '0')
    } catch (error) {
      console.error('Error fetching order:', error)
      toast.error('Failed to load order details')
    } finally {
      setLoading(false)
    }
  }, [orderId])

  // Fetch menu items
  const fetchMenuItems = useCallback(async () => {
    setLoadingMenu(true)
    try {
      const params = new URLSearchParams({ pageSize: '20' })
      if (debouncedMenuSearch) params.set('search', debouncedMenuSearch)
      const res = await fetch(`/api/items?${params}`)
      if (res.ok) {
        const result = await res.json()
        setMenuItems(result.data || result)
      }
    } catch (error) {
      console.error('Error fetching menu items:', error)
    } finally {
      setLoadingMenu(false)
    }
  }, [debouncedMenuSearch])

  // Initial fetch
  useEffect(() => {
    if (isOpen && orderId) {
      fetchOrder()
      fetchMenuItems()
    }
  }, [isOpen, orderId, fetchOrder, fetchMenuItems])

  // Real-time updates
  useRealtimeData(fetchOrder, {
    entityType: ['restaurant-order', 'kitchen-order'],
    enabled: isOpen && !!orderId,
    refreshOnMount: false,
  })

  // Add item to order
  async function handleAddItem(item: MenuItem) {
    if (!order || order.status !== 'open') return

    setAddingItem(item.id)
    try {
      const res = await fetch(`/api/restaurant-orders/${order.id}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: item.id,
          itemName: item.name,
          quantity: 1,
          unitPrice: item.sellingPrice,
        }),
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to add item')
      }

      toast.success(`Added ${item.name}`)
      fetchOrder()
      onOrderUpdated?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to add item')
    } finally {
      setAddingItem(null)
    }
  }

  // Update item quantity
  async function handleUpdateQuantity(itemId: string, newQuantity: number) {
    if (!order || order.status !== 'open' || newQuantity < 1) return

    try {
      const res = await fetch(`/api/restaurant-orders/${order.id}/items/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: newQuantity }),
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to update quantity')
      }

      fetchOrder()
      onOrderUpdated?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update quantity')
    }
  }

  // Remove item from order
  async function handleRemoveItem(itemId: string) {
    if (!order || order.status !== 'open') return

    setRemovingItem(itemId)
    try {
      const res = await fetch(`/api/restaurant-orders/${order.id}/items/${itemId}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to remove item')
      }

      toast.success('Item removed')
      fetchOrder()
      onOrderUpdated?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to remove item')
    } finally {
      setRemovingItem(null)
    }
  }

  // Save tip
  async function handleSaveTip() {
    if (!order) return

    setSavingTip(true)
    try {
      const res = await fetch(`/api/restaurant-orders/${order.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipAmount,
          expectedUpdatedAt: order.updatedAt,
        }),
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to save tip')
      }

      toast.success('Tip saved')
      fetchOrder()
      onOrderUpdated?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save tip')
    } finally {
      setSavingTip(false)
    }
  }

  // Close order (send to payment)
  async function handleCloseOrder() {
    if (!order || order.status !== 'open') return

    if (order.items.length === 0) {
      toast.error('Cannot close order with no items')
      return
    }

    setProcessingAction(true)
    try {
      const res = await fetch(`/api/restaurant-orders/${order.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'closed',
          expectedUpdatedAt: order.updatedAt,
        }),
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to close order')
      }

      toast.success('Order closed')
      fetchOrder()
      onOrderUpdated?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to close order')
    } finally {
      setProcessingAction(false)
    }
  }

  // Complete order (finalize payment)
  async function handleCompleteOrder() {
    if (!order || order.status !== 'closed') return

    setProcessingAction(true)
    try {
      const res = await fetch(`/api/restaurant-orders/${order.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'completed',
          expectedUpdatedAt: order.updatedAt,
        }),
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to complete order')
      }

      toast.success('Order completed')
      fetchOrder()
      onOrderUpdated?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to complete order')
    } finally {
      setProcessingAction(false)
    }
  }

  // Cancel order
  async function handleCancelOrder(reason: string) {
    if (!order) return

    setProcessingAction(true)
    try {
      const res = await fetch(`/api/restaurant-orders/${order.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'cancelled',
          cancellationReason: reason,
          expectedUpdatedAt: order.updatedAt,
        }),
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to cancel order')
      }

      toast.success('Order cancelled')
      setShowCancellationModal(false)
      fetchOrder()
      onOrderUpdated?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to cancel order')
    } finally {
      setProcessingAction(false)
    }
  }

  const isOpen_ = order?.status === 'open'
  const isClosed = order?.status === 'closed'
  const isTerminal = order?.status === 'completed' || order?.status === 'cancelled'

  return (
    <>
      <Drawer
        isOpen={isOpen}
        onClose={onClose}
        title={
          <div className="flex items-center gap-3">
            <span>{order?.orderNo || 'Order Details'}</span>
            {order && (
              <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusColors[order.status]}`}>
                {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
              </span>
            )}
          </div>
        }
        size="lg"
        footer={
          order && !isTerminal && (
            <div className="flex items-center justify-between gap-2">
              <button
                onClick={() => setShowCancellationModal(true)}
                disabled={processingAction}
                className="px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
              >
                Cancel Order
              </button>
              <div className="flex gap-2">
                {isOpen_ && (
                  <button
                    onClick={handleCloseOrder}
                    disabled={processingAction || order.items.length === 0}
                    className="px-4 py-2 text-sm font-medium text-white bg-yellow-600 hover:bg-yellow-700 rounded transition-colors disabled:opacity-50"
                  >
                    {processingAction ? 'Processing...' : 'Close Order'}
                  </button>
                )}
                {isClosed && (
                  <button
                    onClick={handleCompleteOrder}
                    disabled={processingAction}
                    className="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded transition-colors disabled:opacity-50"
                  >
                    {processingAction ? 'Processing...' : 'Complete Order'}
                  </button>
                )}
              </div>
            </div>
          )
        }
      >
        {loading && !order ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="animate-spin text-blue-600" size={32} />
          </div>
        ) : order ? (
          <div className="space-y-6">
            {/* Order Info */}
            <div className="grid grid-cols-2 gap-4 p-4 bg-gray-50 dark:bg-gray-700 rounded">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Type</p>
                <p className="font-medium dark:text-white">{orderTypeLabels[order.orderType]}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Table</p>
                <p className="font-medium dark:text-white">
                  {order.table ? `${order.table.name}${order.table.area ? ` (${order.table.area})` : ''}` : '-'}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Customer</p>
                <p className="font-medium dark:text-white">{order.customer?.name || '-'}</p>
              </div>
              <div className="flex items-center gap-1">
                <Users size={14} className="text-gray-400" />
                <p className="text-xs text-gray-500 dark:text-gray-400">Guests:</p>
                <p className="font-medium dark:text-white">{order.customerCount}</p>
              </div>
            </div>

            {/* Order Items */}
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                <ChefHat size={16} />
                Order Items
              </h3>

              {order.items.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">
                  No items yet. Add items from the menu below.
                </p>
              ) : (
                <div className="space-y-2">
                  {order.items.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-3 bg-white dark:bg-gray-800 border dark:border-gray-600 rounded"
                    >
                      <div className="flex items-center gap-3 flex-1">
                        {itemStatusIcons[item.status || 'pending']}
                        <div className="flex-1">
                          <p className="font-medium text-gray-900 dark:text-white">{item.itemName}</p>
                          <p className="text-xs text-gray-500">
                            {parseFloat(item.unitPrice).toFixed(2)} x {item.quantity}
                          </p>
                          {item.notes && (
                            <p className="text-xs text-gray-400 italic mt-1">{item.notes}</p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {isOpen_ && item.status === 'pending' && (
                          <>
                            <button
                              onClick={() => handleUpdateQuantity(item.id, item.quantity - 1)}
                              disabled={item.quantity <= 1}
                              className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-50"
                            >
                              <Minus size={16} />
                            </button>
                            <span className="w-8 text-center font-medium dark:text-white">
                              {item.quantity}
                            </span>
                            <button
                              onClick={() => handleUpdateQuantity(item.id, item.quantity + 1)}
                              className="p-1 text-gray-400 hover:text-gray-600"
                            >
                              <Plus size={16} />
                            </button>
                            <button
                              onClick={() => handleRemoveItem(item.id)}
                              disabled={removingItem === item.id}
                              className="p-1 text-red-400 hover:text-red-600 ml-2"
                            >
                              {removingItem === item.id ? (
                                <Loader2 size={16} className="animate-spin" />
                              ) : (
                                <Trash2 size={16} />
                              )}
                            </button>
                          </>
                        )}
                        {(!isOpen_ || item.status !== 'pending') && (
                          <span className="w-8 text-center font-medium dark:text-white">
                            x{item.quantity}
                          </span>
                        )}
                        <span className="font-medium dark:text-white ml-4 w-20 text-right">
                          {(parseFloat(item.unitPrice) * item.quantity).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Add Items (only for open orders) */}
            {isOpen_ && (
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Add Items</h3>
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={16} />
                  <FormInput
                    type="text"
                    placeholder="Search menu items..."
                    value={menuSearch}
                    onChange={(e) => setMenuSearch(e.target.value)}
                    className="pl-9"
                    inputSize="sm"
                  />
                </div>
                <div className="max-h-48 overflow-y-auto border dark:border-gray-600 rounded">
                  {loadingMenu ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="animate-spin text-gray-400" size={20} />
                    </div>
                  ) : menuItems.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-4">No items found</p>
                  ) : (
                    menuItems.map((item) => {
                      const available = isItemAvailable(item)
                      const availabilityWindow = formatAvailabilityWindow(item)
                      return (
                        <button
                          key={item.id}
                          onClick={() => available && handleAddItem(item)}
                          disabled={!available || addingItem === item.id}
                          className={`w-full flex items-center justify-between p-3 border-b dark:border-gray-600 last:border-b-0 text-left ${
                            available
                              ? 'hover:bg-gray-50 dark:hover:bg-gray-700'
                              : 'opacity-60 cursor-not-allowed bg-gray-50 dark:bg-gray-800'
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`font-medium ${available ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'}`}>
                                {item.name}
                              </span>
                              {!available && (
                                <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 shrink-0">
                                  Unavailable
                                </span>
                              )}
                            </div>
                            {availabilityWindow && (
                              <div className="flex items-center gap-1 mt-0.5">
                                <Clock size={11} className="text-gray-400 shrink-0" />
                                <span className="text-[11px] text-gray-400 dark:text-gray-500">{availabilityWindow}</span>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2 ml-2 shrink-0">
                            <span className={`${available ? 'text-gray-600 dark:text-gray-300' : 'text-gray-400 dark:text-gray-500'}`}>
                              {parseFloat(item.sellingPrice).toFixed(2)}
                            </span>
                            {addingItem === item.id ? (
                              <Loader2 size={16} className="animate-spin text-blue-600" />
                            ) : (
                              <Plus size={16} className={available ? 'text-blue-600' : 'text-gray-300 dark:text-gray-600'} />
                            )}
                          </div>
                        </button>
                      )
                    })
                  )}
                </div>
              </div>
            )}

            {/* Totals */}
            <div className="border-t dark:border-gray-600 pt-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500 dark:text-gray-400">Subtotal</span>
                <span className="dark:text-white">{parseFloat(order.subtotal).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500 dark:text-gray-400">Tax</span>
                <span className="dark:text-white">{parseFloat(order.taxAmount).toFixed(2)}</span>
              </div>

              {/* Tip Input */}
              {!isTerminal && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500 dark:text-gray-400">Tip</span>
                  <div className="flex items-center gap-2">
                    <FormInput
                      type="number"
                      value={tipAmount}
                      onChange={(e) => setTipAmount(e.target.value)}
                      className="w-24 text-right"
                      inputSize="sm"
                      min={0}
                      step={0.01}
                    />
                    <button
                      onClick={handleSaveTip}
                      disabled={savingTip || tipAmount === order.tipAmount}
                      className="text-xs text-blue-600 hover:text-blue-700 disabled:opacity-50"
                    >
                      {savingTip ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              )}
              {isTerminal && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500 dark:text-gray-400">Tip</span>
                  <span className="dark:text-white">{parseFloat(order.tipAmount).toFixed(2)}</span>
                </div>
              )}

              <div className="flex justify-between text-lg font-bold border-t dark:border-gray-600 pt-2 mt-2">
                <span className="dark:text-white">Total</span>
                <span className="dark:text-white">{parseFloat(order.total).toFixed(2)}</span>
              </div>
            </div>

            {/* Cancellation Reason (for cancelled orders) */}
            {order.status === 'cancelled' && order.cancellationReason && (
              <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded">
                <div className="flex items-start gap-2">
                  <AlertCircle size={16} className="text-red-600 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-red-800 dark:text-red-200">Cancellation Reason</p>
                    <p className="text-sm text-red-600 dark:text-red-300">{order.cancellationReason}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </Drawer>

      {/* Cancellation Reason Modal */}
      <CancellationReasonModal
        isOpen={showCancellationModal}
        onClose={() => setShowCancellationModal(false)}
        onConfirm={handleCancelOrder}
        title="Cancel Order"
        itemName={order?.orderNo || ''}
        processing={processingAction}
        documentType="sales_order"
      />
    </>
  )
}
