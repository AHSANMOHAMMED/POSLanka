'use client'

import { AlertCircle } from 'lucide-react'
import type { Vehicle } from './types'

interface VehicleMismatchDialogProps {
  isOpen: boolean
  mismatchInfo: { vehicleOwnerName: string; vehicleOwnerId: string } | null
  pendingVehicle: Vehicle | null
  onKeepCustomer: () => void
  onUseVehicleOwner: () => void
  onCancel: () => void
}

export function VehicleMismatchDialog({
  isOpen,
  mismatchInfo,
  pendingVehicle,
  onKeepCustomer,
  onUseVehicleOwner,
  onCancel,
}: VehicleMismatchDialogProps) {
  if (!isOpen || !mismatchInfo || !pendingVehicle) return null

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 bg-amber-100 rounded-md flex items-center justify-center">
            <AlertCircle className="text-amber-600" size={24} />
          </div>
          <h3 className="text-lg font-bold text-gray-900">Vehicle Ownership</h3>
        </div>
        <p className="text-gray-600 mb-6">
          This vehicle belongs to <strong>{mismatchInfo.vehicleOwnerName}</strong>, not the selected customer.
        </p>
        <div className="space-y-2">
          <button
            onClick={onKeepCustomer}
            className="w-full py-3 bg-amber-500 text-white rounded-md font-medium hover:bg-amber-600"
          >
            Keep Selected Customer
          </button>
          <button
            onClick={onUseVehicleOwner}
            className="w-full py-3 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700"
          >
            Use Vehicle Owner
          </button>
          <button
            onClick={onCancel}
            className="w-full py-3 border-2 border-gray-200 rounded-md font-medium hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
