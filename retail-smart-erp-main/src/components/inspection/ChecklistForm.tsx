'use client'

import { useState } from 'react'
import { Check, AlertTriangle, X, Minus, Camera, ChevronDown, ChevronRight, MessageSquare } from 'lucide-react'

interface ChecklistItem {
  id: string
  itemName: string
  itemType: 'checkbox' | 'select' | 'text' | 'number'
  options: string | null
  isRequired: boolean
}

interface Category {
  id: string
  name: string
  items: ChecklistItem[]
}

interface Response {
  checklistItemId: string
  response: 'ok' | 'concern' | 'fail' | 'na' | null
  value: string | null
  notes: string | null
}

type ResponseType = 'ok' | 'concern' | 'fail' | 'na'

interface Props {
  categories: Category[]
  responses: Response[]
  onResponseChange: (itemId: string, data: { response?: ResponseType; value?: string; notes?: string }) => void
  onTakePhoto?: (itemId: string, itemName: string) => void
  readonly?: boolean
}

const responseButtons: Array<{ value: ResponseType; label: string; icon: typeof Check; color: string }> = [
  { value: 'ok', label: 'OK', icon: Check, color: 'bg-green-100 text-green-700 hover:bg-green-200 border-green-300' },
  { value: 'concern', label: 'Concern', icon: AlertTriangle, color: 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200 border-yellow-300' },
  { value: 'fail', label: 'Fail', icon: X, color: 'bg-red-100 text-red-700 hover:bg-red-200 border-red-300' },
  { value: 'na', label: 'N/A', icon: Minus, color: 'bg-gray-100 text-gray-700 hover:bg-gray-200 border-gray-300' },
]

export function ChecklistForm({
  categories,
  responses,
  onResponseChange,
  onTakePhoto,
  readonly = false,
}: Props) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(categories.map(c => c.id))
  )
  const [notesExpanded, setNotesExpanded] = useState<Set<string>>(new Set())

  const toggleCategory = (categoryId: string) => {
    const newExpanded = new Set(expandedCategories)
    if (newExpanded.has(categoryId)) {
      newExpanded.delete(categoryId)
    } else {
      newExpanded.add(categoryId)
    }
    setExpandedCategories(newExpanded)
  }

  const toggleNotes = (itemId: string) => {
    const newExpanded = new Set(notesExpanded)
    if (newExpanded.has(itemId)) {
      newExpanded.delete(itemId)
    } else {
      newExpanded.add(itemId)
    }
    setNotesExpanded(newExpanded)
  }

  const getResponse = (itemId: string): Response | undefined => {
    return responses.find(r => r.checklistItemId === itemId)
  }

  const getCategoryProgress = (category: Category) => {
    const answered = category.items.filter(item => {
      const response = getResponse(item.id)
      return response?.response || response?.value
    }).length
    return { answered, total: category.items.length }
  }

  return (
    <div className="space-y-4">
      {categories.map((category) => {
        const progress = getCategoryProgress(category)
        const isExpanded = expandedCategories.has(category.id)

        return (
          <div key={category.id} className="bg-white border rounded overflow-hidden">
            {/* Category Header */}
            <button
              onClick={() => toggleCategory(category.id)}
              className="w-full p-3 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
            >
              <div className="flex items-center gap-2">
                {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                <span className="font-medium">{category.name}</span>
              </div>
              <span className={`text-sm px-2 py-0.5 rounded ${
                progress.answered === progress.total
                  ? 'bg-green-100 text-green-700'
                  : 'bg-gray-200 text-gray-600'
              }`}>
                {progress.answered}/{progress.total}
              </span>
            </button>

            {/* Category Items */}
            {isExpanded && (
              <div className="divide-y">
                {category.items.map((item) => {
                  const response = getResponse(item.id)
                  const hasNotes = notesExpanded.has(item.id) || response?.notes

                  return (
                    <div key={item.id} className="p-3">
                      <div className="flex items-start gap-3">
                        {/* Item name */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`text-sm ${item.isRequired ? 'font-medium' : ''}`}>
                              {item.itemName}
                            </span>
                            {item.isRequired && (
                              <span className="text-xs text-red-500">*</span>
                            )}
                          </div>

                          {/* Value input for text/number/select types */}
                          {item.itemType !== 'checkbox' && (
                            <div className="mt-2">
                              {item.itemType === 'select' && item.options ? (
                                <select
                                  value={response?.value || ''}
                                  onChange={(e) => onResponseChange(item.id, { value: e.target.value })}
                                  disabled={readonly}
                                  className="w-full max-w-xs px-2 py-1 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                                >
                                  <option value="">Select...</option>
                                  {(Array.isArray(item.options) ? item.options : (item.options || '').split(',')).map((opt: string) => (
                                    <option key={opt.trim()} value={opt.trim()}>
                                      {opt.trim()}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  type={item.itemType === 'number' ? 'number' : 'text'}
                                  value={response?.value || ''}
                                  onChange={(e) => onResponseChange(item.id, { value: e.target.value })}
                                  disabled={readonly}
                                  placeholder={item.itemType === 'number' ? '0' : 'Enter value...'}
                                  className="w-full max-w-xs px-2 py-1 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                                />
                              )}
                            </div>
                          )}

                          {/* Notes */}
                          {hasNotes && (
                            <div className="mt-2">
                              <textarea
                                value={response?.notes || ''}
                                onChange={(e) => onResponseChange(item.id, { notes: e.target.value })}
                                disabled={readonly}
                                placeholder="Add notes..."
                                rows={2}
                                className="w-full px-2 py-1 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                              />
                            </div>
                          )}
                        </div>

                        {/* Response buttons */}
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {responseButtons.map((btn) => {
                            const Icon = btn.icon
                            const isSelected = response?.response === btn.value

                            return (
                              <button
                                key={btn.value}
                                onClick={() => !readonly && onResponseChange(item.id, { response: btn.value })}
                                disabled={readonly}
                                className={`p-1.5 rounded border transition-colors ${
                                  isSelected
                                    ? btn.color + ' border-current'
                                    : 'border-gray-200 hover:bg-gray-100 disabled:hover:bg-transparent'
                                }`}
                                title={btn.label}
                              >
                                <Icon size={16} />
                              </button>
                            )
                          })}

                          {/* Notes toggle */}
                          <button
                            onClick={() => toggleNotes(item.id)}
                            className={`p-1.5 rounded border transition-colors ${
                              hasNotes
                                ? 'bg-blue-100 text-blue-700 border-blue-300'
                                : 'border-gray-200 hover:bg-gray-100'
                            }`}
                            title="Add notes"
                          >
                            <MessageSquare size={16} />
                          </button>

                          {/* Photo button */}
                          {onTakePhoto && (
                            <button
                              onClick={() => onTakePhoto(item.id, item.itemName)}
                              disabled={readonly}
                              className="p-1.5 rounded border border-gray-200 hover:bg-gray-100 disabled:opacity-50"
                              title="Take photo"
                            >
                              <Camera size={16} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
