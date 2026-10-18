'use client'

import { autoServiceGroups, autoServicePartCategories } from '@/lib/setup/seed-data'
import type { SetupWizardData } from '@/lib/setup/create-seed-data'
import type { ServiceGroupSeed } from '@/lib/setup/seed-data'
import { useState, useEffect } from 'react'
import { ChevronDown, ChevronUp, Plus, X } from 'lucide-react'
import { AISuggestionBanner, AISuggestionChip } from './AISuggestionChip'
import { FormInput, FormField } from '@/components/ui/form-elements'

interface AutoServiceConfigProps {
  data: SetupWizardData
  onChange: (updates: Partial<SetupWizardData>) => void
  currency?: string
  suggestions?: {
    suggestedCategories?: string[]
    defaultLaborRate?: number
    laborRateNote?: string
  } | null
  suggestionsLoading?: boolean
  dismissed?: Set<string>
  onDismiss?: (key: string) => void
}

export function AutoServiceConfig({ data, onChange, currency, suggestions, suggestionsLoading, dismissed, onDismiss }: AutoServiceConfigProps) {
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)
  const [customCategory, setCustomCategory] = useState('')

  // Initialize with defaults only if no data has been loaded (e.g. fresh setup)
  useEffect(() => {
    const hasServiceGroups = data.selectedServiceGroups && data.selectedServiceGroups.length > 0
    const hasCategories = data.selectedCategories && data.selectedCategories.length > 0
    if (!hasServiceGroups && !hasCategories) {
      const defaults = autoServicePartCategories.filter(c => c.selected).map(c => c.name)
      onChange({
        selectedServiceGroups: autoServiceGroups,
        selectedCategories: defaults,
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleGroup = (group: ServiceGroupSeed) => {
    const current = data.selectedServiceGroups || []
    const exists = current.find(g => g.name === group.name)
    if (exists) {
      onChange({ selectedServiceGroups: current.filter(g => g.name !== group.name) })
    } else {
      onChange({ selectedServiceGroups: [...current, group] })
    }
  }

  const isGroupSelected = (name: string) => {
    return (data.selectedServiceGroups || []).some(g => g.name === name)
  }

  const toggleCategory = (name: string) => {
    const current = data.selectedCategories
    if (current.includes(name)) {
      onChange({ selectedCategories: current.filter(c => c !== name) })
    } else {
      onChange({ selectedCategories: [...current, name] })
    }
  }

  // Don't render until service groups are initialized
  if (!data.selectedServiceGroups || data.selectedServiceGroups.length === 0) {
    return <div className="text-center py-8 text-gray-500 dark:text-gray-400">Loading service configuration...</div>
  }

  return (
    <div className="space-y-6">
      {/* Service Groups */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
          Service Groups
        </label>
        <div className="space-y-2">
          {autoServiceGroups.map((group) => (
            <div key={group.name} className="border border-gray-200 dark:border-gray-600 rounded overflow-hidden">
              <div
                className={`flex items-center justify-between px-4 py-3 cursor-pointer transition-colors ${
                  isGroupSelected(group.name)
                    ? 'bg-blue-50 dark:bg-blue-950/30'
                    : 'bg-white dark:bg-slate-700'
                }`}
                onClick={() => setExpandedGroup(expandedGroup === group.name ? null : group.name)}
              >
                <label className="flex items-center gap-3 cursor-pointer" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={isGroupSelected(group.name)}
                    onChange={() => toggleGroup(group)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <div>
                    <span className="text-sm font-medium text-gray-900 dark:text-white">{group.name}</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
                      ({group.services.length} services)
                    </span>
                  </div>
                </label>
                {expandedGroup === group.name ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
              </div>
              {expandedGroup === group.name && (
                <div className="px-4 py-2 bg-gray-50 dark:bg-slate-800 border-t border-gray-200 dark:border-gray-600">
                  <div className="grid grid-cols-2 gap-1">
                    {group.services.map((service) => (
                      <div key={service.name} className="text-xs text-gray-600 dark:text-gray-400 py-1">
                        {service.name}
                        {service.defaultHours && (
                          <span className="text-gray-400 ml-1">({service.defaultHours}h)</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Default Labor Rate */}
      <div>
        <FormField label="Default Labor Rate (per hour)">
          <FormInput
            type="number"
            min="0"
            step="0.01"
            value={data.defaultLaborRate || 50}
            onChange={(e) => onChange({ defaultLaborRate: parseFloat(e.target.value) || 0 })}
            className="w-40"
          />
        </FormField>
        {/* AI suggestion for labor rate */}
        {!dismissed?.has('laborRate') && (
          <AISuggestionChip
            label={suggestions?.defaultLaborRate ? `${suggestions.defaultLaborRate} ${currency || ''}/hr` : ''}
            reason={suggestions?.laborRateNote}
            loading={suggestionsLoading}
            onApply={() => {
              if (suggestions?.defaultLaborRate) {
                onChange({ defaultLaborRate: suggestions.defaultLaborRate })
              }
            }}
            onDismiss={() => onDismiss?.('laborRate')}
            alreadyApplied={suggestions?.defaultLaborRate === data.defaultLaborRate}
          />
        )}
        {!suggestions?.laborRateNote && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Applied to all service types. Override individually later.
          </p>
        )}
      </div>

      {/* Parts Categories */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
          Parts Categories
        </label>

        {/* AI suggestion banner */}
        {!dismissed?.has('categories') && (
          <AISuggestionBanner
            items={suggestions?.suggestedCategories || []}
            loading={suggestionsLoading}
            itemLabel="parts categories"
            onApplyAll={() => {
              if (suggestions?.suggestedCategories) {
                onChange({ selectedCategories: suggestions.suggestedCategories })
              }
            }}
            onDismiss={() => onDismiss?.('categories')}
          />
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {autoServicePartCategories.map((cat) => (
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

        {data.selectedCategories.filter(c => !autoServicePartCategories.find(r => r.name === c)).length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {data.selectedCategories
              .filter(c => !autoServicePartCategories.find(r => r.name === c))
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
    </div>
  )
}
