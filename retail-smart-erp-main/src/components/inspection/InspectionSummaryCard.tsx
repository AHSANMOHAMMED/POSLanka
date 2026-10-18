'use client'

import { ClipboardCheck, AlertTriangle, Camera, Fuel, Clock, CheckCircle2, Pencil, Trash2 } from 'lucide-react'

interface Inspection {
  id: string
  inspectionType: 'check_in' | 'check_out'
  status: 'draft' | 'completed'
  fuelLevel: number | null
  odometerReading: string | null
  startedAt: string
  completedAt: string | null
  _count?: {
    responses: number
    damageMarks: number
    photos: number
  }
}

interface Props {
  inspection: Inspection
  workOrderId: string
  totalChecklistItems?: number
  canModify?: boolean
  onView?: () => void
  onEdit?: () => void
  onDelete?: () => void
}

export function InspectionSummaryCard({
  inspection,
  totalChecklistItems = 0,
  canModify = false,
  onView,
  onEdit,
  onDelete
}: Props) {
  const responseCount = inspection._count?.responses || 0
  const damageCount = inspection._count?.damageMarks || 0
  const photoCount = inspection._count?.photos || 0

  const progressPercent = totalChecklistItems > 0
    ? Math.round((responseCount / totalChecklistItems) * 100)
    : 0

  return (
    <div className={`bg-white border rounded-md p-4 ${inspection.status === 'completed' ? 'border-green-200' : 'border-yellow-200'}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`p-2 rounded ${
            inspection.inspectionType === 'check_in'
              ? 'bg-green-100'
              : 'bg-blue-100'
          }`}>
            <ClipboardCheck size={20} className={
              inspection.inspectionType === 'check_in'
                ? 'text-green-600'
                : 'text-blue-600'
            } />
          </div>
          <div>
            <h3 className="font-medium">
              {inspection.inspectionType === 'check_in' ? 'Check-in Inspection' : 'Check-out Inspection'}
            </h3>
            <p className="text-xs text-gray-500">
              {inspection.status === 'completed' ? (
                <>Completed {inspection.completedAt && new Date(inspection.completedAt).toLocaleDateString()}</>
              ) : (
                <>Started {new Date(inspection.startedAt).toLocaleDateString()}</>
              )}
            </p>
          </div>
        </div>
        <span className={`px-2 py-1 text-xs font-medium rounded-full ${
          inspection.status === 'completed'
            ? 'bg-green-100 text-green-700'
            : 'bg-yellow-100 text-yellow-700'
        }`}>
          {inspection.status === 'completed' ? 'Completed' : 'In Progress'}
        </span>
      </div>

      {/* Progress bar */}
      {inspection.status === 'draft' && totalChecklistItems > 0 && (
        <div className="mb-3">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>Checklist progress</span>
            <span>{responseCount}/{totalChecklistItems}</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2 mb-3">
        <div className="text-center p-2 bg-gray-50 rounded">
          <CheckCircle2 size={16} className="mx-auto mb-1 text-green-500" />
          <div className="text-sm font-medium">{responseCount}</div>
          <div className="text-xs text-gray-500">Items</div>
        </div>
        <div className="text-center p-2 bg-gray-50 rounded">
          <AlertTriangle size={16} className="mx-auto mb-1 text-orange-500" />
          <div className="text-sm font-medium">{damageCount}</div>
          <div className="text-xs text-gray-500">Damage</div>
        </div>
        <div className="text-center p-2 bg-gray-50 rounded">
          <Camera size={16} className="mx-auto mb-1 text-blue-500" />
          <div className="text-sm font-medium">{photoCount}</div>
          <div className="text-xs text-gray-500">Photos</div>
        </div>
        <div className="text-center p-2 bg-gray-50 rounded">
          <Fuel size={16} className="mx-auto mb-1 text-purple-500" />
          <div className="text-sm font-medium">{inspection.fuelLevel ?? '-'}%</div>
          <div className="text-xs text-gray-500">Fuel</div>
        </div>
      </div>

      {/* Odometer */}
      {inspection.odometerReading && (
        <div className="text-sm text-gray-600 mb-3">
          <Clock size={14} className="inline mr-1" />
          Odometer: {parseFloat(inspection.odometerReading).toLocaleString()} km
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={onView || onEdit}
          className={`flex-1 text-center py-2 rounded font-medium transition-colors ${
            inspection.status === 'completed'
              ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          {inspection.status === 'completed' ? 'View Inspection' : 'Continue Inspection'}
        </button>

        {/* Edit button - only show for completed inspections when canModify is true */}
        {canModify && inspection.status === 'completed' && onEdit && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onEdit()
            }}
            className="px-3 py-2 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
            title="Edit Inspection"
          >
            <Pencil size={16} />
          </button>
        )}

        {/* Delete button - only show when canModify is true and inspection is draft */}
        {canModify && inspection.status === 'draft' && onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            className="px-3 py-2 bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
            title="Delete Inspection"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
    </div>
  )
}
