'use client'

import { retailCategories } from '@/lib/setup/seed-data'
import type { SetupWizardData } from '@/lib/setup/create-seed-data'
import { useState, useEffect } from 'react'
import { Plus, X } from 'lucide-react'
import { AISuggestionBanner } from './AISuggestionChip'
import { FormInput } from '@/components/ui/form-elements'

interface RetailConfigProps {
  data: SetupWizardData
  onChange: (updates: Partial<SetupWizardData>) => void
  suggestions?: { suggestedCategories?: string[] } | null
  suggestionsLoading?: boolean
  dismissed?: Set<string>
  onDismiss?: (key: string) => void
}

export function RetailConfig({ data, onChange, suggestions, suggestionsLoading, dismissed, onDismiss }: RetailConfigProps) {
  const [customCategory, setCustomCategory] = useState('')

  const toggleCategory = (name: string) => {
    const current = data.selectedCategories
    if (current.includes(name)) {
      onChange({ selectedCategories: current.filter(c => c !== name) })
    } else {
      onChange({ selectedCategories: [...current, name] })
    }
  }

  const addCustom = () => {
    const trimmed = customCategory.trim()
    if (trimmed && !data.selectedCategories.includes(trimmed)) {
      onChange({ selectedCategories: [...data.selectedCategories, trimmed] })
      setCustomCategory('')
    }
  }

  // Initialize with defaults if empty - using useEffect to avoid render-time state updates
  useEffect(() => {
    if (data.selectedCategories.length === 0) {
      const defaults = retailCategories.filter(c => c.selected).map(c => c.name)
      onChange({ selectedCategories: defaults })
    }
  }, [data.selectedCategories.length, onChange])

  const allCategories = [
    ...retailCategories.map(c => c.name),
    ...data.selectedCategories.filter(c => !retailCategories.find(r => r.name === c)),
  ]

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
          Product Categories
        </label>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Select the categories you want to start with. You can add more later.
        </p>

        {/* AI suggestion banner */}
        {!dismissed?.has('categories') && (
          <AISuggestionBanner
            items={suggestions?.suggestedCategories || []}
            loading={suggestionsLoading}
            itemLabel="categories"
            onApplyAll={() => {
              if (suggestions?.suggestedCategories) {
                onChange({ selectedCategories: suggestions.suggestedCategories })
              }
            }}
            onDismiss={() => onDismiss?.('categories')}
          />
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {allCategories.map((name) => (
            <label
              key={name}
              className={`flex items-center gap-2 px-3 py-2.5 rounded border cursor-pointer transition-colors ${
                data.selectedCategories.includes(name)
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300'
                  : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
              }`}
            >
              <input
                type="checkbox"
                checked={data.selectedCategories.includes(name)}
                onChange={() => toggleCategory(name)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm">{name}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Add custom category */}
      <div className="flex gap-2 max-w-sm">
        <FormInput
          value={customCategory}
          onChange={(e) => setCustomCategory(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addCustom()}
          placeholder="Add custom category..."
          className="flex-1"
        />
        <button
          onClick={addCustom}
          disabled={!customCategory.trim()}
          className="px-3 py-2 bg-gray-100 dark:bg-slate-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-slate-500 transition-colors disabled:opacity-50"
        >
          <Plus size={18} />
        </button>
      </div>

      {/* Custom categories tags */}
      {data.selectedCategories.filter(c => !retailCategories.find(r => r.name === c)).length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {data.selectedCategories
            .filter(c => !retailCategories.find(r => r.name === c))
            .map(name => (
              <span key={name} className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-xs">
                {name}
                <button onClick={() => toggleCategory(name)} className="hover:text-blue-900 dark:hover:text-blue-100">
                  <X size={14} />
                </button>
              </span>
            ))}
        </div>
      )}
    </div>
  )
}
