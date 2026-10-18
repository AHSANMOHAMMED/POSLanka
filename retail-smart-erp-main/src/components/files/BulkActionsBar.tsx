'use client'

import { useState, useCallback } from 'react'
import { Trash2, Star, StarOff, Tag, X, Loader2, Copy, Scissors, FolderInput } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { ConfirmDialog } from '@/components/ui/dialog'

interface BulkActionsBarProps {
  selectedIds: string[]
  currentFolderId?: string | null
  onClear: () => void
  onComplete: () => void
  onCopy?: (ids?: string[]) => void
  onCut?: (ids?: string[]) => void
  onMove?: () => void
}

type BulkAction = 'star' | 'unstar' | 'delete' | 'addTags'

export function BulkActionsBar({ selectedIds, onClear, onComplete, onCopy, onCut, onMove }: BulkActionsBarProps) {
  const [processing, setProcessing] = useState(false)
  const [currentAction, setCurrentAction] = useState<BulkAction | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showTagInput, setShowTagInput] = useState(false)
  const [tagValue, setTagValue] = useState('')

  const count = selectedIds.length

  const executeBulkAction = useCallback(async (action: string, extra?: Record<string, unknown>) => {
    setProcessing(true)
    setCurrentAction(action as BulkAction)
    try {
      const res = await fetch('/api/files/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          fileIds: selectedIds,
          ...extra,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        toast.success(data.message || `Action completed on ${count} files`)
        onComplete()
        onClear()
      } else {
        const err = await res.json()
        toast.error(err.error || 'Bulk action failed')
      }
    } catch {
      toast.error('Bulk action failed')
    } finally {
      setProcessing(false)
      setCurrentAction(null)
    }
  }, [selectedIds, count, onComplete, onClear])

  const handleStar = useCallback(() => executeBulkAction('star'), [executeBulkAction])
  const handleUnstar = useCallback(() => executeBulkAction('unstar'), [executeBulkAction])

  const handleDelete = useCallback(() => {
    setShowDeleteConfirm(true)
  }, [])

  const confirmDelete = useCallback(() => {
    setShowDeleteConfirm(false)
    executeBulkAction('delete')
  }, [executeBulkAction])

  const handleAddTags = useCallback(() => {
    if (!tagValue.trim()) return
    const tags = tagValue.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
    if (tags.length === 0) return
    executeBulkAction('addTags', { tags })
    setShowTagInput(false)
    setTagValue('')
  }, [tagValue, executeBulkAction])

  if (count === 0) return null

  return (
    <>
      <div
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-gray-900 dark:bg-gray-700 text-white rounded shadow-xl px-4 py-3 flex items-center gap-3 animate-in slide-in-from-bottom-2"
        role="toolbar"
        aria-label="Bulk file actions"
      >
        {/* Count */}
        <span className="text-sm font-medium whitespace-nowrap">
          {count} selected
        </span>

        {/* Divider */}
        <div className="w-px h-5 bg-gray-600 dark:bg-gray-500" />

        {/* Clipboard actions */}
        {onCopy && (
          <button
            onClick={() => onCopy(selectedIds)}
            disabled={processing}
            className="flex items-center gap-1.5 px-2 py-1.5 text-xs rounded hover:bg-gray-700 dark:hover:bg-gray-600 transition-colors disabled:opacity-50"
            title="Copy (Ctrl+C)"
          >
            <Copy size={14} />
            <span className="hidden sm:inline">Copy</span>
          </button>
        )}

        {onCut && (
          <button
            onClick={() => onCut(selectedIds)}
            disabled={processing}
            className="flex items-center gap-1.5 px-2 py-1.5 text-xs rounded hover:bg-gray-700 dark:hover:bg-gray-600 transition-colors disabled:opacity-50"
            title="Cut (Ctrl+X)"
          >
            <Scissors size={14} />
            <span className="hidden sm:inline">Cut</span>
          </button>
        )}

        {onMove && (
          <button
            onClick={onMove}
            disabled={processing}
            className="flex items-center gap-1.5 px-2 py-1.5 text-xs rounded hover:bg-gray-700 dark:hover:bg-gray-600 transition-colors disabled:opacity-50"
            title="Move to folder"
          >
            <FolderInput size={14} />
            <span className="hidden sm:inline">Move</span>
          </button>
        )}

        {(onCopy || onCut || onMove) && (
          <div className="w-px h-5 bg-gray-600 dark:bg-gray-500" />
        )}

        {/* Actions */}
        <div className="flex items-center gap-1">
          <button
            onClick={handleStar}
            disabled={processing}
            className="flex items-center gap-1.5 px-2 py-1.5 text-xs rounded hover:bg-gray-700 dark:hover:bg-gray-600 transition-colors disabled:opacity-50"
            title="Star selected"
          >
            {processing && currentAction === 'star' ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Star size={14} />
            )}
            <span className="hidden sm:inline">Star</span>
          </button>

          <button
            onClick={handleUnstar}
            disabled={processing}
            className="flex items-center gap-1.5 px-2 py-1.5 text-xs rounded hover:bg-gray-700 dark:hover:bg-gray-600 transition-colors disabled:opacity-50"
            title="Unstar selected"
          >
            {processing && currentAction === 'unstar' ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <StarOff size={14} />
            )}
            <span className="hidden sm:inline">Unstar</span>
          </button>

          {/* Tag input */}
          {showTagInput ? (
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={tagValue}
                onChange={(e) => setTagValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddTags()
                  if (e.key === 'Escape') {
                    setShowTagInput(false)
                    setTagValue('')
                  }
                }}
                placeholder="tag1, tag2..."
                className="w-32 px-2 py-1 text-xs bg-gray-700 dark:bg-gray-600 border border-gray-500 rounded text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                autoFocus
              />
              <button
                onClick={handleAddTags}
                disabled={processing || !tagValue.trim()}
                className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 rounded transition-colors disabled:opacity-50"
              >
                Add
              </button>
              <button
                onClick={() => {
                  setShowTagInput(false)
                  setTagValue('')
                }}
                className="p-1 text-gray-400 hover:text-white transition-colors"
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowTagInput(true)}
              disabled={processing}
              className="flex items-center gap-1.5 px-2 py-1.5 text-xs rounded hover:bg-gray-700 dark:hover:bg-gray-600 transition-colors disabled:opacity-50"
              title="Add tags"
            >
              {processing && currentAction === 'addTags' ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Tag size={14} />
              )}
              <span className="hidden sm:inline">Tags</span>
            </button>
          )}

          {/* Divider */}
          <div className="w-px h-5 bg-gray-600 dark:bg-gray-500 mx-1" />

          <button
            onClick={handleDelete}
            disabled={processing}
            className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-red-400 hover:bg-red-900/30 rounded transition-colors disabled:opacity-50"
            title="Delete selected"
          >
            {processing && currentAction === 'delete' ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Trash2 size={14} />
            )}
            <span className="hidden sm:inline">Delete</span>
          </button>
        </div>

        {/* Divider */}
        <div className="w-px h-5 bg-gray-600 dark:bg-gray-500" />

        {/* Clear selection */}
        <button
          onClick={onClear}
          disabled={processing}
          className="p-1 text-gray-400 hover:text-white transition-colors disabled:opacity-50"
          title="Clear selection"
          aria-label="Clear selection"
        >
          <X size={16} />
        </button>
      </div>

      {/* Delete confirmation */}
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={confirmDelete}
        title="Delete Files"
        message={`Are you sure you want to delete ${count} selected file${count !== 1 ? 's' : ''}? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
        processing={processing}
      />
    </>
  )
}
