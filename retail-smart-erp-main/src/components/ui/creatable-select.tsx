'use client'

import { useState, useRef, useEffect } from 'react'
import { Plus, ChevronDown, X } from 'lucide-react'

interface Option {
  value: string
  label: string
}

interface CreatableSelectProps {
  options: Option[]
  value: string
  onChange: (value: string) => void
  onCreateNew?: (searchValue: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  createLabel?: string
}

export function CreatableSelect({
  options,
  value,
  onChange,
  onCreateNew,
  placeholder = 'Select...',
  disabled = false,
  className = '',
  createLabel = 'Create new',
}: CreatableSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selectedOption = options.find(o => o.value === value)

  const filteredOptions = options.filter(o =>
    o.label.toLowerCase().includes(search.toLowerCase())
  )

  // Show create option when:
  // 1. onCreateNew is provided AND
  // 2. There's search text with no exact match
  const hasExactMatch = filteredOptions.some(
    o => o.label.toLowerCase() === search.toLowerCase().trim()
  )
  const showCreateOption = !!onCreateNew && search.trim() && !hasExactMatch

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

  function handleSelect(optionValue: string) {
    onChange(optionValue)
    setIsOpen(false)
    setSearch('')
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation()
    onChange('')
    setSearch('')
  }

  function handleCreateClick() {
    onCreateNew?.(search.trim())
    setIsOpen(false)
    setSearch('')
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (showCreateOption || (search.trim() && filteredOptions.length === 0)) {
        // Create new when: no exact match OR no results found
        handleCreateClick()
      } else if (filteredOptions.length === 1) {
        // Auto-select if only one option matches
        handleSelect(filteredOptions[0].value)
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false)
      setSearch('')
    }
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div
        className={`
          flex items-center gap-1 px-2 py-1.5 border rounded-md bg-white dark:bg-gray-800
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-text'}
          ${isOpen ? 'ring-2 ring-blue-500 border-blue-500' : 'border-gray-300 dark:border-gray-600'}
          dark:text-white
        `}
        onClick={() => {
          if (!disabled) {
            setIsOpen(true)
            setTimeout(() => inputRef.current?.focus(), 0)
          }
        }}
      >
        {isOpen ? (
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 min-w-0 bg-transparent outline-none text-sm placeholder-gray-400 dark:placeholder-gray-500"
            placeholder={selectedOption?.label || placeholder}
          />
        ) : (
          <span className={`flex-1 text-sm truncate ${value ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'}`}>
            {selectedOption?.label || placeholder}
          </span>
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

      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg max-h-60 overflow-hidden">
          <div className="overflow-y-auto max-h-48">
            {filteredOptions.length === 0 && !showCreateOption ? (
              <div className="py-3 px-3 text-sm text-gray-500 dark:text-gray-400 text-center">
                {search ? 'No results found' : 'Type to search...'}
              </div>
            ) : (
              filteredOptions.map((option) => (
                <div
                  key={option.value}
                  className={`
                    px-3 py-2 cursor-pointer text-sm
                    ${option.value === value
                      ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                    }
                    dark:text-white
                  `}
                  onClick={() => handleSelect(option.value)}
                >
                  {option.label}
                </div>
              ))
            )}
          </div>

          {/* Create New Option */}
          {showCreateOption && (
            <div
              className="flex items-center gap-2 px-3 py-2 border-t border-gray-200 dark:border-gray-700 cursor-pointer text-sm text-blue-600 dark:text-blue-400 hover:bg-gray-50 dark:hover:bg-gray-700"
              onClick={handleCreateClick}
            >
              <Plus size={14} />
              {createLabel}: &quot;{search}&quot;
            </div>
          )}
        </div>
      )}
    </div>
  )
}
