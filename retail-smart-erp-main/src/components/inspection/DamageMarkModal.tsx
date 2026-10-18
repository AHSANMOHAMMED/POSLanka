'use client'

import { useState, useEffect } from 'react'
import { X, Loader2 } from 'lucide-react'

interface Props {
  isOpen: boolean
  position?: { x: number; y: number }
  existingMark?: {
    id: string
    damageType: string
    severity: string
    description?: string | null
    isPreExisting: boolean
  }
  onConfirm?: (data: {
    damageType: string
    severity: string
    description: string
    isPreExisting: boolean
  }) => void
  onDelete?: () => void
  onClose: () => void
  processing?: boolean
  readOnly?: boolean
}

const damageTypes = [
  { value: 'scratch', label: 'Scratch', description: 'Surface scratch on paint or material' },
  { value: 'dent', label: 'Dent', description: 'Indentation or depression in body' },
  { value: 'crack', label: 'Crack', description: 'Visible crack in glass or plastic' },
  { value: 'rust', label: 'Rust', description: 'Corrosion or rust spots' },
  { value: 'paint', label: 'Paint Damage', description: 'Chipped, peeling, or faded paint' },
  { value: 'broken', label: 'Broken', description: 'Part is broken or non-functional' },
  { value: 'missing', label: 'Missing', description: 'Part is missing entirely' },
  { value: 'other', label: 'Other', description: 'Other type of damage' },
]

const severityLevels = [
  { value: 'minor', label: 'Minor', color: 'bg-yellow-100 text-yellow-800' },
  { value: 'moderate', label: 'Moderate', color: 'bg-orange-100 text-orange-800' },
  { value: 'severe', label: 'Severe', color: 'bg-red-100 text-red-800' },
]

export function DamageMarkModal({
  isOpen,
  position,
  existingMark,
  onConfirm,
  onDelete,
  onClose,
  processing = false,
  readOnly = false,
}: Props) {
  const [damageType, setDamageType] = useState('scratch')
  const [severity, setSeverity] = useState('minor')
  const [description, setDescription] = useState('')
  const [isPreExisting, setIsPreExisting] = useState(false)

  // Sync form state with existing mark when modal opens - intentional prop->state sync for modal pattern
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (existingMark) {
      setDamageType(existingMark.damageType)
      setSeverity(existingMark.severity)
      setDescription(existingMark.description || '')
      setIsPreExisting(existingMark.isPreExisting)
    } else {
      setDamageType('scratch')
      setSeverity('minor')
      setDescription('')
      setIsPreExisting(false)
    }
  }, [existingMark, isOpen])
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!isOpen) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (onConfirm && !readOnly) {
      onConfirm({ damageType, severity, description, isPreExisting })
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-md shadow-xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">
            {readOnly ? 'View Damage Mark' : existingMark ? 'Edit Damage Mark' : 'Add Damage Mark'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded"
            disabled={processing}
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Position info */}
          {position && (
            <div className="text-sm text-gray-500 bg-gray-50 px-3 py-2 rounded">
              Position: ({position.x.toFixed(1)}%, {position.y.toFixed(1)}%)
            </div>
          )}

          {/* Damage Type */}
          <div>
            <label className="block text-sm font-medium mb-2">Damage Type</label>
            <div className="grid grid-cols-2 gap-2">
              {damageTypes.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => !readOnly && setDamageType(type.value)}
                  disabled={readOnly}
                  className={`p-2 text-left border rounded transition-colors ${
                    damageType === type.value
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : readOnly ? 'bg-gray-50 cursor-not-allowed' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="font-medium text-sm">{type.label}</div>
                  <div className="text-xs text-gray-500 line-clamp-1">{type.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Severity */}
          <div>
            <label className="block text-sm font-medium mb-2">Severity</label>
            <div className="flex gap-2">
              {severityLevels.map((level) => (
                <button
                  key={level.value}
                  type="button"
                  onClick={() => !readOnly && setSeverity(level.value)}
                  disabled={readOnly}
                  className={`flex-1 px-3 py-2 rounded text-sm font-medium transition-all ${
                    severity === level.value
                      ? `${level.color} ring-2 ring-offset-1 ring-current`
                      : readOnly ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {level.label}
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium mb-1">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the damage location and details..."
              rows={2}
              readOnly={readOnly}
              disabled={readOnly}
              className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${readOnly ? 'bg-gray-50 cursor-not-allowed' : ''}`}
            />
          </div>

          {/* Pre-existing */}
          <label className={`flex items-center gap-2 ${readOnly ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
            <input
              type="checkbox"
              checked={isPreExisting}
              onChange={(e) => !readOnly && setIsPreExisting(e.target.checked)}
              disabled={readOnly}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed"
            />
            <span className="text-sm">Pre-existing damage (was present before service)</span>
          </label>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            {!readOnly && existingMark && onDelete && (
              <button
                type="button"
                onClick={onDelete}
                disabled={processing}
                className="px-4 py-2 text-red-600 hover:bg-red-50 rounded disabled:opacity-50"
              >
                Delete
              </button>
            )}
            <div className="flex-1" />
            <button
              type="button"
              onClick={onClose}
              disabled={processing}
              className="px-4 py-2 border rounded hover:bg-gray-50 disabled:opacity-50"
            >
              {readOnly ? 'Close' : 'Cancel'}
            </button>
            {!readOnly && (
              <button
                type="submit"
                disabled={processing}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {processing && <Loader2 className="w-4 h-4 animate-spin" />}
                {existingMark ? 'Update' : 'Add Mark'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
