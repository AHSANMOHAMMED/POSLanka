'use client'

import { useState, useCallback, useMemo } from 'react'
import { EditableGrid, ColumnDef } from '@/components/ui/editable-grid'
import { LinkFieldOption } from '@/components/ui/link-field'
import { AlertModal } from '@/components/ui/alert-modal'
import { toast } from '@/components/ui/toast'
import { formatItemLabel } from '@/lib/utils/item-display'

interface Item {
  id: string
  name: string
  barcode?: string
  sku?: string
  oemPartNumber?: string
  pluCode?: string
  sellingPrice: string
  currentStock: string
  reservedStock: string
  availableStock: string
}

interface WorkOrderPart {
  id: string
  itemId: string
  quantity: string
  unitPrice: string
  total: string
  coreCharge: string | null
  item: Item | null
}

// Grid row type - flattened for editing
interface PartGridRow {
  [key: string]: unknown
  id: string
  itemId: string
  itemName: string
  itemDisplayName: string
  itemSku?: string
  itemBarcode?: string
  itemOemPartNumber?: string
  quantity: number
  unitPrice: number
  coreCharge: number
  total: number
  availableStock: number
  isNew?: boolean
}

interface WorkOrderPartsGridProps {
  workOrderId: string
  parts: WorkOrderPart[]
  items: Item[]
  canModify: boolean
  onRefresh: () => void
  onSaved?: () => void
  searchItems: (search: string) => Promise<LinkFieldOption[]>
  onCreateItem?: (name: string) => void
  expectedUpdatedAt?: string | null
  onConflict?: () => void
  businessType?: string | null
}

function generateTempId(): string {
  return `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

export function WorkOrderPartsGrid({
  workOrderId,
  parts,
  items,
  canModify,
  onRefresh,
  onSaved,
  searchItems,
  onCreateItem,
  expectedUpdatedAt,
  onConflict,
  businessType,
}: WorkOrderPartsGridProps) {
  const [updating, setUpdating] = useState(false)
  const [localData, setLocalData] = useState<PartGridRow[]>([])
  const [alertModal, setAlertModal] = useState<{ open: boolean; title: string; message: string; variant: 'info' | 'warning' | 'error' | 'success' }>({
    open: false,
    title: '',
    message: '',
    variant: 'info',
  })

  // Convert parts to grid rows (source of truth from server)
  const serverData = useMemo(() => {
    return parts.map(part => {
      const name = part.item?.name || 'Unknown Item'
      const barcode = part.item?.barcode
      const oem = part.item?.oemPartNumber
      const sku = part.item?.sku
      return {
        id: part.id,
        itemId: part.itemId,
        itemName: name,
        itemDisplayName: formatItemLabel({ name, barcode, sku, oemPartNumber: oem }, businessType),
        itemBarcode: barcode || undefined,
        itemOemPartNumber: oem || undefined,
        itemSku: sku || undefined,
        quantity: parseFloat(part.quantity) || 0,
        unitPrice: parseFloat(part.unitPrice) || 0,
        coreCharge: parseFloat(part.coreCharge || '0') || 0,
        total: parseFloat(part.total) || 0,
        availableStock: parseFloat(part.item?.availableStock || '0') || 0,
      }
    })
  }, [parts, businessType])

  // Use local data if we have pending edits, otherwise use server data
  const gridData = localData.length > 0 ? localData : serverData

  // Handle local data changes (for manual save mode)
  const handleDataChange = useCallback((newData: PartGridRow[]) => {
    setLocalData(newData)
  }, [])

  // Column definitions
  const columns = useMemo((): ColumnDef<PartGridRow>[] => [
    {
      key: 'itemDisplayName',
      label: 'Part',
      type: 'link',
      width: '35%',
      editable: canModify,
      fetchOptions: searchItems,
      onCreateNew: onCreateItem,
      createLabel: 'Add item',
      placeholder: 'Search parts...',
      onChange: (value, _row, _index, option) => {
        const name = option?.data?.name as string || option?.label || ''
        const barcode = option?.data?.barcode as string || undefined
        const oem = option?.data?.oemPartNumber as string || undefined
        const sku = option?.data?.sku as string || undefined
        return {
          itemId: value as string,
          itemName: name,
          itemDisplayName: formatItemLabel({ name, barcode, sku, oemPartNumber: oem }, businessType),
          itemBarcode: barcode,
          itemOemPartNumber: oem,
          itemSku: sku,
          unitPrice: parseFloat(option?.data?.sellingPrice as string || '0'),
        }
      },
    },
    {
      key: 'quantity',
      label: 'Qty',
      type: 'number',
      width: '10%',
      align: 'right',
      editable: canModify,
      min: 0.01,
      step: 1,
      precision: 0,
    },
    {
      key: 'unitPrice',
      label: 'Unit Price',
      type: 'currency',
      width: '15%',
      align: 'right',
      editable: canModify,
      min: 0,
      step: 0.01,
      precision: 2,
    },
    {
      key: 'coreCharge',
      label: 'Core',
      type: 'currency',
      width: '12%',
      align: 'right',
      editable: canModify,
      min: 0,
      step: 0.01,
      precision: 2,
    },
    {
      key: 'total',
      label: 'Total',
      type: 'readonly',
      width: '15%',
      align: 'right',
      calculate: (row) => (row.quantity * row.unitPrice) + row.coreCharge,
      render: (value) => {
        const num = typeof value === 'number' ? value : 0
        return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      },
    },
    {
      key: 'availableStock',
      label: 'Stock',
      type: 'readonly',
      width: '13%',
      align: 'right',
      render: (value, row) => {
        const stock = typeof value === 'number' ? value : 0
        const lowStock = stock < row.quantity
        return (
          <span className={lowStock ? 'text-red-600 font-medium' : 'text-gray-500'}>
            {stock.toFixed(0)}
          </span>
        )
      },
    },
  ], [canModify, searchItems, onCreateItem, businessType])

  // Handle batch saving of dirty rows (manual save mode)
  const handleSaveChanges = useCallback(async (
    dirtyRows: { row: PartGridRow; index: number; changes: Record<string, unknown> }[],
    deletedRows?: PartGridRow[]
  ) => {
    setUpdating(true)
    let hasErrors = false
    // Track latest updatedAt locally to avoid stale closure issues.
    // Each API call bumps updatedAt on the server; we must send the latest value.
    let latestUpdatedAt = expectedUpdatedAt

    try {
      // Process deletions first
      if (deletedRows && deletedRows.length > 0) {
        for (const row of deletedRows) {
          if (row.id.startsWith('temp-')) continue // Skip temp rows

          const res = await fetch(`/api/work-orders/${workOrderId}/parts?partId=${row.id}`, {
            method: 'DELETE',
          })

          if (!res.ok) {
            const data = await res.json()
            setAlertModal({ open: true, title: 'Error', message: data.error || 'Failed to delete part', variant: 'error' })
            hasErrors = true
            break
          }
          const data = await res.json()
          if (data?.workOrderUpdatedAt) latestUpdatedAt = data.workOrderUpdatedAt
        }
      }

      // Process updates
      if (!hasErrors) {
        for (const { row, changes } of dirtyRows) {
          // Skip temp rows (new rows handled separately)
          if (row.id.startsWith('temp-')) continue

          // Validate quantity
          if ('quantity' in changes) {
            const newQty = changes.quantity as number
            if (newQty <= 0) {
              setAlertModal({ open: true, title: 'Validation Error', message: 'Quantity must be greater than zero', variant: 'error' })
              hasErrors = true
              break
            }
            if (newQty > row.availableStock) {
              setAlertModal({
                open: true,
                title: 'Insufficient Stock',
                message: `Only ${row.availableStock.toFixed(0)} available for ${row.itemName}`,
                variant: 'warning'
              })
              hasErrors = true
              break
            }
          }

          // Build update payload with only changed fields
          const updatePayload: Record<string, unknown> = { partId: row.id }
          if ('quantity' in changes) updatePayload.quantity = changes.quantity
          if ('unitPrice' in changes) updatePayload.unitPrice = changes.unitPrice
          if ('coreCharge' in changes) updatePayload.coreCharge = changes.coreCharge
          if (latestUpdatedAt) updatePayload.expectedUpdatedAt = latestUpdatedAt

          const res = await fetch(`/api/work-orders/${workOrderId}/parts`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatePayload),
          })

          if (res.status === 409) {
            onConflict?.()
            setAlertModal({
              open: true,
              title: 'Conflict',
              message: 'This work order was modified by another user. Please refresh.',
              variant: 'warning'
            })
            hasErrors = true
            break
          }

          if (!res.ok) {
            const data = await res.json()
            setAlertModal({ open: true, title: 'Error', message: data.error || 'Failed to update part', variant: 'error' })
            hasErrors = true
            break
          }
          const data = await res.json()
          if (data?.workOrderUpdatedAt) latestUpdatedAt = data.workOrderUpdatedAt
        }
      }

      if (!hasErrors) {
        toast.success('Parts updated')
        setLocalData([]) // Clear local changes
        onRefresh()
        onSaved?.()
      } else {
        // Refresh to sync UI with server state after partial save
        onRefresh()
      }
    } catch (error) {
      console.error('Error saving parts:', error)
      setAlertModal({ open: true, title: 'Error', message: 'Failed to save changes', variant: 'error' })
    } finally {
      setUpdating(false)
    }
  }, [workOrderId, expectedUpdatedAt, onRefresh, onSaved, onConflict])

  // Handle adding new row
  const handleRowAdd = useCallback((): PartGridRow => {
    return {
      id: generateTempId(),
      itemId: '',
      itemName: '',
      itemDisplayName: '',
      quantity: 1,
      unitPrice: 0,
      coreCharge: 0,
      total: 0,
      availableStock: 0,
      isNew: true,
    }
  }, [])

  // Handle deleting row
  const handleRowDelete = useCallback(async (row: PartGridRow) => {
    if (row.id.startsWith('temp-')) {
      // Just remove from local state - it's not saved yet
      return
    }

    setUpdating(true)
    try {
      const res = await fetch(`/api/work-orders/${workOrderId}/parts?partId=${row.id}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        onRefresh()
        onSaved?.()
      } else {
        const data = await res.json()
        setAlertModal({ open: true, title: 'Error', message: data.error || 'Failed to delete part', variant: 'error' })
      }
    } catch (error) {
      console.error('Error deleting part:', error)
      setAlertModal({ open: true, title: 'Error', message: 'Failed to delete part', variant: 'error' })
    } finally {
      setUpdating(false)
    }
  }, [workOrderId, onRefresh, onSaved])

  // Handle grid data changes (for new rows being saved)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleGridChange = useCallback(async (newData: PartGridRow[]) => {
    // Find new rows that need to be saved
    const newRows = newData.filter(row => row.isNew && row.itemId && row.quantity > 0)

    for (const row of newRows) {
      // Check stock before adding
      const item = items.find(i => i.id === row.itemId)
      if (item) {
        const availableStock = parseFloat(item.availableStock)
        if (row.quantity > availableStock) {
          setAlertModal({
            open: true,
            title: 'Insufficient Stock',
            message: `Only ${availableStock.toFixed(0)} available for ${item.name}`,
            variant: 'warning'
          })
          continue
        }
      }

      setUpdating(true)
      try {
        const res = await fetch(`/api/work-orders/${workOrderId}/parts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            itemId: row.itemId,
            quantity: row.quantity,
            unitPrice: row.unitPrice || undefined,
            coreCharge: row.coreCharge || 0,
          }),
        })
        if (res.ok) {
          onRefresh()
          onSaved?.()
        } else {
          const data = await res.json()
          setAlertModal({ open: true, title: 'Error', message: data.error || 'Failed to add part', variant: 'error' })
        }
      } catch (error) {
        console.error('Error adding part:', error)
        setAlertModal({ open: true, title: 'Error', message: 'Failed to add part', variant: 'error' })
      } finally {
        setUpdating(false)
      }
    }
  }, [workOrderId, items, onRefresh, onSaved])

  return (
    <>
      <EditableGrid
        columns={columns}
        data={gridData}
        onChange={handleDataChange}
        onRowAdd={canModify ? handleRowAdd : undefined}
        onRowDelete={canModify ? handleRowDelete : undefined}
        manualSave={canModify}
        onSaveChanges={handleSaveChanges}
        showRowNumbers
        showDeleteButton={canModify}
        showAddButton={canModify}
        addButtonLabel="Add Part"
        emptyMessage="No parts added"
        disabled={!canModify}
        loading={updating}
        footerTotals={[
          { key: 'itemName', label: 'Total:' },
          { key: 'total' },
        ]}
        highlightNewRows
      />

      <AlertModal
        isOpen={alertModal.open}
        onClose={() => setAlertModal({ ...alertModal, open: false })}
        title={alertModal.title}
        message={alertModal.message}
        variant={alertModal.variant}
      />
    </>
  )
}
