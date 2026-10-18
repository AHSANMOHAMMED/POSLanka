'use client'

import { useState, useEffect, useCallback } from 'react'
import { X, Loader2, Check } from 'lucide-react'
import { useCurrency } from '@/hooks/useCurrency'
import type { ModifierGroupForPOS, SelectedModifier } from './types'

interface ModifierPickerModalProps {
  isOpen: boolean
  itemId: string | null
  itemName: string
  onClose: () => void
  onConfirm: (modifiers: SelectedModifier[]) => void
}

export function ModifierPickerModal({ isOpen, itemId, itemName, onClose, onConfirm }: ModifierPickerModalProps) {
  const { currency: currencyCode } = useCurrency()
  const [groups, setGroups] = useState<ModifierGroupForPOS[]>([])
  const [loading, setLoading] = useState(false)
  const [selections, setSelections] = useState<Record<string, Set<string>>>({}) // groupId -> set of modifierIds

  const fetchModifierGroups = useCallback(async () => {
    if (!itemId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/items/${itemId}/modifier-groups`)
      if (res.ok) {
        const data: ModifierGroupForPOS[] = await res.json()
        setGroups(data)
        // Pre-select defaults
        const defaults: Record<string, Set<string>> = {}
        for (const group of data) {
          const defaultMods = group.modifiers.filter(m => m.isDefault).map(m => m.id)
          if (defaultMods.length > 0) {
            defaults[group.id] = new Set(defaultMods)
          }
        }
        setSelections(defaults)
      }
    } catch (error) {
      console.error('Error fetching modifier groups:', error)
    } finally {
      setLoading(false)
    }
  }, [itemId])

  useEffect(() => {
    if (isOpen && itemId) {
      fetchModifierGroups()
    }
    if (!isOpen) {
      setGroups([])
      setSelections({})
    }
  }, [isOpen, itemId, fetchModifierGroups])

  if (!isOpen) return null

  function toggleModifier(groupId: string, modifierId: string, maxSelections: number | null) {
    setSelections(prev => {
      const groupSet = new Set(prev[groupId] || [])
      if (groupSet.has(modifierId)) {
        groupSet.delete(modifierId)
      } else {
        if (maxSelections === 1) {
          // Radio behavior
          return { ...prev, [groupId]: new Set([modifierId]) }
        }
        if (maxSelections && groupSet.size >= maxSelections) {
          return prev // At max
        }
        groupSet.add(modifierId)
      }
      return { ...prev, [groupId]: groupSet }
    })
  }

  function validate(): string | null {
    for (const group of groups) {
      const selected = selections[group.id]?.size || 0
      if (group.isRequired && selected < group.minSelections) {
        return `"${group.name}" requires at least ${group.minSelections} selection${group.minSelections > 1 ? 's' : ''}`
      }
    }
    return null
  }

  function handleConfirm() {
    const error = validate()
    if (error) return // UI shows inline errors

    const selected: SelectedModifier[] = []
    for (const group of groups) {
      const groupSelections = selections[group.id]
      if (!groupSelections) continue
      for (const mod of group.modifiers) {
        if (groupSelections.has(mod.id)) {
          selected.push({
            id: mod.id,
            name: mod.name,
            price: parseFloat(mod.price) || 0,
            groupId: group.id,
            groupName: group.name,
          })
        }
      }
    }
    onConfirm(selected)
  }

  const totalModPrice = groups.reduce((sum, group) => {
    const groupSelections = selections[group.id]
    if (!groupSelections) return sum
    return sum + group.modifiers
      .filter(m => groupSelections.has(m.id))
      .reduce((s, m) => s + (parseFloat(m.price) || 0), 0)
  }, 0)

  const validationError = validate()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0">
          <div>
            <h3 className="font-bold text-lg">Customize</h3>
            <p className="text-sm text-gray-500">{itemName}</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={20} className="animate-spin text-blue-500 mr-2" />
              <span className="text-gray-500">Loading modifiers...</span>
            </div>
          )}

          {!loading && groups.length === 0 && (
            <p className="text-center text-gray-400 py-8">No modifier groups for this item</p>
          )}

          {groups.map(group => {
            const selected = selections[group.id]?.size || 0
            const isValid = !group.isRequired || selected >= group.minSelections

            return (
              <div key={group.id}>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <h4 className="font-semibold text-sm text-gray-800">{group.name}</h4>
                    <p className="text-xs text-gray-400">
                      {group.isRequired ? 'Required' : 'Optional'}
                      {group.minSelections > 0 && ` · Min ${group.minSelections}`}
                      {group.maxSelections && ` · Max ${group.maxSelections}`}
                    </p>
                  </div>
                  {!isValid && (
                    <span className="text-xs text-red-500 font-medium">Select {group.minSelections - selected} more</span>
                  )}
                </div>
                <div className="space-y-1.5">
                  {group.modifiers.map(mod => {
                    const isSelected = selections[group.id]?.has(mod.id) || false
                    const price = parseFloat(mod.price) || 0

                    return (
                      <button
                        key={mod.id}
                        onClick={() => toggleModifier(group.id, mod.id, group.maxSelections)}
                        className={`w-full flex items-center justify-between p-3 rounded-md border-2 transition-all ${
                          isSelected
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-100 hover:border-gray-200 bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                            isSelected ? 'border-blue-500 bg-blue-500' : 'border-gray-300'
                          }`}>
                            {isSelected && <Check size={12} className="text-white" />}
                          </div>
                          <span className={`text-sm font-medium ${isSelected ? 'text-blue-700' : 'text-gray-700'}`}>
                            {mod.name}
                          </span>
                        </div>
                        {price > 0 && (
                          <span className="text-sm text-gray-500">
                            +{currencyCode} {price.toFixed(2)}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t flex-shrink-0">
          {totalModPrice > 0 && (
            <p className="text-sm text-gray-500 mb-2 text-center">
              Modifier total: +{currencyCode} {totalModPrice.toFixed(2)}
            </p>
          )}
          <button
            onClick={handleConfirm}
            disabled={!!validationError}
            className="w-full py-3 bg-blue-600 text-white rounded-md font-bold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add to Cart
          </button>
        </div>
      </div>
    </div>
  )
}
