'use client'

import { useState, useCallback, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import {
  Users, Clock, Plus, ChevronRight, ChevronDown, ChevronUp,
  UtensilsCrossed, AlertCircle, CheckCircle, Minus, X, Search,
  Coffee, ShoppingBag, Truck, MessageSquare
} from 'lucide-react'
import { useRealtimeData } from '@/hooks'
import { PageLoading } from '@/components/ui/loading-spinner'
import { toast } from '@/components/ui/toast'

interface TableInfo {
  id: string
  name: string
  area: string | null
  capacity: number
  status: string
  serverId: string | null
  currentOrderId: string | null
  occupiedAt: string | null
}

interface OrderItem {
  id: string
  itemName: string
  quantity: number
  unitPrice: string
  modifiers: unknown
  notes: string | null
  status: string | null
}

interface ActiveOrder {
  id: string
  orderNo: string
  tableId: string | null
  orderType: string
  status: string
  customerCount: number
  subtotal: string
  total: string
  createdAt: string
  items: OrderItem[]
  table: { name: string } | null
}

interface MenuItem {
  id: string
  name: string
  sellingPrice: string
  category: string | null
}

const statusColors: Record<string, string> = {
  available: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border-green-200 dark:border-green-800',
  occupied: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border-red-200 dark:border-red-800',
  reserved: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200 dark:border-blue-800',
  unavailable: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300 border-gray-200 dark:border-gray-700',
}

const orderStatusColors: Record<string, string> = {
  open: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  closed: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  completed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
}

export default function WaitstaffPage() {
  const params = useParams()
  void params.slug
  const { data: session } = useSession()
  const userId = session?.user?.id

  const [loading, setLoading] = useState(true)
  const [tables, setTables] = useState<TableInfo[]>([])
  const [activeOrders, setActiveOrders] = useState<ActiveOrder[]>([])
  const [selectedTable, setSelectedTable] = useState<TableInfo | null>(null)
  const [showNewOrder, setShowNewOrder] = useState(false)
  const [showAddItem, setShowAddItem] = useState(false)
  const [activeOrderForTable, setActiveOrderForTable] = useState<ActiveOrder | null>(null)

  // New order form
  const [newOrderType, setNewOrderType] = useState<string>('dine_in')
  const [newOrderCustomerCount, setNewOrderCustomerCount] = useState(1)
  const [creatingOrder, setCreatingOrder] = useState(false)

  // Add item form
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [menuSearch, setMenuSearch] = useState('')
  const [addingItem, setAddingItem] = useState(false)
  const [itemNotes, setItemNotes] = useState('')
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set())

  // View mode: 'tables' or 'orders'
  const [viewMode, setViewMode] = useState<'tables' | 'orders'>('tables')

  const fetchData = useCallback(async () => {
    if (!userId) return
    try {
      // Fetch tables assigned to this server + all tables if owner/manager
      const [tablesRes, ordersRes] = await Promise.all([
        fetch(`/api/restaurant-tables?all=true&pageSize=100`),
        fetch(`/api/restaurant-orders?status=open&pageSize=100&all=true`),
      ])

      if (tablesRes.ok) {
        const tablesData = await tablesRes.json()
        const allTables = Array.isArray(tablesData) ? tablesData : (tablesData.data || [])
        // Filter to show tables assigned to current server, or all tables for managers
        const role = session?.user?.role
        const isManager = role === 'owner' || role === 'manager' || role === 'system_manager'
        const myTables = isManager
          ? allTables.filter((t: TableInfo) => t.status !== 'unavailable')
          : allTables.filter((t: TableInfo) => t.serverId === userId || !t.serverId)
        setTables(myTables)
      }

      if (ordersRes.ok) {
        const ordersData = await ordersRes.json()
        const allOrders = Array.isArray(ordersData) ? ordersData : (ordersData.data || [])
        setActiveOrders(allOrders)
      }
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [userId, session?.user?.role])

  const { isRealtime } = useRealtimeData(fetchData, {
    entityType: ['restaurant-order', 'table', 'kitchen-order'],
  })

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Get active order for a specific table
  const getTableOrder = useCallback((tableId: string) => {
    return activeOrders.find(o => o.tableId === tableId && o.status === 'open')
  }, [activeOrders])

  // Create new order for table
  const handleCreateOrder = async () => {
    if (!selectedTable) return
    setCreatingOrder(true)
    try {
      const res = await fetch('/api/restaurant-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableId: selectedTable.id,
          orderType: newOrderType,
          customerCount: newOrderCustomerCount,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create order')
      }
      const order = await res.json()
      toast.success(`Order ${order.orderNo} created`)
      setShowNewOrder(false)
      setSelectedTable(null)
      setNewOrderCustomerCount(1)
      fetchData()
      // Open the order to add items
      setActiveOrderForTable(order)
      setShowAddItem(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create order')
    } finally {
      setCreatingOrder(false)
    }
  }

  // Add item to order
  const handleAddItem = async (item: MenuItem) => {
    if (!activeOrderForTable) return
    setAddingItem(true)
    try {
      const res = await fetch(`/api/restaurant-orders/${activeOrderForTable.id}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: item.id,
          itemName: item.name,
          quantity: 1,
          unitPrice: item.sellingPrice,
          notes: itemNotes || null,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to add item')
      }
      toast.success(`Added ${item.name}`)
      setItemNotes('')
      fetchData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add item')
    } finally {
      setAddingItem(false)
    }
  }

  // Update item quantity
  const handleUpdateItemQty = async (orderId: string, itemId: string, newQty: number) => {
    if (newQty < 1) return
    try {
      const res = await fetch(`/api/restaurant-orders/${orderId}/items/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: newQty }),
      })
      if (!res.ok) throw new Error('Failed')
      fetchData()
    } catch {
      toast.error('Failed to update quantity')
    }
  }

  // Remove item from order
  const handleRemoveItem = async (orderId: string, itemId: string) => {
    try {
      const res = await fetch(`/api/restaurant-orders/${orderId}/items/${itemId}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed')
      toast.success('Item removed')
      fetchData()
    } catch {
      toast.error('Failed to remove item')
    }
  }

  // Fetch menu items for adding
  const fetchMenuItems = useCallback(async (search: string) => {
    try {
      const params = new URLSearchParams({ pageSize: '20', type: 'product' })
      if (search) params.set('search', search)
      const res = await fetch(`/api/items?${params}`)
      if (res.ok) {
        const data = await res.json()
        setMenuItems(Array.isArray(data) ? data : (data.data || []))
      }
    } catch {
      // silent
    }
  }, [])

  useEffect(() => {
    if (showAddItem) {
      fetchMenuItems(menuSearch)
    }
  }, [showAddItem, menuSearch, fetchMenuItems])

  // Toggle order expansion
  const toggleOrder = (orderId: string) => {
    setExpandedOrders(prev => {
      const next = new Set(prev)
      if (next.has(orderId)) next.delete(orderId)
      else next.add(orderId)
      return next
    })
  }

  // Time ago helper
  const timeAgo = (dateStr: string) => {
    const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000)
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    return `${hrs}h ${mins % 60}m ago`
  }

  if (loading) return <PageLoading />

  const myAssignedTables = tables.filter(t => t.serverId === userId)
  const occupiedTables = tables.filter(t => t.status === 'occupied')
  const availableTables = tables.filter(t => t.status === 'available')
  const myOrders = activeOrders.filter(o => o.status === 'open')

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 pb-20">
      {/* Header */}
      <div className="bg-white dark:bg-gray-900 border-b dark:border-gray-800 sticky top-0 z-10">
        <div className="px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-bold text-gray-900 dark:text-white">Waitstaff</h1>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {myAssignedTables.length} assigned tables &middot; {myOrders.length} active orders
                {isRealtime && <span className="ml-1 text-green-500">&#9679;</span>}
              </p>
            </div>
            <button
              onClick={() => {
                setSelectedTable(null)
                setShowNewOrder(true)
              }}
              className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 active:bg-blue-800 transition-colors"
            >
              <Plus className="h-4 w-4" />
              New Order
            </button>
          </div>

          {/* View toggle */}
          <div className="flex gap-1 mt-3 bg-gray-100 dark:bg-gray-800 rounded p-0.5">
            <button
              onClick={() => setViewMode('tables')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-sm font-medium transition-colors ${
                viewMode === 'tables'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              <UtensilsCrossed className="h-3.5 w-3.5" />
              Tables
            </button>
            <button
              onClick={() => setViewMode('orders')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-sm font-medium transition-colors ${
                viewMode === 'orders'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              <Coffee className="h-3.5 w-3.5" />
              Orders ({myOrders.length})
            </button>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-2 px-4 py-3">
        <div className="bg-white dark:bg-gray-900 rounded border dark:border-gray-800 p-3 text-center">
          <div className="text-2xl font-bold text-green-600">{availableTables.length}</div>
          <div className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wide">Available</div>
        </div>
        <div className="bg-white dark:bg-gray-900 rounded border dark:border-gray-800 p-3 text-center">
          <div className="text-2xl font-bold text-red-600">{occupiedTables.length}</div>
          <div className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wide">Occupied</div>
        </div>
        <div className="bg-white dark:bg-gray-900 rounded border dark:border-gray-800 p-3 text-center">
          <div className="text-2xl font-bold text-blue-600">{myOrders.length}</div>
          <div className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wide">Active</div>
        </div>
      </div>

      {/* Tables View */}
      {viewMode === 'tables' && (
        <div className="px-4 space-y-2">
          {tables.length === 0 ? (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              <UtensilsCrossed className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No tables assigned</p>
              <p className="text-sm mt-1">Ask your manager to assign tables to you</p>
            </div>
          ) : (
            tables.map(table => {
              const order = getTableOrder(table.id)
              return (
                <div
                  key={table.id}
                  className={`bg-white dark:bg-gray-900 rounded border dark:border-gray-800 overflow-hidden ${
                    table.status === 'occupied' ? 'border-l-4 border-l-red-500' : ''
                  }`}
                >
                  <div
                    className="flex items-center justify-between p-3 cursor-pointer active:bg-gray-50 dark:active:bg-gray-800"
                    onClick={() => {
                      if (order) {
                        setActiveOrderForTable(order)
                        toggleOrder(order.id)
                      } else if (table.status === 'available') {
                        setSelectedTable(table)
                        setShowNewOrder(true)
                      }
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`h-10 w-10 rounded flex items-center justify-center text-sm font-bold border ${statusColors[table.status] || statusColors.unavailable}`}>
                        {table.name.replace(/[^0-9]/g, '') || table.name.slice(0, 2)}
                      </div>
                      <div>
                        <div className="font-medium text-gray-900 dark:text-white text-sm">{table.name}</div>
                        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                          <span className="flex items-center gap-0.5">
                            <Users className="h-3 w-3" /> {table.capacity}
                          </span>
                          {table.area && <span>{table.area}</span>}
                          {table.occupiedAt && (
                            <span className="flex items-center gap-0.5">
                              <Clock className="h-3 w-3" /> {timeAgo(table.occupiedAt)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {order && (
                        <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                          {order.orderNo}
                        </span>
                      )}
                      {table.status === 'available' ? (
                        <Plus className="h-5 w-5 text-green-500" />
                      ) : (
                        <ChevronRight className="h-5 w-5 text-gray-400" />
                      )}
                    </div>
                  </div>

                  {/* Expanded order items */}
                  {order && expandedOrders.has(order.id) && (
                    <div className="border-t dark:border-gray-800 bg-gray-50 dark:bg-gray-950 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                          {order.items?.length || 0} items &middot; Total: {Number(order.total).toFixed(2)}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setActiveOrderForTable(order)
                            setShowAddItem(true)
                          }}
                          className="text-xs px-2 py-1 bg-blue-600 text-white rounded font-medium"
                        >
                          + Add Item
                        </button>
                      </div>
                      {order.items?.map(item => (
                        <div key={item.id} className="flex items-center justify-between py-1.5 border-b dark:border-gray-800 last:border-0">
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-gray-900 dark:text-white truncate">{item.itemName}</div>
                            {item.notes && (
                              <div className="text-xs text-orange-500 flex items-center gap-0.5">
                                <MessageSquare className="h-3 w-3" /> {item.notes}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2 ml-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                if (item.quantity > 1) handleUpdateItemQty(order.id, item.id, item.quantity - 1)
                                else handleRemoveItem(order.id, item.id)
                              }}
                              className="h-6 w-6 flex items-center justify-center rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
                            >
                              <Minus className="h-3 w-3" />
                            </button>
                            <span className="text-sm font-medium w-5 text-center text-gray-900 dark:text-white">{item.quantity}</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleUpdateItemQty(order.id, item.id, item.quantity + 1)
                              }}
                              className="h-6 w-6 flex items-center justify-center rounded-full bg-blue-600 text-white"
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                            <span className="text-xs text-gray-500 w-14 text-right">
                              {(Number(item.unitPrice) * item.quantity).toFixed(2)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}

      {/* Orders View */}
      {viewMode === 'orders' && (
        <div className="px-4 space-y-2">
          {myOrders.length === 0 ? (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              <Coffee className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No active orders</p>
              <p className="text-sm mt-1">Create an order from a table to get started</p>
            </div>
          ) : (
            myOrders.map(order => (
              <div key={order.id} className="bg-white dark:bg-gray-900 rounded border dark:border-gray-800 overflow-hidden">
                <button
                  onClick={() => toggleOrder(order.id)}
                  className="w-full flex items-center justify-between p-3 text-left active:bg-gray-50 dark:active:bg-gray-800"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      {order.orderType === 'dine_in' && <UtensilsCrossed className="h-4 w-4 text-purple-500" />}
                      {order.orderType === 'takeaway' && <ShoppingBag className="h-4 w-4 text-orange-500" />}
                      {order.orderType === 'delivery' && <Truck className="h-4 w-4 text-cyan-500" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-gray-900 dark:text-white">{order.orderNo}</span>
                        {order.table && (
                          <span className="text-xs px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-gray-600 dark:text-gray-300">
                            {order.table.name}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {order.items?.length || 0} items &middot; {timeAgo(order.createdAt)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">
                      {Number(order.total).toFixed(2)}
                    </span>
                    {expandedOrders.has(order.id) ? (
                      <ChevronUp className="h-4 w-4 text-gray-400" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-gray-400" />
                    )}
                  </div>
                </button>

                {expandedOrders.has(order.id) && (
                  <div className="border-t dark:border-gray-800 bg-gray-50 dark:bg-gray-950 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${orderStatusColors[order.status] || ''}`}>
                        {order.status}
                      </span>
                      <button
                        onClick={() => {
                          setActiveOrderForTable(order)
                          setShowAddItem(true)
                        }}
                        className="text-xs px-2 py-1 bg-blue-600 text-white rounded font-medium"
                      >
                        + Add Item
                      </button>
                    </div>
                    {order.items?.map(item => (
                      <div key={item.id} className="flex items-center justify-between py-1.5 border-b dark:border-gray-800 last:border-0">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm text-gray-900 dark:text-white">{item.itemName}</span>
                            {item.status === 'ready' && <CheckCircle className="h-3 w-3 text-green-500" />}
                            {item.status === 'preparing' && <Clock className="h-3 w-3 text-yellow-500" />}
                            {item.status === 'pending' && <AlertCircle className="h-3 w-3 text-gray-400" />}
                          </div>
                          {item.notes && (
                            <div className="text-xs text-orange-500">{item.notes}</div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 ml-2">
                          <button
                            onClick={() => {
                              if (item.quantity > 1) handleUpdateItemQty(order.id, item.id, item.quantity - 1)
                              else handleRemoveItem(order.id, item.id)
                            }}
                            className="h-6 w-6 flex items-center justify-center rounded-full bg-gray-200 dark:bg-gray-700"
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                          <span className="text-sm font-medium w-5 text-center">{item.quantity}</span>
                          <button
                            onClick={() => handleUpdateItemQty(order.id, item.id, item.quantity + 1)}
                            className="h-6 w-6 flex items-center justify-center rounded-full bg-blue-600 text-white"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                          <span className="text-xs text-gray-500 w-14 text-right">
                            {(Number(item.unitPrice) * item.quantity).toFixed(2)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* New Order Modal */}
      {showNewOrder && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center">
          <div className="bg-white dark:bg-gray-900 w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 animate-in slide-in-from-bottom">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">New Order</h3>
              <button onClick={() => setShowNewOrder(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Table selection (if not pre-selected) */}
            {!selectedTable && (
              <div className="mb-4">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block">Select Table</label>
                <div className="grid grid-cols-4 gap-2 max-h-40 overflow-y-auto">
                  {tables.filter(t => t.status === 'available').map(t => (
                    <button
                      key={t.id}
                      onClick={() => setSelectedTable(t)}
                      className="p-2 rounded border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-blue-300 text-center text-sm font-medium transition-colors"
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
                {tables.filter(t => t.status === 'available').length === 0 && (
                  <p className="text-sm text-gray-500 text-center py-4">No available tables</p>
                )}
              </div>
            )}

            {selectedTable && (
              <div className="mb-4 p-2 bg-blue-50 dark:bg-blue-900/20 rounded text-sm text-blue-700 dark:text-blue-300">
                Table: <strong>{selectedTable.name}</strong> (Capacity: {selectedTable.capacity})
              </div>
            )}

            {/* Order type */}
            <div className="mb-4">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block">Order Type</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { value: 'dine_in', label: 'Dine In', icon: UtensilsCrossed },
                  { value: 'takeaway', label: 'Takeaway', icon: ShoppingBag },
                  { value: 'delivery', label: 'Delivery', icon: Truck },
                ].map(type => (
                  <button
                    key={type.value}
                    onClick={() => setNewOrderType(type.value)}
                    className={`flex flex-col items-center gap-1 p-3 rounded border text-sm font-medium transition-colors ${
                      newOrderType === type.value
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                        : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'
                    }`}
                  >
                    <type.icon className="h-5 w-5" />
                    {type.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Guest count */}
            <div className="mb-6">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block">Guests</label>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setNewOrderCustomerCount(Math.max(1, newOrderCustomerCount - 1))}
                  className="h-10 w-10 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="text-2xl font-bold text-gray-900 dark:text-white w-10 text-center">
                  {newOrderCustomerCount}
                </span>
                <button
                  onClick={() => setNewOrderCustomerCount(newOrderCustomerCount + 1)}
                  className="h-10 w-10 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>

            <button
              onClick={handleCreateOrder}
              disabled={creatingOrder || (!selectedTable && newOrderType === 'dine_in')}
              className="w-full py-3 bg-blue-600 text-white rounded-md font-medium text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {creatingOrder ? 'Creating...' : 'Create Order'}
            </button>
          </div>
        </div>
      )}

      {/* Add Item Sheet */}
      {showAddItem && activeOrderForTable && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end justify-center">
          <div className="bg-white dark:bg-gray-900 w-full rounded-t-2xl max-h-[85vh] flex flex-col animate-in slide-in-from-bottom">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b dark:border-gray-800">
              <div>
                <h3 className="font-bold text-gray-900 dark:text-white">Add Items</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Order {activeOrderForTable.orderNo}
                  {activeOrderForTable.table && ` - ${activeOrderForTable.table.name}`}
                </p>
              </div>
              <button
                onClick={() => {
                  setShowAddItem(false)
                  setMenuSearch('')
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Search */}
            <div className="p-3 border-b dark:border-gray-800">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  value={menuSearch}
                  onChange={e => setMenuSearch(e.target.value)}
                  placeholder="Search menu items..."
                  className="w-full pl-9 pr-3 py-2.5 bg-gray-100 dark:bg-gray-800 border-0 rounded text-sm focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-white placeholder-gray-400"
                  autoFocus
                />
              </div>
            </div>

            {/* Notes input */}
            <div className="px-3 py-2 border-b dark:border-gray-800">
              <input
                type="text"
                value={itemNotes}
                onChange={e => setItemNotes(e.target.value)}
                placeholder="Special instructions (optional)..."
                className="w-full px-3 py-1.5 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded text-sm text-gray-900 dark:text-white placeholder-gray-400"
              />
            </div>

            {/* Menu items */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              {menuItems.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Search className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Search for menu items</p>
                </div>
              ) : (
                menuItems.map(item => (
                  <button
                    key={item.id}
                    onClick={() => handleAddItem(item)}
                    disabled={addingItem}
                    className="w-full flex items-center justify-between p-3 rounded hover:bg-gray-50 dark:hover:bg-gray-800 active:bg-gray-100 dark:active:bg-gray-700 transition-colors text-left"
                  >
                    <div>
                      <div className="text-sm font-medium text-gray-900 dark:text-white">{item.name}</div>
                      {item.category && (
                        <div className="text-xs text-gray-500 dark:text-gray-400">{item.category}</div>
                      )}
                    </div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">
                      {Number(item.sellingPrice).toFixed(2)}
                    </div>
                  </button>
                ))
              )}
            </div>

            {/* Current order summary */}
            {activeOrderForTable.items && activeOrderForTable.items.length > 0 && (
              <div className="border-t dark:border-gray-800 p-3 bg-gray-50 dark:bg-gray-950">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500 dark:text-gray-400">
                    {activeOrderForTable.items.length} items in order
                  </span>
                  <span className="font-bold text-gray-900 dark:text-white">
                    Total: {Number(activeOrderForTable.total).toFixed(2)}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
