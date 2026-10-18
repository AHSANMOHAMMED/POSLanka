'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Trash2, Plus, GripVertical } from 'lucide-react'
import { LinkField, LinkFieldOption } from './link-field'
import { formatCurrency } from '@/lib/utils/currency'

export interface GridItem {
  id: string
  itemId: string | null
  itemName: string
  itemSku?: string | null
  quantity: number
  unitPrice: number
  tax: number
  total: number
  uom?: string
  isNew?: boolean // Flag for newly added rows
}

export interface EditableItemsGridProps {
  items: GridItem[]
  onChange: (items: GridItem[]) => void
  onItemSearch: (search: string) => Promise<LinkFieldOption[]>
  onCreateItem?: (name: string) => void
  disabled?: boolean
  showTax?: boolean
  showUom?: boolean
  className?: string
}

function generateTempId(): string {
  return `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

function calculateItemTotal(item: GridItem): number {
  return (item.quantity * item.unitPrice) + item.tax
}

function createEmptyRow(): GridItem {
  return {
    id: generateTempId(),
    itemId: null,
    itemName: '',
    quantity: 0,
    unitPrice: 0,
    tax: 0,
    total: 0,
    isNew: true,
  }
}

export function EditableItemsGrid({
  items,
  onChange,
  onItemSearch,
  onCreateItem,
  disabled = false,
  showTax = false,
  showUom = false,
  className = '',
}: EditableItemsGridProps) {
  const isInternalUpdate = useRef(false)

  // Initialize local items - always ensure at least one empty row
  const [localItems, setLocalItems] = useState<GridItem[]>(() => {
    if (items.length === 0) {
      return [createEmptyRow()]
    }
    // Check if there's already an empty row at the end
    const lastItem = items[items.length - 1]
    if (lastItem && !lastItem.itemId) {
      return items
    }
    return [...items, createEmptyRow()]
  })

  // Sync with external items - only when external changes come in
  useEffect(() => {
    if (isInternalUpdate.current) {
      isInternalUpdate.current = false
      return
    }

    if (items.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLocalItems([createEmptyRow()])
    } else {
      // Check if there's already an empty row at the end
      const lastItem = items[items.length - 1]
      if (lastItem && !lastItem.itemId) {
        setLocalItems(items)
      } else {
        setLocalItems([...items, createEmptyRow()])
      }
    }
  }, [items])

  const notifyParent = useCallback((newItems: GridItem[]) => {
    // Only notify parent of items that have been selected (have itemId)
    const validItems = newItems.filter(item => item.itemId && item.quantity > 0)
    isInternalUpdate.current = true
    onChange(validItems)
  }, [onChange])

  const handleItemSelect = useCallback((index: number, value: string, option?: LinkFieldOption) => {
    setLocalItems(prevItems => {
      const newItems = [...prevItems]
      const item = { ...newItems[index] }

      if (option && value) {
        item.itemId = value
        item.itemName = option.label.split(' (')[0] // Remove SKU from label
        item.itemSku = option.sublabel || null
        // Auto-fill price from item data if available
        if (option.data?.costPrice) {
          item.unitPrice = parseFloat(option.data.costPrice as string) || 0
        }
        if (option.data?.sellingPrice && !option.data?.costPrice) {
          item.unitPrice = parseFloat(option.data.sellingPrice as string) || 0
        }
        // Set default quantity if empty
        if (item.quantity === 0) {
          item.quantity = 1
        }
        item.isNew = false
      } else {
        item.itemId = null
        item.itemName = ''
        item.itemSku = null
        item.unitPrice = 0
      }

      item.total = calculateItemTotal(item)
      newItems[index] = item

      // Add a new empty row if this was the last row and now has an item
      if (index === newItems.length - 1 && item.itemId) {
        newItems.push(createEmptyRow())
      }

      notifyParent(newItems)
      return newItems
    })
  }, [notifyParent])

  const handleQuantityChange = useCallback((index: number, value: string) => {
    setLocalItems(prevItems => {
      const newItems = [...prevItems]
      const qty = parseFloat(value) || 0
      newItems[index] = {
        ...newItems[index],
        quantity: qty,
        total: calculateItemTotal({ ...newItems[index], quantity: qty })
      }
      notifyParent(newItems)
      return newItems
    })
  }, [notifyParent])

  const handlePriceChange = useCallback((index: number, value: string) => {
    setLocalItems(prevItems => {
      const newItems = [...prevItems]
      const price = parseFloat(value) || 0
      newItems[index] = {
        ...newItems[index],
        unitPrice: price,
        total: calculateItemTotal({ ...newItems[index], unitPrice: price })
      }
      notifyParent(newItems)
      return newItems
    })
  }, [notifyParent])

  const handleTaxChange = useCallback((index: number, value: string) => {
    setLocalItems(prevItems => {
      const newItems = [...prevItems]
      const tax = parseFloat(value) || 0
      newItems[index] = {
        ...newItems[index],
        tax: tax,
        total: calculateItemTotal({ ...newItems[index], tax: tax })
      }
      notifyParent(newItems)
      return newItems
    })
  }, [notifyParent])

  const handleDeleteRow = useCallback((index: number) => {
    setLocalItems(prevItems => {
      const newItems = prevItems.filter((_, i) => i !== index)

      // Ensure at least one empty row exists
      const hasEmptyRow = newItems.some(item => !item.itemId)
      if (newItems.length === 0 || !hasEmptyRow) {
        newItems.push(createEmptyRow())
      }

      notifyParent(newItems)
      return newItems
    })
  }, [notifyParent])

  const handleAddRow = useCallback(() => {
    setLocalItems(prevItems => {
      const newItems = [...prevItems, createEmptyRow()]
      // Don't notify parent for empty rows - parent only cares about valid items
      return newItems
    })
  }, [])

  // Calculate totals from local items (excluding empty rows)
  const filledItems = localItems.filter(item => item.itemId)
  const subtotal = filledItems.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0)
  const totalTax = filledItems.reduce((sum, item) => sum + item.tax, 0)
  const grandTotal = subtotal + totalTax

  return (
    <div className={`border dark:border-gray-700 rounded overflow-hidden ${className}`}>
      <table className="w-full">
        <thead className="bg-gray-50 dark:bg-gray-700">
          <tr>
            <th className="w-10 px-2 py-2 text-center text-xs font-medium text-gray-500 dark:text-gray-400">#</th>
            <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Item</th>
            <th className="w-24 px-2 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">Qty</th>
            {showUom && (
              <th className="w-20 px-2 py-2 text-center text-xs font-medium text-gray-500 dark:text-gray-400">UOM</th>
            )}
            <th className="w-28 px-2 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">Rate</th>
            {showTax && (
              <th className="w-24 px-2 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">Tax</th>
            )}
            <th className="w-28 px-2 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">Amount</th>
            <th className="w-10 px-2 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {localItems.map((item, index) => (
            <tr
              key={item.id}
              className={`
                border-t dark:border-gray-700
                ${item.isNew && !item.itemId ? 'bg-gray-50/50 dark:bg-gray-800/50' : ''}
              `}
            >
              {/* Row Number */}
              <td className="px-2 py-1.5 text-center">
                <div className="flex items-center justify-center gap-1">
                  <GripVertical size={12} className="text-gray-300 dark:text-gray-600 cursor-grab" />
                  <span className="text-xs text-gray-400 dark:text-gray-500">{index + 1}</span>
                </div>
              </td>

              {/* Item Link Field */}
              <td className="px-2 py-1.5">
                <LinkField
                  value={item.itemId || ''}
                  onChange={(value, option) => handleItemSelect(index, value, option)}
                  fetchOptions={onItemSearch}
                  onCreateNew={onCreateItem}
                  placeholder="Select item..."
                  createLabel="Create new Item"
                  disabled={disabled}
                  displayValue={item.itemName}
                />
              </td>

              {/* Quantity */}
              <td className="px-2 py-1.5">
                <input
                  type="number"
                  value={item.quantity || ''}
                  onChange={(e) => handleQuantityChange(index, e.target.value)}
                  disabled={disabled || !item.itemId}
                  min="0"
                  step="any"
                  placeholder="0"
                  className="w-full px-2 py-1.5 text-right text-sm border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white disabled:opacity-50 disabled:bg-gray-50 dark:disabled:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </td>

              {/* UOM */}
              {showUom && (
                <td className="px-2 py-1.5 text-center text-sm text-gray-500 dark:text-gray-400">
                  {item.uom || 'Nos'}
                </td>
              )}

              {/* Rate/Price */}
              <td className="px-2 py-1.5">
                <input
                  type="number"
                  value={item.unitPrice || ''}
                  onChange={(e) => handlePriceChange(index, e.target.value)}
                  disabled={disabled || !item.itemId}
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  className="w-full px-2 py-1.5 text-right text-sm border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white disabled:opacity-50 disabled:bg-gray-50 dark:disabled:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </td>

              {/* Tax */}
              {showTax && (
                <td className="px-2 py-1.5">
                  <input
                    type="number"
                    value={item.tax || ''}
                    onChange={(e) => handleTaxChange(index, e.target.value)}
                    disabled={disabled || !item.itemId}
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    className="w-full px-2 py-1.5 text-right text-sm border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white disabled:opacity-50 disabled:bg-gray-50 dark:disabled:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </td>
              )}

              {/* Amount */}
              <td className="px-2 py-1.5 text-right text-sm font-medium dark:text-white">
                {item.itemId ? formatCurrency(item.total) : '-'}
              </td>

              {/* Delete */}
              <td className="px-2 py-1.5 text-center">
                {(item.itemId || localItems.length > 1) && (
                  <button
                    type="button"
                    onClick={() => handleDeleteRow(index)}
                    disabled={disabled}
                    className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/50 rounded disabled:opacity-50"
                    title="Remove row"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>

        {/* Footer with Totals */}
        <tfoot className="bg-gray-50 dark:bg-gray-700">
          <tr className="border-t dark:border-gray-600">
            <td colSpan={showUom ? 4 : 3} className="px-2 py-2">
              <button
                type="button"
                onClick={handleAddRow}
                disabled={disabled}
                className="flex items-center gap-1 px-3 py-1 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/50 rounded disabled:opacity-50"
              >
                <Plus size={14} />
                Add Row
              </button>
            </td>
            <td className="px-2 py-2 text-right text-xs text-gray-500 dark:text-gray-400">Subtotal</td>
            {showTax && <td></td>}
            <td className="px-2 py-2 text-right text-sm font-medium dark:text-white">
              {formatCurrency(subtotal)}
            </td>
            <td></td>
          </tr>
          {showTax && (
            <tr>
              <td colSpan={showUom ? 4 : 3}></td>
              <td className="px-2 py-1 text-right text-xs text-gray-500 dark:text-gray-400">Tax</td>
              <td></td>
              <td className="px-2 py-1 text-right text-sm font-medium dark:text-white">
                {formatCurrency(totalTax)}
              </td>
              <td></td>
            </tr>
          )}
          <tr className="border-t dark:border-gray-600">
            <td colSpan={showUom ? 4 : 3}></td>
            <td className="px-2 py-2 text-right text-sm font-semibold dark:text-white">Total</td>
            {showTax && <td></td>}
            <td className="px-2 py-2 text-right text-base font-bold text-blue-600 dark:text-blue-400">
              {formatCurrency(grandTotal)}
            </td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
