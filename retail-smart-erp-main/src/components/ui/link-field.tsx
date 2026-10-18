'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, X, Plus, Loader2, Search } from 'lucide-react'

export interface LinkFieldOption {
  value: string
  label: string
  sublabel?: string
  data?: Record<string, unknown>
}

export interface LinkFieldProps {
  value: string
  onChange: (value: string, option?: LinkFieldOption) => void
  fetchOptions: (search: string) => Promise<LinkFieldOption[]>
  onCreateNew?: (searchTerm: string) => void
  placeholder?: string
  createLabel?: string
  disabled?: boolean
  className?: string
  displayValue?: string // What to show when value is selected
  autoFocus?: boolean
}

export function LinkField({
  value,
  onChange,
  fetchOptions,
  onCreateNew,
  placeholder = 'Select...',
  createLabel = 'Create new',
  disabled = false,
  className = '',
  displayValue,
  autoFocus = false,
}: LinkFieldProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [options, setOptions] = useState<LinkFieldOption[]>([])
  const [loading, setLoading] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [selectedLabel, setSelectedLabel] = useState(displayValue || '')
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({})

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const fetchIdRef = useRef(0)
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Calculate dropdown position based on input field's bounding rect
  const updateDropdownPosition = useCallback(() => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    setDropdownStyle({
      position: 'fixed',
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      zIndex: 9999,
    })
  }, [])

  // Core fetch function
  const doFetch = useCallback((searchTerm: string) => {
    const fetchId = ++fetchIdRef.current
    setLoading(true)

    fetchOptions(searchTerm)
      .then((results) => {
        if (fetchId === fetchIdRef.current) {
          setOptions(results || [])
          setHighlightedIndex(-1)
          setLoading(false)
        }
      })
      .catch((error) => {
        console.error('LinkField fetch error:', error)
        if (fetchId === fetchIdRef.current) {
          setOptions([])
          setLoading(false)
        }
      })
  }, [fetchOptions])

  // Open dropdown and fetch initial results
  const openDropdown = useCallback(() => {
    if (disabled) return
    updateDropdownPosition()
    setIsOpen(true)
    doFetch('')
  }, [disabled, doFetch, updateDropdownPosition])

  // Handle search input change with debounce
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setSearch(val)
    if (!isOpen) {
      setIsOpen(true)
      updateDropdownPosition()
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }
    debounceTimerRef.current = setTimeout(() => {
      doFetch(val)
    }, 300)
  }, [isOpen, doFetch, updateDropdownPosition])

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [])

  // Update selected label when displayValue changes
  useEffect(() => {
    if (displayValue !== undefined) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedLabel(displayValue)
    }
  }, [displayValue])

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return

    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node
      if (
        containerRef.current && !containerRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setIsOpen(false)
        setSearch('')
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  // Update position on scroll/resize while open
  useEffect(() => {
    if (!isOpen) return

    const handleScroll = () => updateDropdownPosition()
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleScroll)
    return () => {
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleScroll)
    }
  }, [isOpen, updateDropdownPosition])

  // Scroll highlighted option into view
  useEffect(() => {
    if (highlightedIndex >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll('[data-option]')
      const item = items[highlightedIndex] as HTMLElement
      if (item) {
        item.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [highlightedIndex])

  const handleSelect = useCallback((option: LinkFieldOption) => {
    onChange(option.value, option)
    setSelectedLabel(option.label)
    setIsOpen(false)
    setSearch('')
    setHighlightedIndex(-1)
  }, [onChange])

  const handleClear = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onChange('', undefined)
    setSelectedLabel('')
    setSearch('')
    inputRef.current?.focus()
  }, [onChange])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === ' ') {
        e.preventDefault()
        openDropdown()
      }
      return
    }

    const totalOptions = options.length + (onCreateNew ? 1 : 0)

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setHighlightedIndex(prev => (prev + 1) % totalOptions)
        break
      case 'ArrowUp':
        e.preventDefault()
        setHighlightedIndex(prev => (prev - 1 + totalOptions) % totalOptions)
        break
      case 'Enter':
        e.preventDefault()
        if (highlightedIndex >= 0 && highlightedIndex < options.length) {
          handleSelect(options[highlightedIndex])
        } else if (highlightedIndex === options.length && onCreateNew) {
          onCreateNew(search)
          setIsOpen(false)
          setSearch('')
        }
        break
      case 'Escape':
        e.preventDefault()
        setIsOpen(false)
        setSearch('')
        break
      case 'Tab':
        setIsOpen(false)
        setSearch('')
        break
    }
  }, [isOpen, options, highlightedIndex, handleSelect, onCreateNew, search, openDropdown])

  const handleInputFocus = useCallback(() => {
    if (!isOpen) {
      openDropdown()
    }
  }, [isOpen, openDropdown])

  // Render dropdown via portal to escape overflow clipping
  const dropdownContent = isOpen ? createPortal(
    <div
      ref={dropdownRef}
      style={dropdownStyle}
      className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg max-h-60 overflow-hidden"
    >
      <div ref={listRef} className="overflow-y-auto max-h-48">
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 size={16} className="animate-spin text-gray-400" />
            <span className="ml-2 text-sm text-gray-500">Loading...</span>
          </div>
        ) : options.length === 0 ? (
          <div className="py-3 px-3 text-sm text-gray-500 dark:text-gray-400 text-center">
            {search ? 'No results found' : 'No items found'}
          </div>
        ) : (
          options.map((option, index) => (
            <div
              key={option.value}
              data-option
              onClick={() => handleSelect(option)}
              className={`
                px-3 py-2 cursor-pointer text-sm
                ${highlightedIndex === index
                  ? 'bg-blue-50 dark:bg-blue-900/50'
                  : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                }
                ${option.value === value ? 'bg-blue-50 dark:bg-blue-900/30' : ''}
              `}
            >
              <div className="font-medium text-gray-900 dark:text-white truncate">
                {option.label}
              </div>
              {option.sublabel && (
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {option.sublabel}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Create New Option */}
      {onCreateNew && (
        <div
          data-option
          onClick={() => {
            onCreateNew(search)
            setIsOpen(false)
            setSearch('')
          }}
          className={`
            flex items-center gap-2 px-3 py-2 border-t border-gray-200 dark:border-gray-700
            cursor-pointer text-sm text-blue-600 dark:text-blue-400
            ${highlightedIndex === options.length
              ? 'bg-blue-50 dark:bg-blue-900/50'
              : 'hover:bg-gray-50 dark:hover:bg-gray-700'
            }
          `}
        >
          <Plus size={14} />
          {createLabel}{search && `: "${search}"`}
        </div>
      )}
    </div>,
    document.body
  ) : null

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Input Field */}
      <div
        className={`
          flex items-center gap-1 px-2 py-1.5 border rounded-md bg-white dark:bg-gray-800
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-text'}
          ${isOpen ? 'ring-2 ring-blue-500 border-blue-500' : 'border-gray-300 dark:border-gray-600'}
          dark:text-white
        `}
        onClick={() => {
          if (!disabled) {
            if (!isOpen) {
              openDropdown()
            }
            inputRef.current?.focus()
          }
        }}
      >
        {isOpen ? (
          <>
            <Search size={14} className="text-gray-400 flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onFocus={handleInputFocus}
              placeholder={selectedLabel || placeholder}
              disabled={disabled}
              autoFocus={autoFocus}
              className="flex-1 min-w-0 bg-transparent outline-none text-sm placeholder-gray-400 dark:placeholder-gray-500"
            />
          </>
        ) : (
          <>
            <span className={`flex-1 text-sm truncate ${value ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'}`}>
              {selectedLabel || placeholder}
            </span>
          </>
        )}

        {value && !disabled && !isOpen && (
          <button
            type="button"
            onClick={handleClear}
            className="p-0.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          >
            <X size={14} className="text-gray-400" />
          </button>
        )}

        <ChevronDown
          size={14}
          className={`text-gray-400 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </div>

      {dropdownContent}
    </div>
  )
}
