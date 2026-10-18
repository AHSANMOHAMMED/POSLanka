'use client'

import * as React from 'react'
import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
  icon?: React.ReactNode
}

export interface SelectProps {
  options: SelectOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  error?: boolean
  size?: 'sm' | 'md' | 'lg'
  searchable?: boolean
  className?: string
  fullWidth?: boolean
  clearable?: boolean
  onClear?: () => void
}

export const Select = React.forwardRef<HTMLDivElement, SelectProps>(
  ({
    options,
    value,
    onChange,
    placeholder = 'Select...',
    disabled = false,
    error = false,
    size = 'md',
    searchable = false,
    className = '',
    fullWidth = false,
    clearable = false,
    onClear,
  }, _ref) => {
    const [isOpen, setIsOpen] = useState(false)
    const [search, setSearch] = useState('')
    const containerRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    const selectedOption = options.find(o => o.value === value)

    const sizeClasses = {
      sm: 'h-8 px-2.5 py-1 text-sm',
      md: 'h-9 px-3 py-2 text-sm',
      lg: 'h-10 px-4 py-2.5 text-base',
    }

    const filteredOptions = searchable 
      ? options.filter(option => 
          option.label.toLowerCase().includes(search.toLowerCase())
        )
      : options

    // Close dropdown when clicking outside
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

    // Focus input when searchable and dropdown opens
    useEffect(() => {
      if (isOpen && searchable && inputRef.current) {
        setTimeout(() => inputRef.current?.focus(), 0)
      }
    }, [isOpen, searchable])

    function handleSelect(optionValue: string) {
      if (disabled) return
      onChange(optionValue)
      setIsOpen(false)
      setSearch('')
    }

    function handleClear(e: React.MouseEvent) {
      e.stopPropagation()
      if (disabled) return
      onChange('')
      onClear?.()
      setIsOpen(false)
      setSearch('')
    }

    function handleKeyDown(e: React.KeyboardEvent) {
      if (e.key === 'Enter') {
        e.preventDefault()
        if (filteredOptions.length === 1) {
          handleSelect(filteredOptions[0].value)
        }
      } else if (e.key === 'Escape') {
        setIsOpen(false)
        setSearch('')
      }
    }

    return (
      <div 
        ref={containerRef} 
        className={cn('relative', fullWidth && 'w-full', className)}
      >
        <div
          className={cn(
            'flex items-center gap-2 border rounded bg-white dark:bg-gray-800 transition-all',
            'text-gray-900 dark:text-white',
            sizeClasses[size],
            disabled && 'opacity-50 cursor-not-allowed',
            error && 'border-red-500 focus:border-red-500 focus:ring-red-500',
            !disabled && !error && 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500',
            isOpen && !disabled && 'ring-2 ring-blue-500 border-blue-500',
            fullWidth && 'w-full'
          )}
          onClick={() => {
            if (disabled) return
            setIsOpen(!isOpen)
          }}
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-disabled={disabled}
        >
          {isOpen && searchable ? (
            <div className="flex-1 flex items-center gap-2">
              <Search size={16} className="text-gray-400 flex-shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleKeyDown}
                className="flex-1 min-w-0 bg-transparent outline-none text-sm placeholder-gray-400 dark:placeholder-gray-500"
                placeholder={selectedOption?.label || placeholder}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          ) : (
            <span className={cn(
              'flex-1 text-left truncate',
              value ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'
            )}>
              {selectedOption ? (
                <span className="flex items-center gap-2">
                  {selectedOption.icon}
                  {selectedOption.label}
                </span>
              ) : placeholder}
            </span>
          )}

          <div className="flex items-center gap-1">
            {clearable && value && !disabled && !isOpen && (
              <button
                type="button"
                onClick={handleClear}
                className="p-0.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                aria-label="Clear selection"
              >
                <span className="sr-only">Clear</span>
                <span className="text-gray-400 text-xs">×</span>
              </button>
            )}
            <ChevronDown
              size={16}
              className={cn(
                'text-gray-400 flex-shrink-0 transition-transform',
                isOpen && 'rotate-180'
              )}
            />
          </div>
        </div>

        {isOpen && (
          <div className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg max-h-60 overflow-hidden">
            {filteredOptions.length === 0 ? (
              <div className="py-3 px-3 text-sm text-gray-500 dark:text-gray-400 text-center">
                {search ? 'No results found' : 'No options available'}
              </div>
            ) : (
              <div 
                className="overflow-y-auto max-h-48"
                role="listbox"
                aria-label="Select options"
              >
                {filteredOptions.map((option) => (
                  <div
                    key={option.value}
                    className={cn(
                      'px-3 py-2 cursor-pointer text-sm flex items-center gap-2',
                      'hover:bg-gray-50 dark:hover:bg-gray-700',
                      option.value === value && 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
                      option.disabled && 'opacity-50 cursor-not-allowed'
                    )}
                    onClick={() => !option.disabled && handleSelect(option.value)}
                    role="option"
                    aria-selected={option.value === value}
                    aria-disabled={option.disabled}
                  >
                    {option.icon}
                    <span className="flex-1">{option.label}</span>
                    {option.value === value && (
                      <Check size={14} className="text-blue-600 dark:text-blue-400 flex-shrink-0" />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }
)
Select.displayName = 'Select'

// Select with groups support
export interface SelectGroup {
  label: string
  options: SelectOption[]
}

export interface GroupedSelectProps extends Omit<SelectProps, 'options'> {
  groups: SelectGroup[]
}

export const GroupedSelect = React.forwardRef<HTMLDivElement, GroupedSelectProps>(
  ({ groups, value, onChange, ...props }, ref) => {
    const [isOpen, setIsOpen] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
      function handleClickOutside(e: MouseEvent) {
        if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
          setIsOpen(false)
        }
      }

      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    return (
      <div ref={containerRef} className="relative">
        <Select
          ref={ref}
          options={[]}
          value={value}
          onChange={onChange}
          {...props}
        />

        {isOpen && (
          <div className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg max-h-60 overflow-hidden">
            <div className="overflow-y-auto max-h-48">
              {groups.map((group, groupIndex) => (
                <div key={groupIndex}>
                  {group.label && (
                    <div className="px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider bg-gray-50 dark:bg-gray-700">
                      {group.label}
                    </div>
                  )}
                  {group.options.map((option) => (
                    <div
                      key={option.value}
                      className={cn(
                        'px-3 py-2 cursor-pointer text-sm flex items-center gap-2',
                        'hover:bg-gray-50 dark:hover:bg-gray-700',
                        option.value === value && 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
                        option.disabled && 'opacity-50 cursor-not-allowed'
                      )}
                      onClick={() => {
                        if (!option.disabled) {
                          onChange(option.value)
                          setIsOpen(false)
                        }
                      }}
                    >
                      {option.icon}
                      <span className="flex-1">{option.label}</span>
                      {option.value === value && (
                        <Check size={14} className="text-blue-600 dark:text-blue-400 flex-shrink-0" />
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }
)
GroupedSelect.displayName = 'GroupedSelect'