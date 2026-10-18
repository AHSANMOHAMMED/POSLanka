'use client'

import { restaurantCategories, defaultTableAreas } from '@/lib/setup/seed-data'
import type { SetupWizardData } from '@/lib/setup/create-seed-data'
import { useState, useEffect } from 'react'
import { Plus, X } from 'lucide-react'
import { AISuggestionBanner, AISuggestionChip } from './AISuggestionChip'
import { FormInput, FormField } from '@/components/ui/form-elements'

interface RestaurantConfigProps {
  data: SetupWizardData
  onChange: (updates: Partial<SetupWizardData>) => void
  currency?: string
  suggestions?: {
    suggestedCategories?: string[]
    numberOfTables?: number
    tableNote?: string
  } | null
  suggestionsLoading?: boolean
  dismissed?: Set<string>
  onDismiss?: (key: string) => void
}

export function RestaurantConfig({ data, onChange, suggestions, suggestionsLoading, dismissed, onDismiss }: RestaurantConfigProps) {
  const [customCategory, setCustomCategory] = useState('')
  const [newArea, setNewArea] = useState('')

  const toggleCategory = (name: string) => {
    const current = data.selectedCategories
    if (current.includes(name)) {
      onChange({ selectedCategories: current.filter(c => c !== name) })
    } else {
      onChange({ selectedCategories: [...current, name] })
    }
  }

  const addArea = () => {
    const trimmed = newArea.trim()
    if (trimmed && !(data.tableAreas || []).includes(trimmed)) {
      onChange({ tableAreas: [...(data.tableAreas || []), trimmed] })
      setNewArea('')
    }
  }

  const removeArea = (area: string) => {
    const areas = (data.tableAreas || []).filter(a => a !== area)
    if (areas.length > 0) {
      onChange({ tableAreas: areas })
    }
  }

  // Initialize with defaults if empty - using useEffect to avoid render-time state updates
  useEffect(() => {
    if (data.selectedCategories.length === 0) {
      const defaults = restaurantCategories.filter(c => c.selected).map(c => c.name)
      onChange({ 
        selectedCategories: defaults,
        tableAreas: data.tableAreas?.length ? data.tableAreas : defaultTableAreas,
      })
    }
  }, [data.selectedCategories.length, data.tableAreas, onChange])

  return (
    <div className="space-y-6">
      {/* Tables configuration */}
      <div>
        <FormField label="Number of Tables">
          <FormInput
            type="number"
            min="1"
            max="200"
            value={data.numberOfTables || 10}
            onChange={(e) => onChange({ numberOfTables: parseInt(e.target.value) || 1 })}
            className="w-32"
          />
        </FormField>
        {/* AI suggestion for table count */}
        {!dismissed?.has('tables') && (
          <AISuggestionChip
            label={suggestions?.numberOfTables ? `${suggestions.numberOfTables} tables` : ''}
            reason={suggestions?.tableNote}
            loading={suggestionsLoading}
            onApply={() => {
              if (suggestions?.numberOfTables) {
                onChange({ numberOfTables: suggestions.numberOfTables })
              }
            }}
            onDismiss={() => onDismiss?.('tables')}
            alreadyApplied={suggestions?.numberOfTables === data.numberOfTables}
          />
        )}
      </div>

      {/* Table areas */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
          Table Areas
        </label>
        <div className="flex flex-wrap gap-2 mb-2">
          {(data.tableAreas || []).map((area) => (
            <span
              key={area}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 rounded text-sm border border-blue-200 dark:border-blue-800"
            >
              {area}
              {(data.tableAreas || []).length > 1 && (
                <button onClick={() => removeArea(area)} className="hover:text-blue-900 dark:hover:text-blue-100">
                  <X size={14} />
                </button>
              )}
            </span>
          ))}
        </div>
        <div className="flex gap-2 max-w-xs">
          <FormInput
            value={newArea}
            onChange={(e) => setNewArea(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addArea()}
            placeholder="Add area..."
            className="flex-1"
          />
          <button
            onClick={addArea}
            disabled={!newArea.trim()}
            className="px-3 py-2 bg-gray-100 dark:bg-slate-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-slate-500 transition-colors disabled:opacity-50"
          >
            <Plus size={18} />
          </button>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Tables will be distributed evenly across areas (e.g. T1-T4 in Main Hall, T5-T7 in Outdoor).
        </p>
      </div>

      {/* Menu categories */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
          Menu Categories
        </label>

        {/* AI suggestion banner */}
        {!dismissed?.has('categories') && (
          <AISuggestionBanner
            items={suggestions?.suggestedCategories || []}
            loading={suggestionsLoading}
            itemLabel="menu categories"
            onApplyAll={() => {
              if (suggestions?.suggestedCategories) {
                onChange({ selectedCategories: suggestions.suggestedCategories })
              }
            }}
            onDismiss={() => onDismiss?.('categories')}
          />
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {restaurantCategories.map((cat) => (
            <label
              key={cat.name}
              className={`flex items-center gap-2 px-3 py-2.5 rounded border cursor-pointer transition-colors ${
                data.selectedCategories.includes(cat.name)
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300'
                  : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
              }`}
            >
              <input
                type="checkbox"
                checked={data.selectedCategories.includes(cat.name)}
                onChange={() => toggleCategory(cat.name)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm">{cat.name}</span>
            </label>
          ))}
        </div>

        {/* Add custom category */}
        <div className="flex gap-2 max-w-sm mt-3">
          <FormInput
            value={customCategory}
            onChange={(e) => setCustomCategory(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const trimmed = customCategory.trim()
                if (trimmed && !data.selectedCategories.includes(trimmed)) {
                  onChange({ selectedCategories: [...data.selectedCategories, trimmed] })
                  setCustomCategory('')
                }
              }
            }}
            placeholder="Add custom category..."
            className="flex-1"
          />
          <button
            onClick={() => {
              const trimmed = customCategory.trim()
              if (trimmed && !data.selectedCategories.includes(trimmed)) {
                onChange({ selectedCategories: [...data.selectedCategories, trimmed] })
                setCustomCategory('')
              }
            }}
            disabled={!customCategory.trim()}
            className="px-3 py-2 bg-gray-100 dark:bg-slate-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-slate-500 transition-colors disabled:opacity-50"
          >
            <Plus size={18} />
          </button>
        </div>
      </div>
    </div>
  )
}
