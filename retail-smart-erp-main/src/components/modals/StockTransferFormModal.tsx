'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Modal } from '@/components/ui/modal'
import { WarehouseSelector } from '@/components/ui/warehouse-selector'
import { toast } from '@/components/ui/toast'
import { ArrowRightLeft, Warehouse, AlertTriangle, ArrowRight } from 'lucide-react'

// Full transfer type for edit mode
interface StockTransfer {
  id: string
  transferNo: string
  status: string
  fromWarehouseId: string
  toWarehouseId: string
  notes: string | null
  updatedAt: string | null
}

interface StockTransferFormModalProps {
  isOpen: boolean
  onClose: () => void
  onSaved?: (transfer: { id: string; transferNo: string }) => void
  editTransfer?: StockTransfer | null  // null/undefined = create mode, object = edit mode
}

export function StockTransferFormModal({
  isOpen,
  onClose,
  onSaved,
  editTransfer,
}: StockTransferFormModalProps) {
  const router = useRouter()
  const params = useParams()
  const slug = params?.slug as string
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [formData, setFormData] = useState({
    fromWarehouseId: null as string | null,
    toWarehouseId: null as string | null,
    notes: '',
  })

  // Edit mode detection
  const isEditMode = !!editTransfer
  const isViewOnly = isEditMode && editTransfer?.status !== 'draft'
  const [transferUpdatedAt, setTransferUpdatedAt] = useState<string | null>(null)

  // Reset form when modal opens or populate from editTransfer
  useEffect(() => {
    if (isOpen) {
      if (editTransfer) {
        // Edit mode - populate from existing transfer
        setFormData({
          fromWarehouseId: editTransfer.fromWarehouseId,
          toWarehouseId: editTransfer.toWarehouseId,
          notes: editTransfer.notes || '',
        })
        setTransferUpdatedAt(editTransfer.updatedAt)
      } else {
        // Create mode - reset form
        setFormData({
          fromWarehouseId: null,
          toWarehouseId: null,
          notes: '',
        })
        setTransferUpdatedAt(null)
      }
      setError('')
    }
  }, [isOpen, editTransfer])

  // Check if warehouses are the same
  const sameWarehouse = formData.fromWarehouseId && formData.toWarehouseId && formData.fromWarehouseId === formData.toWarehouseId

  async function handleSubmit(requestApproval: boolean = false) {
    // Validate
    if (!formData.fromWarehouseId) {
      setError('Please select a source warehouse')
      return
    }
    if (!formData.toWarehouseId) {
      setError('Please select a destination warehouse')
      return
    }
    if (formData.fromWarehouseId === formData.toWarehouseId) {
      setError('Source and destination warehouses must be different')
      return
    }

    setSaving(true)
    setError('')

    try {
      const url = isEditMode ? `/api/stock-transfers/${editTransfer!.id}` : '/api/stock-transfers'
      const method = isEditMode ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromWarehouseId: formData.fromWarehouseId,
          toWarehouseId: formData.toWarehouseId,
          notes: formData.notes.trim() || null,
          ...(isEditMode ? {} : { items: [] }), // Items only for create mode
          ...(isEditMode && transferUpdatedAt ? { expectedUpdatedAt: transferUpdatedAt } : {}),
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        if (res.status === 409 && data.code === 'CONFLICT') {
          setError('This transfer was modified by another user. Please close and reopen.')
        } else {
          setError(data.error || `Failed to ${isEditMode ? 'update' : 'create'} transfer`)
        }
        setSaving(false)
        return
      }

      const transfer = await res.json()

      if (isEditMode) {
        toast.success(`Transfer ${transfer.transferNo} updated!`)
        onSaved?.(transfer)
        onClose()
      } else {
        // If requesting approval (skip for now since we need items)
        if (requestApproval) {
          toast.info('Add items on the next page before requesting approval')
        }

        toast.success(`Transfer ${transfer.transferNo} created! Add items to complete.`)
        onSaved?.(transfer)
        onClose()

        // Navigate to detail page to add items
        router.push(`/c/${slug}/stock-transfers/${transfer.id}`)
      }
    } catch (err) {
      console.error('Error creating transfer:', err)
      setError('Failed to create transfer')
    } finally {
      setSaving(false)
    }
  }

  function handleClose() {
    setFormData({
      fromWarehouseId: null,
      toWarehouseId: null,
      notes: '',
    })
    setError('')
    onClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={isEditMode ? `${isViewOnly ? 'View' : 'Edit'} Transfer ${editTransfer?.transferNo}` : 'New Stock Transfer'}
      size="md"
    >
      <div className="space-y-6">
        {error && (
          <div className="p-3 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded text-sm flex items-center gap-2">
            <AlertTriangle size={16} />
            {error}
          </div>
        )}

        {/* Transfer Direction Visual */}
        <div className="flex items-center justify-center gap-4 py-4 bg-gray-50 dark:bg-gray-800 rounded">
          <div className="text-center">
            <Warehouse size={32} className="mx-auto text-blue-500 mb-2" />
            <span className="text-sm text-gray-600 dark:text-gray-400">Source</span>
          </div>
          <ArrowRight size={24} className="text-gray-400" />
          <div className="text-center">
            <Warehouse size={32} className="mx-auto text-green-500 mb-2" />
            <span className="text-sm text-gray-600 dark:text-gray-400">Destination</span>
          </div>
        </div>

        {/* Warehouse Selection */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-2 dark:text-gray-200">
              <Warehouse size={14} className="inline mr-1 text-blue-500" />
              From Warehouse {!isViewOnly && <span className="text-red-500">*</span>}
            </label>
            <WarehouseSelector
              value={formData.fromWarehouseId}
              onChange={(id) => setFormData(prev => ({ ...prev, fromWarehouseId: id }))}
              required
              placeholder="Select source warehouse"
              disabled={isViewOnly}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2 dark:text-gray-200">
              <Warehouse size={14} className="inline mr-1 text-green-500" />
              To Warehouse {!isViewOnly && <span className="text-red-500">*</span>}
            </label>
            <WarehouseSelector
              value={formData.toWarehouseId}
              onChange={(id) => setFormData(prev => ({ ...prev, toWarehouseId: id }))}
              required
              placeholder="Select destination warehouse"
              disabled={isViewOnly}
            />
          </div>
        </div>

        {/* Same warehouse warning */}
        {sameWarehouse && (
          <div className="p-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded text-sm text-orange-700 dark:text-orange-300 flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
            <span>Source and destination warehouses must be different.</span>
          </div>
        )}

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium mb-2 dark:text-gray-200">
            Notes
          </label>
          <textarea
            value={formData.notes}
            onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
            rows={3}
            className="w-full px-3 py-2 border dark:border-gray-600 rounded focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:cursor-not-allowed"
            placeholder="Reason for transfer, special instructions, etc..."
            disabled={isViewOnly}
          />
        </div>

        {/* Info box - only show for create mode */}
        {!isEditMode && (
          <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded">
            <p className="text-sm text-blue-700 dark:text-blue-300">
              After creating the transfer, you will be redirected to add items and their quantities.
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-4 border-t dark:border-gray-700">
          {isViewOnly ? (
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
            >
              Close
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleClose}
                disabled={saving}
                className="px-4 py-2 border dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleSubmit(false)}
                disabled={saving || sameWarehouse || !formData.fromWarehouseId || !formData.toWarehouseId}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {saving ? (
                  isEditMode ? 'Updating...' : 'Creating...'
                ) : isEditMode ? (
                  'Update'
                ) : (
                  <>
                    <ArrowRightLeft size={16} />
                    Create & Add Items
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
