'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { ArrowRightLeft, ChevronLeft, Warehouse, Search, Plus, Minus, Trash2, Loader2 } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { WarehouseSelector } from '@/components/ui/warehouse-selector'

interface TransferItem {
  itemId: string
  name: string
  sku: string | null
  availableStock: number
  quantity: number
}

interface Item {
  id: string
  name: string
  sku: string | null
  currentStock: string
  availableStock: string
}

export default function NewStockTransferPage() {
  const router = useRouter()
  const { data: session } = useSession()
  const tenantSlug = session?.user?.tenantSlug || ''
  const [fromWarehouseId, setFromWarehouseId] = useState<string | null>(null)
  const [toWarehouseId, setToWarehouseId] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<TransferItem[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [submitAndRequest, setSubmitAndRequest] = useState(false)

  // Item search
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<Item[]>([])
  const [searching, setSearching] = useState(false)
  const [showResults, setShowResults] = useState(false)

  // Search for items in the source warehouse
  const searchItems = useCallback(async (query: string) => {
    if (!query.trim() || !fromWarehouseId) {
      setSearchResults([])
      return
    }

    setSearching(true)
    try {
      const params = new URLSearchParams({
        search: query,
        warehouseId: fromWarehouseId,
        pageSize: '20',
        all: 'true',
      })
      const res = await fetch(`/api/items?${params}`)
      if (res.ok) {
        const data = await res.json()
        const itemsArray = Array.isArray(data) ? data : []
        // Filter out items already in the list and those with no stock
        const filtered = itemsArray.filter((item: Item) =>
          parseFloat(item.availableStock) > 0 &&
          !items.some((i: TransferItem) => i.itemId === item.id)
        )
        setSearchResults(filtered)
      }
    } catch (error) {
      console.error('Error searching items:', error)
    } finally {
      setSearching(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromWarehouseId])

  useEffect(() => {
    const timeout = setTimeout(() => {
      searchItems(search)
    }, 300)
    return () => clearTimeout(timeout)
  }, [search, searchItems])

  function addItem(item: Item) {
    const available = parseFloat(item.availableStock)
    setItems([...items, {
      itemId: item.id,
      name: item.name,
      sku: item.sku,
      availableStock: available,
      quantity: 1,
    }])
    setSearch('')
    setSearchResults([])
    setShowResults(false)
  }

  function updateQuantity(index: number, delta: number) {
    const newItems = [...items]
    const item = newItems[index]
    const newQty = Math.max(1, Math.min(item.availableStock, item.quantity + delta))
    newItems[index] = { ...item, quantity: newQty }
    setItems(newItems)
  }

  function setQuantity(index: number, value: string) {
    const qty = parseInt(value) || 1
    const newItems = [...items]
    const item = newItems[index]
    newItems[index] = { ...item, quantity: Math.max(1, Math.min(item.availableStock, qty)) }
    setItems(newItems)
  }

  function removeItem(index: number) {
    setItems(items.filter((_, i) => i !== index))
  }

  async function handleSubmit(requestApproval: boolean = false) {
    if (!fromWarehouseId) {
      toast.error('Please select a source warehouse')
      return
    }
    if (!toWarehouseId) {
      toast.error('Please select a destination warehouse')
      return
    }
    if (fromWarehouseId === toWarehouseId) {
      toast.error('Source and destination warehouses must be different')
      return
    }
    if (items.length === 0) {
      toast.error('Please add at least one item to transfer')
      return
    }

    setSubmitting(true)
    setSubmitAndRequest(requestApproval)

    try {
      // Create the transfer
      const res = await fetch('/api/stock-transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromWarehouseId,
          toWarehouseId,
          notes: notes.trim() || null,
          items: items.map(i => ({
            itemId: i.itemId,
            quantity: i.quantity,
          })),
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || 'Failed to create transfer')
        return
      }

      const transfer = await res.json()

      // If requesting approval, update status
      if (requestApproval) {
        const approvalRes = await fetch(`/api/stock-transfers/${transfer.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'submit_for_approval' }),
        })

        if (approvalRes.ok) {
          toast.success('Transfer created and submitted for approval')
        } else {
          toast.success('Transfer created as draft')
        }
      } else {
        toast.success('Transfer created as draft')
      }

      router.push(`/c/${tenantSlug}/stock-transfers/${transfer.id}`)
    } catch (error) {
      console.error('Error creating transfer:', error)
      toast.error('Failed to create transfer')
    } finally {
      setSubmitting(false)
      setSubmitAndRequest(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <Link href={`/c/${tenantSlug}/stock-transfers`} className="p-2 hover:bg-gray-100 rounded">
          <ChevronLeft size={20} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ArrowRightLeft size={24} />
            New Stock Transfer
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Transfer inventory between warehouses
          </p>
        </div>
      </div>

      <div className="bg-white rounded-md border p-6 space-y-6">
        {/* Warehouse Selection */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <Warehouse size={16} className="inline mr-1" />
              From Warehouse *
            </label>
            <WarehouseSelector
              value={fromWarehouseId}
              onChange={(id) => {
                setFromWarehouseId(id)
                // Clear items when changing source warehouse
                if (id !== fromWarehouseId) {
                  setItems([])
                }
              }}
              required
              placeholder="Select source warehouse"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <Warehouse size={16} className="inline mr-1" />
              To Warehouse *
            </label>
            <WarehouseSelector
              value={toWarehouseId}
              onChange={setToWarehouseId}
              required
              placeholder="Select destination warehouse"
            />
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Notes
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
            placeholder="Optional notes for this transfer..."
          />
        </div>

        {/* Item Search */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Add Items *
          </label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              placeholder={fromWarehouseId ? "Search items by name or SKU..." : "Select source warehouse first"}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setShowResults(true)
              }}
              onFocus={() => setShowResults(true)}
              disabled={!fromWarehouseId}
              className="w-full pl-10 pr-4 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
            />
            {searching && (
              <Loader2 size={20} className="absolute right-3 top-1/2 transform -translate-y-1/2 animate-spin text-gray-400" />
            )}
          </div>

          {/* Search Results Dropdown */}
          {showResults && searchResults.length > 0 && (
            <div className="absolute z-10 w-full mt-1 bg-white border rounded shadow-lg max-h-60 overflow-y-auto">
              {searchResults.map((item) => (
                <button
                  key={item.id}
                  onClick={() => addItem(item)}
                  className="w-full px-4 py-3 text-left hover:bg-blue-50 flex justify-between items-center border-b last:border-b-0"
                >
                  <div>
                    <div className="font-medium">{item.name}</div>
                    <div className="text-sm text-gray-500">{item.sku || 'No SKU'}</div>
                  </div>
                  <div className="text-sm text-gray-500">
                    Available: {parseFloat(item.availableStock).toFixed(0)}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Items List */}
        {items.length > 0 && (
          <div className="border rounded overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Item</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Available</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600 w-48">Quantity</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-600 w-20"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((item, index) => (
                  <tr key={item.itemId}>
                    <td className="px-4 py-3">
                      <div className="font-medium">{item.name}</div>
                      <div className="text-sm text-gray-500">{item.sku || 'No SKU'}</div>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">
                      {item.availableStock.toFixed(0)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => updateQuantity(index, -1)}
                          disabled={item.quantity <= 1}
                          className="p-1 rounded border hover:bg-gray-100 disabled:opacity-50"
                        >
                          <Minus size={16} />
                        </button>
                        <input
                          type="number"
                          value={item.quantity}
                          onChange={(e) => setQuantity(index, e.target.value)}
                          min={1}
                          max={item.availableStock}
                          className="w-20 px-2 py-1 text-center border rounded"
                        />
                        <button
                          onClick={() => updateQuantity(index, 1)}
                          disabled={item.quantity >= item.availableStock}
                          className="p-1 rounded border hover:bg-gray-100 disabled:opacity-50"
                        >
                          <Plus size={16} />
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => removeItem(index)}
                        className="p-1.5 text-red-500 hover:bg-red-50 rounded"
                      >
                        <Trash2 size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {items.length === 0 && fromWarehouseId && (
          <div className="text-center py-8 text-gray-500 border-2 border-dashed rounded">
            Search and add items to transfer
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t">
          <Link
            href={`/c/${tenantSlug}/stock-transfers`}
            className="px-4 py-2 border rounded hover:bg-gray-50"
          >
            Cancel
          </Link>
          <button
            onClick={() => handleSubmit(false)}
            disabled={submitting || items.length === 0}
            className="px-4 py-2 border rounded hover:bg-gray-50 disabled:opacity-50 flex items-center gap-2"
          >
            {submitting && !submitAndRequest && <Loader2 size={16} className="animate-spin" />}
            Save as Draft
          </button>
          <button
            onClick={() => handleSubmit(true)}
            disabled={submitting || items.length === 0}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
          >
            {submitting && submitAndRequest && <Loader2 size={16} className="animate-spin" />}
            Create & Request Approval
          </button>
        </div>
      </div>
    </div>
  )
}
