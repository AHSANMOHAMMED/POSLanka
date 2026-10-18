'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { FolderHeart, Plus, MoreVertical, Loader2, X, Pencil, Trash2, Check } from 'lucide-react'
import { toast } from '@/components/ui/toast'

interface Collection {
  id: string
  name: string
  description: string | null
  color: string | null
  icon: string | null
  fileCount: number
}

interface CollectionSidebarProps {
  activeCollectionId: string | null
  onSelectCollection: (id: string | null) => void
  onRefresh?: () => void
}

const PRESET_COLORS = [
  '#3B82F6', // blue
  '#10B981', // green
  '#F59E0B', // amber
  '#EF4444', // red
  '#8B5CF6', // purple
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#F97316', // orange
]

export function CollectionSidebar({ activeCollectionId, onSelectCollection, onRefresh }: CollectionSidebarProps) {
  const [collections, setCollections] = useState<Collection[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(PRESET_COLORS[0])
  const [savingNew, setSavingNew] = useState(false)

  // Context menu state
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const newInputRef = useRef<HTMLInputElement>(null)
  const editInputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const fetchCollections = useCallback(async () => {
    try {
      const res = await fetch('/api/collections')
      if (res.ok) {
        const data = await res.json()
        setCollections(Array.isArray(data) ? data : data.data || [])
      }
    } catch {
      // Silently fail - collections may not exist yet
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchCollections()
  }, [fetchCollections])

  // Focus new input when creating
  useEffect(() => {
    if (creating && newInputRef.current) {
      newInputRef.current.focus()
    }
  }, [creating])

  // Focus edit input
  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingId])

  // Close menu on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null)
      }
    }
    if (menuOpenId) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [menuOpenId])

  const handleCreateCollection = useCallback(async () => {
    if (!newName.trim()) {
      setCreating(false)
      return
    }
    setSavingNew(true)
    try {
      const res = await fetch('/api/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), color: newColor }),
      })
      if (res.ok) {
        toast.success('Collection created')
        setCreating(false)
        setNewName('')
        setNewColor(PRESET_COLORS[0])
        fetchCollections()
        onRefresh?.()
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to create collection')
      }
    } catch {
      toast.error('Failed to create collection')
    } finally {
      setSavingNew(false)
    }
  }, [newName, newColor, fetchCollections, onRefresh])

  const handleRenameCollection = useCallback(async (id: string) => {
    if (!editName.trim()) {
      setEditingId(null)
      return
    }
    try {
      const res = await fetch(`/api/collections/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim() }),
      })
      if (res.ok) {
        toast.success('Collection renamed')
        fetchCollections()
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to rename')
      }
    } catch {
      toast.error('Failed to rename collection')
    } finally {
      setEditingId(null)
      setEditName('')
    }
  }, [editName, fetchCollections])

  const handleDeleteCollection = useCallback(async (id: string) => {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/collections/${id}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        toast.success('Collection deleted')
        if (activeCollectionId === id) {
          onSelectCollection(null)
        }
        fetchCollections()
        onRefresh?.()
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to delete')
      }
    } catch {
      toast.error('Failed to delete collection')
    } finally {
      setDeletingId(null)
      setMenuOpenId(null)
    }
  }, [activeCollectionId, onSelectCollection, fetchCollections, onRefresh])

  return (
    <div className="w-56 border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex flex-col h-full overflow-hidden flex-shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-1.5">
          <FolderHeart size={14} className="text-gray-500 dark:text-gray-400" />
          <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
            Collections
          </span>
        </div>
        <button
          onClick={() => {
            setCreating(true)
            setNewName('')
          }}
          className="p-1 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
          title="New collection"
          aria-label="Create new collection"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto py-1">
        {/* "All Files" option */}
        <button
          onClick={() => onSelectCollection(null)}
          className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
            activeCollectionId === null
              ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 font-medium'
              : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'
          }`}
        >
          <div className="w-2.5 h-2.5 rounded-full bg-gray-300 dark:bg-gray-600 flex-shrink-0" />
          <span className="truncate">All Files</span>
        </button>

        {/* New collection input */}
        {creating && (
          <div className="px-3 py-2 space-y-2">
            <input
              ref={newInputRef}
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateCollection()
                if (e.key === 'Escape') {
                  setCreating(false)
                  setNewName('')
                }
              }}
              placeholder="Collection name..."
              className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
              disabled={savingNew}
            />
            {/* Color picker */}
            <div className="flex items-center gap-1">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() => setNewColor(color)}
                  className={`w-4 h-4 rounded-full border-2 transition-all ${
                    newColor === color
                      ? 'border-gray-900 dark:border-white scale-110'
                      : 'border-transparent hover:border-gray-400'
                  }`}
                  style={{ backgroundColor: color }}
                  title={color}
                />
              ))}
            </div>
            <div className="flex items-center gap-1 justify-end">
              <button
                onClick={() => {
                  setCreating(false)
                  setNewName('')
                }}
                className="px-2 py-0.5 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateCollection}
                disabled={savingNew || !newName.trim()}
                className="px-2 py-0.5 text-xs text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors disabled:opacity-50 flex items-center gap-1"
              >
                {savingNew && <Loader2 size={10} className="animate-spin" />}
                Create
              </button>
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-6">
            <Loader2 size={16} className="animate-spin text-gray-400" />
          </div>
        )}

        {/* Collections list */}
        {!loading && collections.map((collection) => (
          <div key={collection.id} className="relative group">
            {editingId === collection.id ? (
              <div className="flex items-center gap-1 px-3 py-1.5">
                <input
                  ref={editInputRef}
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRenameCollection(collection.id)
                    if (e.key === 'Escape') {
                      setEditingId(null)
                      setEditName('')
                    }
                  }}
                  className="flex-1 px-1.5 py-0.5 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button
                  onClick={() => handleRenameCollection(collection.id)}
                  className="p-0.5 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded"
                >
                  <Check size={12} />
                </button>
                <button
                  onClick={() => {
                    setEditingId(null)
                    setEditName('')
                  }}
                  className="p-0.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                >
                  <X size={12} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => onSelectCollection(collection.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                  activeCollectionId === collection.id
                    ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 font-medium'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                }`}
              >
                <div
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: collection.color || '#6B7280' }}
                />
                <span className="truncate flex-1 text-left">{collection.name}</span>
                <span className="text-[10px] text-gray-400 dark:text-gray-500 flex-shrink-0">
                  {collection.fileCount}
                </span>
                {/* Inline context menu button */}
                <div
                  className="relative opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setMenuOpenId(menuOpenId === collection.id ? null : collection.id)
                    }}
                    className="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded transition-colors"
                    aria-label="Collection options"
                  >
                    <MoreVertical size={12} />
                  </button>

                  {/* Dropdown menu */}
                  {menuOpenId === collection.id && (
                    <div
                      ref={menuRef}
                      className="absolute right-0 top-full mt-0.5 w-32 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg py-1 z-50"
                    >
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setEditingId(collection.id)
                          setEditName(collection.name)
                          setMenuOpenId(null)
                        }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                      >
                        <Pencil size={12} />
                        Rename
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDeleteCollection(collection.id)
                        }}
                        disabled={deletingId === collection.id}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                      >
                        {deletingId === collection.id ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <Trash2 size={12} />
                        )}
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </button>
            )}
          </div>
        ))}

        {/* Empty state */}
        {!loading && collections.length === 0 && !creating && (
          <div className="px-3 py-6 text-center">
            <FolderHeart size={24} className="mx-auto mb-2 text-gray-300 dark:text-gray-600" />
            <p className="text-xs text-gray-400 dark:text-gray-500">No collections yet</p>
            <button
              onClick={() => setCreating(true)}
              className="mt-2 text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              Create one
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
