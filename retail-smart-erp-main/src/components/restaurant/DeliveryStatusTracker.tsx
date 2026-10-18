'use client'

import { CheckCircle, Clock, MapPin, Truck, XCircle } from 'lucide-react'

const DELIVERY_STEPS = [
  { key: 'pending', label: 'Pending', icon: Clock },
  { key: 'dispatched', label: 'Dispatched', icon: Truck },
  { key: 'in_transit', label: 'In Transit', icon: MapPin },
  { key: 'delivered', label: 'Delivered', icon: CheckCircle },
]

interface DeliveryStatusTrackerProps {
  status: string
  estimatedTime?: string | null
  actualTime?: string | null
}

export function DeliveryStatusTracker({ status, estimatedTime, actualTime }: DeliveryStatusTrackerProps) {
  const isFailed = status === 'failed'
  const currentIdx = DELIVERY_STEPS.findIndex(s => s.key === status)

  return (
    <div className="py-3">
      {isFailed ? (
        <div className="flex items-center gap-2 text-red-600 bg-red-50 dark:bg-red-900/20 p-3 rounded">
          <XCircle size={20} />
          <span className="font-medium">Delivery Failed</span>
        </div>
      ) : (
        <div className="flex items-center gap-1">
          {DELIVERY_STEPS.map((step, idx) => {
            const StepIcon = step.icon
            const isCompleted = idx <= currentIdx
            const isCurrent = idx === currentIdx
            return (
              <div key={step.key} className="flex items-center flex-1">
                <div className="flex flex-col items-center flex-1">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                    isCompleted ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400 dark:bg-gray-700'
                  } ${isCurrent ? 'ring-2 ring-green-500 ring-offset-2 dark:ring-offset-gray-900' : ''}`}>
                    <StepIcon size={16} />
                  </div>
                  <span className={`text-xs mt-1 ${isCompleted ? 'text-green-600 font-medium' : 'text-gray-400'}`}>
                    {step.label}
                  </span>
                </div>
                {idx < DELIVERY_STEPS.length - 1 && (
                  <div className={`h-0.5 flex-1 mx-1 ${idx < currentIdx ? 'bg-green-400' : 'bg-gray-200 dark:bg-gray-600'}`} />
                )}
              </div>
            )
          })}
        </div>
      )}
      <div className="mt-3 flex gap-4 text-xs text-gray-500 dark:text-gray-400">
        {estimatedTime && (
          <span>ETA: {new Date(estimatedTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        )}
        {actualTime && (
          <span>Delivered: {new Date(actualTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        )}
      </div>
    </div>
  )
}
