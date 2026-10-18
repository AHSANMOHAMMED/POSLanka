'use client'

import { useState, useEffect, useMemo } from 'react'
import { Modal } from '@/components/ui/modal'
import { AlertTriangle } from 'lucide-react'

interface CancellationReasonModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (reason: string) => void
  title?: string
  itemName?: string
  processing?: boolean
  warningMessage?: string
  infoMessage?: string
  children?: React.ReactNode
  confirmDisabled?: boolean // Additional validation from parent
  documentType?: string // If provided, fetches tenant-specific reasons from API
}

// Fallback reasons when no documentType or API returns empty
const fallbackReasons = [
  'Customer request',
  'Customer no-show',
  'Scheduling conflict',
  'Parts not available',
  'Service no longer needed',
  'Duplicate entry',
  'Error in creation',
]

export function CancellationReasonModal({
  isOpen,
  onClose,
  onConfirm,
  title = 'Cancel Item',
  itemName,
  processing = false,
  warningMessage,
  infoMessage,
  children,
  confirmDisabled = false,
  documentType,
}: CancellationReasonModalProps) {
  const [selectedPreset, setSelectedPreset] = useState('')
  const [customReason, setCustomReason] = useState('')
  const [reasons, setReasons] = useState<string[]>(fallbackReasons)
  const [loadingReasons, setLoadingReasons] = useState(false)

  // Fetch tenant-specific reasons when modal opens
  useEffect(() => {
    if (!isOpen || !documentType) return

    let cancelled = false
    queueMicrotask(() => setLoadingReasons(true))

    fetch(`/api/cancellation-reasons?documentType=${encodeURIComponent(documentType)}`)
      .then(res => res.ok ? res.json() : [])
      .then((data: { reason: string }[]) => {
        if (cancelled) return
        if (data.length > 0) {
          setReasons(data.map(d => d.reason))
        } else {
          setReasons(fallbackReasons)
        }
      })
      .catch(() => {
        if (!cancelled) setReasons(fallbackReasons)
      })
      .finally(() => {
        if (!cancelled) setLoadingReasons(false)
      })

    return () => { cancelled = true }
  }, [isOpen, documentType])

  // Reset form when modal opens - intentional prop->state sync for modal pattern
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (isOpen) {
      setSelectedPreset('')
      setCustomReason('')
    }
  }, [isOpen])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Derive reason from selectedPreset and customReason
  const reason = useMemo(() => {
    if (selectedPreset === 'Other') {
      return customReason
    }
    return selectedPreset
  }, [selectedPreset, customReason])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!reason.trim()) return
    onConfirm(reason.trim())
  }

  // Always append "Other" to the reason list
  const displayReasons = [...reasons, 'Other']

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded">
          <AlertTriangle className="text-red-600 shrink-0 mt-0.5" size={24} />
          <div>
            <p className="text-red-800 font-semibold text-lg">Confirm Cancellation</p>
            {itemName && (
              <p className="text-red-700 font-medium mt-1">{itemName}</p>
            )}
            <p className="text-red-600 text-sm mt-2">This action cannot be undone. The document will be permanently marked as cancelled.</p>
          </div>
        </div>

        {warningMessage && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded">
            <p className="text-amber-800 text-sm font-medium">{warningMessage}</p>
          </div>
        )}

        {infoMessage && (
          <div className="p-3 bg-blue-50 border border-blue-200 rounded">
            <p className="text-blue-700 text-sm">{infoMessage}</p>
          </div>
        )}

        {children}

        <div>
          <label className="block text-sm font-medium mb-2">Reason for cancellation *</label>
          {loadingReasons ? (
            <div className="grid grid-cols-2 gap-2 mb-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-10 rounded border border-gray-200 bg-gray-50 animate-pulse"
                />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 mb-3">
              {displayReasons.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setSelectedPreset(preset)}
                  className={`px-3 py-2 text-sm rounded border text-left transition-colors ${
                    selectedPreset === preset
                      ? 'border-red-500 bg-red-50 text-red-700'
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
          )}

          {selectedPreset === 'Other' && (
            <div className="mt-3">
              <label className="block text-sm font-medium mb-1">Please specify</label>
              <textarea
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="Enter the reason..."
                rows={3}
                autoFocus
                required
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <button
            type="button"
            onClick={onClose}
            disabled={processing}
            className="px-4 py-2 border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            No, Keep Active
          </button>
          <button
            type="submit"
            disabled={!reason.trim() || processing || confirmDisabled}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {processing ? 'Cancelling...' : 'Yes, Cancel Document'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
