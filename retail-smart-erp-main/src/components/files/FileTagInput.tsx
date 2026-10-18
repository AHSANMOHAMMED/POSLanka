'use client'

import { useState, useRef, useCallback } from 'react'
import { X, Plus } from 'lucide-react'

interface FileTagInputProps {
  tags: string[]
  onChange: (tags: string[]) => void
  readOnly?: boolean
  maxTags?: number
}

export function FileTagInput({ tags, onChange, readOnly = false, maxTags = 20 }: FileTagInputProps) {
  const [inputValue, setInputValue] = useState('')
  const [isFocused, setIsFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const addTag = useCallback((value: string) => {
    const trimmed = value.trim().toLowerCase()
    if (!trimmed) return
    if (tags.includes(trimmed)) return
    if (tags.length >= maxTags) return
    onChange([...tags, trimmed])
    setInputValue('')
  }, [tags, onChange, maxTags])

  const removeTag = useCallback((index: number) => {
    if (readOnly) return
    const next = [...tags]
    next.splice(index, 1)
    onChange(next)
  }, [tags, onChange, readOnly])

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag(inputValue)
    }
    if (e.key === 'Backspace' && inputValue === '' && tags.length > 0) {
      removeTag(tags.length - 1)
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    // If user types a comma, treat everything before it as a tag
    if (val.includes(',')) {
      const parts = val.split(',')
      for (const part of parts) {
        addTag(part)
      }
      return
    }
    setInputValue(val)
  }

  return (
    <div
      className={`flex flex-wrap items-center gap-1.5 min-h-[32px] p-1.5 rounded-md border transition-colors ${
        isFocused
          ? 'border-blue-500 ring-1 ring-blue-500'
          : 'border-gray-300 dark:border-gray-600'
      } bg-white dark:bg-gray-700`}
      onClick={() => inputRef.current?.focus()}
    >
      {tags.map((tag, i) => (
        <span
          key={`${tag}-${i}`}
          className="inline-flex items-center gap-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs px-2 py-0.5 rounded-full"
        >
          {tag}
          {!readOnly && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                removeTag(i)
              }}
              className="ml-0.5 p-0.5 rounded-full hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
              aria-label={`Remove tag ${tag}`}
            >
              <X size={10} />
            </button>
          )}
        </span>
      ))}

      {!readOnly && tags.length < maxTags && (
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => {
            setIsFocused(false)
            // Add tag on blur if there's text
            if (inputValue.trim()) {
              addTag(inputValue)
            }
          }}
          placeholder={tags.length === 0 ? 'Add tags...' : ''}
          className="flex-1 min-w-[60px] border-0 bg-transparent text-xs text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-0 p-0.5"
        />
      )}

      {!readOnly && tags.length === 0 && inputValue === '' && (
        <Plus size={12} className="text-gray-400 ml-0.5" />
      )}
    </div>
  )
}
