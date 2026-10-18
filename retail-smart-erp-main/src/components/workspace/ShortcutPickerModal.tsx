'use client'

import { useState, useMemo, useEffect } from 'react'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { Search, ChevronDown, ChevronRight } from 'lucide-react'
import { getIcon } from './icon-map'
import { buildShortcutCatalog, toRelativeHref } from '@/lib/workspace/shortcut-catalog'
import type { ShortcutCatalogGroup } from '@/lib/workspace/shortcut-catalog'

interface ShortcutData {
  label: string
  href: string
  icon: string
  color?: string
  countMetricKey?: string
}

interface ShortcutPickerModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (shortcuts: ShortcutData[]) => void
  currentShortcuts: ShortcutData[]
  businessType?: string
  role?: string
  isModuleEnabled?: (moduleKey: string, role?: string) => boolean
}

export function ShortcutPickerModal({
  isOpen,
  onClose,
  onSave,
  currentShortcuts,
  businessType,
  role,
  isModuleEnabled,
}: ShortcutPickerModalProps) {
  const [search, setSearch] = useState('')
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set())

  // Build catalog from module navigation
  const catalog = useMemo(
    () => buildShortcutCatalog(businessType, role, isModuleEnabled),
    [businessType, role, isModuleEnabled]
  )

  // Normalize current shortcuts to relative hrefs for comparison
  const currentRelativeHrefs = useMemo(
    () => new Set(currentShortcuts.map((s) => toRelativeHref(s.href))),
    [currentShortcuts]
  )

  // Track selected hrefs (start from current)
  const [selectedHrefs, setSelectedHrefs] = useState<Set<string>>(
    () => new Set(currentShortcuts.map((s) => toRelativeHref(s.href)))
  )

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedHrefs(new Set(currentShortcuts.map((s) => toRelativeHref(s.href))))
      setSearch('')
      // Expand all modules by default
      setExpandedModules(new Set(catalog.map((g) => g.moduleKey)))
    }
  }, [isOpen, currentShortcuts, catalog])

  // Filter catalog by search
  const filteredCatalog = useMemo(() => {
    if (!search.trim()) return catalog
    const q = search.toLowerCase()
    return catalog
      .map((group): ShortcutCatalogGroup => ({
        ...group,
        items: group.items.filter(
          (item) =>
            item.label.toLowerCase().includes(q) ||
            item.moduleLabel.toLowerCase().includes(q)
        ),
      }))
      .filter((group) => group.items.length > 0)
  }, [catalog, search])

  function toggleHref(href: string) {
    setSelectedHrefs((prev) => {
      const next = new Set(prev)
      if (next.has(href)) {
        next.delete(href)
      } else {
        next.add(href)
      }
      return next
    })
  }

  function toggleModule(moduleKey: string) {
    setExpandedModules((prev) => {
      const next = new Set(prev)
      if (next.has(moduleKey)) {
        next.delete(moduleKey)
      } else {
        next.add(moduleKey)
      }
      return next
    })
  }

  function selectAllInModule(group: ShortcutCatalogGroup) {
    setSelectedHrefs((prev) => {
      const next = new Set(prev)
      for (const item of group.items) {
        next.add(item.href)
      }
      return next
    })
  }

  function deselectAllInModule(group: ShortcutCatalogGroup) {
    setSelectedHrefs((prev) => {
      const next = new Set(prev)
      for (const item of group.items) {
        next.delete(item.href)
      }
      return next
    })
  }

  function handleSave() {
    // Build result: preserve existing shortcuts in order with their properties,
    // then append newly selected items
    const result: ShortcutData[] = []
    const addedHrefs = new Set<string>()

    // Keep existing shortcuts that are still selected (preserves order + properties)
    for (const s of currentShortcuts) {
      const rel = toRelativeHref(s.href)
      if (selectedHrefs.has(rel)) {
        result.push({ ...s, href: rel })
        addedHrefs.add(rel)
      }
    }

    // Add newly selected items from catalog
    for (const group of catalog) {
      for (const item of group.items) {
        if (selectedHrefs.has(item.href) && !addedHrefs.has(item.href)) {
          result.push({
            label: item.label,
            href: item.href,
            icon: item.icon,
          })
          addedHrefs.add(item.href)
        }
      }
    }

    onSave(result)
  }

  const addedCount = selectedHrefs.size - currentRelativeHrefs.size
  const removedCount = [...currentRelativeHrefs].filter((h) => !selectedHrefs.has(h)).length
  const hasChanges = addedCount !== 0 || removedCount !== 0

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add Shortcuts" size="lg">
      <ModalBody>
        {/* Search */}
        <div className="relative">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            type="text"
            placeholder="Search pages..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
            autoFocus
          />
        </div>

        {/* Module groups */}
        <div className="max-h-[400px] overflow-y-auto -mx-1 px-1 space-y-1">
          {filteredCatalog.length === 0 ? (
            <div className="text-center py-8 text-sm text-gray-400 dark:text-gray-500">
              No pages found
            </div>
          ) : (
            filteredCatalog.map((group) => {
              const isExpanded = expandedModules.has(group.moduleKey)
              const ModuleIcon = getIcon(group.moduleIcon)
              const selectedInGroup = group.items.filter((i) =>
                selectedHrefs.has(i.href)
              ).length
              const allSelected = selectedInGroup === group.items.length

              return (
                <div
                  key={group.moduleKey}
                  className="border border-gray-200 dark:border-gray-700 rounded overflow-hidden"
                >
                  {/* Module header */}
                  <button
                    type="button"
                    onClick={() => toggleModule(group.moduleKey)}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 transition-colors"
                  >
                    {isExpanded ? (
                      <ChevronDown size={14} className="text-gray-400 flex-shrink-0" />
                    ) : (
                      <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />
                    )}
                    <ModuleIcon size={16} className="text-gray-500 dark:text-gray-400 flex-shrink-0" />
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300 flex-1 text-left">
                      {group.moduleLabel}
                    </span>
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      {selectedInGroup}/{group.items.length}
                    </span>
                    {/* Select all / deselect all */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (allSelected) {
                          deselectAllInModule(group)
                        } else {
                          selectAllInModule(group)
                        }
                      }}
                      className="text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 px-1.5 py-0.5 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                    >
                      {allSelected ? 'Clear' : 'All'}
                    </button>
                  </button>

                  {/* Module items */}
                  {isExpanded && (
                    <div className="divide-y divide-gray-100 dark:divide-gray-700">
                      {group.items.map((item) => {
                        const Icon = getIcon(item.icon)
                        const isSelected = selectedHrefs.has(item.href)

                        return (
                          <button
                            key={item.href}
                            type="button"
                            onClick={() => toggleHref(item.href)}
                            className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                              isSelected
                                ? 'bg-blue-50/60 dark:bg-blue-900/15'
                                : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                            }`}
                          >
                            {/* Checkbox */}
                            <div
                              className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                                isSelected
                                  ? 'bg-blue-500 border-blue-500'
                                  : 'border-gray-300 dark:border-gray-600'
                              }`}
                            >
                              {isSelected && (
                                <svg
                                  width="10"
                                  height="8"
                                  viewBox="0 0 10 8"
                                  fill="none"
                                  className="text-white"
                                >
                                  <path
                                    d="M1 4L3.5 6.5L9 1"
                                    stroke="currentColor"
                                    strokeWidth="1.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              )}
                            </div>

                            {/* Icon */}
                            <div className="w-7 h-7 rounded-md bg-gray-100 dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
                              <Icon size={14} className="text-gray-500 dark:text-gray-400" />
                            </div>

                            {/* Label */}
                            <span className="text-sm text-gray-700 dark:text-gray-300 flex-1">
                              {item.label}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Selection summary */}
        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 pt-1">
          <span>{selectedHrefs.size} shortcut{selectedHrefs.size !== 1 ? 's' : ''} selected</span>
          {hasChanges && (
            <span>
              {addedCount > 0 && (
                <span className="text-green-600 dark:text-green-400">+{addedCount}</span>
              )}
              {addedCount > 0 && removedCount > 0 && ' / '}
              {removedCount > 0 && (
                <span className="text-red-500 dark:text-red-400">-{removedCount}</span>
              )}
            </span>
          )}
        </div>
      </ModalBody>

      <ModalFooter>
        <button
          onClick={onClose}
          className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={!hasChanges}
          className="px-4 py-2 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Save Shortcuts
        </button>
      </ModalFooter>
    </Modal>
  )
}
