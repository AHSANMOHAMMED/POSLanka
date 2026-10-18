'use client'

import { useState, useRef, useEffect } from 'react'
import { Bookmark, Loader2 } from 'lucide-react'
import { toast } from '@/components/ui/toast'

interface SaveReportButtonProps {
  reportType: string
  currentFilters: Record<string, unknown>
}

export function SaveReportButton({ reportType, currentFilters }: SaveReportButtonProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  async function handleSave() {
    if (!name.trim()) { toast.error('Please enter a name'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/saved-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          reportType,
          filters: currentFilters,
        }),
      })
      if (res.ok) {
        toast.success('Report saved successfully')
        setOpen(false)
        setName('')
      } else {
        toast.error('Failed to save report')
      }
    } catch {
      toast.error('Error saving report')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 border border-gray-300 dark:border-gray-600 rounded hover:border-blue-300 dark:hover:border-blue-500 transition-colors"
      >
        <Bookmark size={14} />
        Save
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 bg-white dark:bg-gray-800 rounded shadow-lg border dark:border-gray-700 p-3 z-50">
          <p className="text-sm font-medium text-gray-900 dark:text-white mb-2">Save Report Filters</p>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Report name..."
            className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 mb-2"
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setOpen(false)}
              className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {saving && <Loader2 size={12} className="animate-spin" />}
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
