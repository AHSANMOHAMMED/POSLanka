'use client'

import { useState, useCallback, useMemo } from 'react'
import { EditableGrid, ColumnDef } from '@/components/ui/editable-grid'
import { LinkFieldOption } from '@/components/ui/link-field'
import { AlertModal } from '@/components/ui/alert-modal'
import { toast } from '@/components/ui/toast'
import { formatItemLabel } from '@/lib/utils/item-display'

interface EstimateItem {
  id: string
  itemType: 'service' | 'part'
  itemId: string | null
  partName: string | null
  quantity: string | null
  unitPrice: string | null
  originalAmount: string
  approvedAmount: string | null
  status: 'pending' | 'approved' | 'price_adjusted' | 'rejected' | 'requires_reinspection'
  rejectionReason: string | null
  assessorNotes: string | null
  item?: { name: string } | null
}

// Grid row type - flattened for editing
interface PartGridRow {
  [key: string]: unknown
  id: string
  itemId: string
  itemName: string
  quantity: number
  unitPrice: number
  originalAmount: number
  approvedAmount: number | null
  status: string
  isNew?: boolean
}

interface EstimatePartsGridProps {
  estimateId: string
  items: EstimateItem[]
  canEdit: boolean
  canReview: boolean
  isCompleted: boolean
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

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  approved: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  price_adjusted: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  requires_reinspection: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
}

const statusLabels: Record<string, string> = {
  pending: 'Pending',
  approved: 'Approved',
  price_adjusted: 'Adjusted',
  rejected: 'Rejected',
  requires_reinspection: 'Re-inspect',
}

export function EstimatePartsGrid({
  estimateId,
  items,
  canEdit,
  canReview,
  isCompleted,
  onRefresh,
  onSaved,
  searchItems,
  onCreateItem,
  expectedUpdatedAt,
  onConflict,
  businessType,
}: EstimatePartsGridProps) {
  const [updating, setUpdating] = useState(false)
  const [localData, setLocalData] = useState<PartGridRow[]>([])
  const [alertModal, setAlertModal] = useState<{ open: boolean; title: string; message: string; variant: 'info' | 'warning' | 'error' | 'success' }>({
    open: false,
    title: '',
    message: '',
    variant: 'info',
  })

  // Filter to parts only (source of truth from server)
  const serverData = useMemo(() => {
    const partItems = items.filter(item => item.itemType === 'part')
    return partItems.map(item => ({
      id: item.id,
      itemId: item.itemId || '',
      itemName: item.item ? formatItemLabel(item.item as { name: string; barcode?: string; sku?: string; oemPartNumber?: string }, businessType) : (item.partName || 'Unknown Item'),
      quantity: parseFloat(item.quantity || '0') || 0,
      unitPrice: parseFloat(item.unitPrice || '0') || 0,
      originalAmount: parseFloat(item.originalAmount) || 0,
      approvedAmount: item.approvedAmount ? parseFloat(item.approvedAmount) : null,
      status: item.status,
    }))
  }, [items, businessType])

  // Use local data if we have pending edits, otherwise use server data
  const gridData = localData.length > 0 ? localData : serverData

  // Handle local data changes (for manual save mode)
  const handleDataChange = useCallback((newData: PartGridRow[]) => {
    setLocalData(newData)
  }, [])

  // Column definitions
  const columns = useMemo((): ColumnDef<PartGridRow>[] => {
    const cols: ColumnDef<PartGridRow>[] = [
      {
        key: 'itemName',
        label: 'Part',
        type: canEdit ? 'link' : 'readonly',
        width: canReview || isCompleted ? '25%' : '35%',
        editable: canEdit,
        fetchOptions: searchItems,
        onCreateNew: onCreateItem,
        createLabel: 'Add item',
        placeholder: 'Search parts...',
        onChange: (value, _row, _index, option) => ({
          itemId: value as string,
          itemName: option?.data?.name as string || option?.label || '',
          unitPrice: parseFloat(option?.data?.sellingPrice as string || '0'),
        }),
      },
      {
        key: 'quantity',
        label: 'Qty',
        type: canEdit ? 'number' : 'readonly',
        width: '8%',
        align: 'right',
        editable: canEdit,
        min: 0.01,
        step: 1,
        precision: 0,
      },
      {
        key: 'unitPrice',
        label: 'Unit Price',
        type: canEdit ? 'currency' : 'readonly',
        width: '12%',
        align: 'right',
        editable: canEdit,
        min: 0,
        step: 0.01,
        precision: 2,
      },
      {
        key: 'originalAmount',
        label: 'Amount',
        type: 'readonly',
        width: '13%',
        align: 'right',
        calculate: (row) => row.quantity * row.unitPrice,
        render: (value) => {
          const num = typeof value === 'number' ? value : 0
          return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        },
      },
    ]

    // Add approved column for review/completed states
    if (canReview || isCompleted) {
      cols.push({
        key: 'approvedAmount',
        label: 'Approved',
        type: canReview ? 'currency' : 'readonly',
        width: '13%',
        align: 'right',
        editable: canReview,
        min: 0,
        step: 0.01,
        precision: 2,
        render: (value, row) => {
          if (row.status === 'rejected') {
            return <span className="text-red-500 line-through">{row.originalAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
          }
          const num = value !== null && value !== undefined ? (value as number) : row.originalAmount
          return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        },
      })

      cols.push({
        key: 'status',
        label: 'Status',
        type: 'readonly',
        width: '12%',
        align: 'center',
        render: (value) => {
          const status = value as string
          return (
            <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusColors[status] || 'bg-gray-100 text-gray-800'}`}>
              {statusLabels[status] || status}
            </span>
          )
        },
      })
    }

    return cols
  }, [canEdit, canReview, isCompleted, searchItems, onCreateItem])

  // Handle batch saving of dirty rows (manual save mode)
  const handleSaveChanges = useCallback(async (
    dirtyRows: { row: PartGridRow; index: number; changes: Record<string, unknown> }[],
    deletedRows?: PartGridRow[]
  ) => {
    setUpdating(true)
    let hasErrors = false
    let latestUpdatedAt = expectedUpdatedAt

    try {
      // Process deletions first
      if (deletedRows && deletedRows.length > 0) {
        for (const row of deletedRows) {
          if (row.id.startsWith('temp-')) continue // Skip temp rows

          const res = await fetch(`/api/insurance-estimates/${estimateId}/items?itemId=${row.id}`, {
            method: 'DELETE',
          })

          if (!res.ok) {
            const data = await res.json()
            setAlertModal({ open: true, title: 'Error', message: data.error || 'Failed to delete', variant: 'error' })
            hasErrors = true
            break
          }
          const data = await res.json()
          if (data?.estimateUpdatedAt) latestUpdatedAt = data.estimateUpdatedAt
        }
      }

      // Process updates
      if (!hasErrors) {
        for (const { row, changes } of dirtyRows) {
          // Skip temp rows (new rows handled separately)
          if (row.id.startsWith('temp-')) continue

          // Build update payload
          const body: Record<string, unknown> = { itemId: row.id }

          if ('quantity' in changes || 'unitPrice' in changes) {
            const quantity = 'quantity' in changes ? (changes.quantity as number) : row.quantity
            const unitPrice = 'unitPrice' in changes ? (changes.unitPrice as number) : row.unitPrice
            if (quantity <= 0) {
              setAlertModal({ open: true, title: 'Validation Error', message: 'Quantity must be greater than zero', variant: 'error' })
              hasErrors = true
              break
            }
            body.quantity = quantity
            body.unitPrice = unitPrice
          }

          if ('approvedAmount' in changes) {
            body.approvedAmount = changes.approvedAmount as number
            body.status = (changes.approvedAmount as number) !== row.originalAmount ? 'price_adjusted' : 'approved'
          }

          if (latestUpdatedAt) body.expectedUpdatedAt = latestUpdatedAt

          const res = await fetch(`/api/insurance-estimates/${estimateId}/items`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })

          if (res.status === 409) {
            onConflict?.()
            setAlertModal({
              open: true,
              title: 'Conflict',
              message: 'This estimate was modified by another user. Please refresh.',
              variant: 'warning'
            })
            hasErrors = true
            break
          }

          if (!res.ok) {
            const data = await res.json()
            setAlertModal({ open: true, title: 'Error', message: data.error || 'Failed to update', variant: 'error' })
            hasErrors = true
            break
          }
          const data = await res.json()
          if (data?.estimateUpdatedAt) latestUpdatedAt = data.estimateUpdatedAt
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
  }, [estimateId, expectedUpdatedAt, onRefresh, onSaved, onConflict])

  // Handle adding new row
  const handleRowAdd = useCallback((): PartGridRow => {
    return {
      id: generateTempId(),
      itemId: '',
      itemName: '',
      quantity: 1,
      unitPrice: 0,
      originalAmount: 0,
      approvedAmount: null,
      status: 'pending',
      isNew: true,
    }
  }, [])

  // Handle deleting row
  const handleRowDelete = useCallback(async (row: PartGridRow) => {
    if (row.id.startsWith('temp-')) return

    setUpdating(true)
    try {
      const res = await fetch(`/api/insurance-estimates/${estimateId}/items?itemId=${row.id}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        onRefresh()
        onSaved?.()
      } else {
        const data = await res.json()
        setAlertModal({ open: true, title: 'Error', message: data.error || 'Failed to delete', variant: 'error' })
      }
    } catch (error) {
      console.error('Error deleting item:', error)
      setAlertModal({ open: true, title: 'Error', message: 'Failed to delete', variant: 'error' })
    } finally {
      setUpdating(false)
    }
  }, [estimateId, onRefresh, onSaved])

  return (
    <>
      <EditableGrid
        columns={columns}
        data={gridData}
        onChange={handleDataChange}
        onRowAdd={canEdit ? handleRowAdd : undefined}
        onRowDelete={canEdit ? handleRowDelete : undefined}
        manualSave={canEdit || canReview}
        onSaveChanges={handleSaveChanges}
        showRowNumbers
        showDeleteButton={canEdit}
        showAddButton={canEdit}
        addButtonLabel="Add Part"
        emptyMessage="No parts added"
        disabled={!canEdit && !canReview}
        loading={updating}
        footerTotals={[
          { key: 'itemName', label: 'Total:' },
          { key: 'originalAmount' },
          ...(canReview || isCompleted ? [{ key: 'approvedAmount' }] : []),
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
