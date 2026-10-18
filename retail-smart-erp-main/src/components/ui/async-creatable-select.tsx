'use client'

import { useState, useRef, useEffect, useCallback, useId } from 'react'
import { ChevronDown, Check, Search, Plus, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDebouncedValue } from '@/hooks'

export interface AsyncSelectOption {
  value: string
  label: string
  data?: Record<string, unknown>
}

interface AsyncCreatableSelectProps {
  /** Fetch options from API. Called with search string, returns options. */
  fetchOptions: (search: string) => Promise<AsyncSelectOption[]>
  /** Current selected value (option.value) */
  value: string
  /** Called when selection changes */
  onChange: (value: string, option: AsyncSelectOption | null) => void
  /** Called when user clicks "Create new" */
  onCreateNew?: (searchText: string) => void
  /** Placeholder text */
  placeholder?: string
  /** Label for create button */
  createLabel?: string
  /** Whether the select is disabled */
  disabled?: boolean
  /** Pre-selected option (to display label when value is set but options aren't loaded) */
  selectedOption?: AsyncSelectOption | null
  /** Additional CSS class */
  className?: string
  /** Cache TTL in ms (default 30000) */
  cacheTtl?: number
}

// Simple in-memory cache
const optionCache = new Map<string, { options: AsyncSelectOption[]; expires: number }>()

export function clearAsyncSelectCache() {
  optionCache.clear()
}

export function AsyncCreatableSelect({
  fetchOptions,
  value,
  onChange,
  onCreateNew,
  placeholder = 'Search...',
  createLabel = 'Create new',
  disabled = false,
  selectedOption: initialSelectedOption = null,
  className,
  cacheTtl = 30000,
}: AsyncCreatableSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [options, setOptions] = useState<AsyncSelectOption[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedOption, setSelectedOption] = useState<AsyncSelectOption | null>(initialSelectedOption)

  const listboxId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const fetchIdRef = useRef(0)

  const debouncedSearch = useDebouncedValue(search, 300)

  // Sync external selectedOption
  useEffect(() => {
    if (initialSelectedOption) {
      setSelectedOption(initialSelectedOption)
    }
  }, [initialSelectedOption])

  // Fetch options when search changes
  const doFetch = useCallback(async (searchTerm: string) => {
    const cacheKey = `${searchTerm}`
    const cached = optionCache.get(cacheKey)
    if (cached && cached.expires > Date.now()) {
      setOptions(cached.options)
      setLoading(false)
      return
    }

    const fetchId = ++fetchIdRef.current
    setLoading(true)

    try {
      const results = await fetchOptions(searchTerm)
      if (fetchId !== fetchIdRef.current) return // Stale request

      setOptions(results)
      optionCache.set(cacheKey, { options: results, expires: Date.now() + cacheTtl })
    } catch {
      if (fetchId === fetchIdRef.current) {
        setOptions([])
      }
    } finally {
      if (fetchId === fetchIdRef.current) {
        setLoading(false)
      }
    }
  }, [fetchOptions, cacheTtl])

  useEffect(() => {
    if (isOpen) {
      doFetch(debouncedSearch)
    }
  }, [debouncedSearch, isOpen, doFetch])

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Focus input when dropdown opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [isOpen])

  function handleSelect(option: AsyncSelectOption) {
    setSelectedOption(option)
    onChange(option.value, option)
    setIsOpen(false)
    setSearch('')
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation()
    setSelectedOption(null)
    onChange('', null)
    setSearch('')
  }

  function handleCreateNew() {
    onCreateNew?.(search)
    setIsOpen(false)
    setSearch('')
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setIsOpen(false)
      setSearch('')
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (options.length === 1) {
        handleSelect(options[0])
      }
    }
  }

  const displayLabel = selectedOption?.label || ''

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <div
        className={cn(
          'flex items-center gap-2 border rounded-md bg-white dark:bg-gray-800 transition-all',
          'h-9 px-3 py-2 text-sm',
          disabled && 'opacity-50 cursor-not-allowed',
          !disabled && 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500',
          isOpen && !disabled && 'ring-2 ring-blue-500 border-blue-500',
          'w-full'
        )}
        onClick={() => {
          if (disabled) return
          setIsOpen(!isOpen)
        }}
        role="combobox"
        tabIndex={disabled ? -1 : 0}
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-haspopup="listbox"
      >
        {isOpen ? (
          <div className="flex-1 flex items-center gap-2">
            <Search size={14} className="text-gray-400 flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1 min-w-0 bg-transparent outline-none text-sm placeholder-gray-400 dark:placeholder-gray-500"
              placeholder={displayLabel || placeholder}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        ) : (
          <span className={cn(
            'flex-1 text-left truncate',
            value ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'
          )}>
            {displayLabel || placeholder}
          </span>
        )}

        <div className="flex items-center gap-1">
          {value && !disabled && !isOpen && (
            <button
              type="button"
              onClick={handleClear}
              className="p-0.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              aria-label="Clear selection"
            >
              <X size={14} className="text-gray-400" />
            </button>
          )}
          {loading ? (
            <Loader2 size={14} className="text-gray-400 animate-spin flex-shrink-0" />
          ) : (
            <ChevronDown
              size={14}
              className={cn(
                'text-gray-400 flex-shrink-0 transition-transform',
                isOpen && 'rotate-180'
              )}
            />
          )}
        </div>
      </div>

      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg overflow-hidden">
          <div className="overflow-y-auto max-h-48" role="listbox" id={listboxId}>
            {loading && options.length === 0 ? (
              <div className="py-3 px-3 text-sm text-gray-500 dark:text-gray-400 text-center flex items-center justify-center gap-2">
                <Loader2 size={14} className="animate-spin" />
                Searching...
              </div>
            ) : options.length === 0 && !loading ? (
              <div className="py-3 px-3 text-sm text-gray-500 dark:text-gray-400 text-center">
                {search ? 'No results found' : 'Type to search...'}
              </div>
            ) : (
              options.map((option) => (
                <div
                  key={option.value}
                  className={cn(
                    'px-3 py-2 cursor-pointer text-sm flex items-center gap-2',
                    'hover:bg-gray-50 dark:hover:bg-gray-700',
                    option.value === value && 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                  )}
                  onClick={() => handleSelect(option)}
                  role="option"
                  aria-selected={option.value === value}
                >
                  <span className="flex-1 truncate">{option.label}</span>
                  {option.value === value && (
                    <Check size={14} className="text-blue-600 dark:text-blue-400 flex-shrink-0" />
                  )}
                </div>
              ))
            )}
          </div>

          {onCreateNew && (
            <div className="border-t border-gray-200 dark:border-gray-700">
              <button
                type="button"
                onClick={handleCreateNew}
                className="w-full px-3 py-2 text-sm text-left flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
              >
                <Plus size={14} />
                {createLabel}{search ? `: "${search}"` : ''}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
