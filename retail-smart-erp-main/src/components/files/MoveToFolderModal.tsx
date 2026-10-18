'use client'

import { useState, useEffect, useCallback } from 'react'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { toast } from '@/components/ui/toast'
import { Folder, ChevronRight, Home, Loader2, FolderOpen } from 'lucide-react'

interface FolderItem {
  id: string
  fileName: string
  isFolder: boolean
  folderId: string | null
}

interface MoveToFolderModalProps {
  isOpen: boolean
  onClose: () => void
  fileIds: string[]
  onMoved: () => void
}

export function MoveToFolderModal({ isOpen, onClose, fileIds, onMoved }: MoveToFolderModalProps) {
  const [folders, setFolders] = useState<FolderItem[]>([])
  const [loading, setLoading] = useState(false)
  const [moving, setMoving] = useState(false)
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [breadcrumbs, setBreadcrumbs] = useState<{ id: string | null; name: string }[]>([
    { id: null, name: 'Home' },
  ])
  const [selectedFolderId, setSelectedFolderId] = useState<string | null | 'root'>('root')

  const fetchFolders = useCallback(async (parentId: string | null) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ all: 'true' })
      if (parentId) params.set('folderId', parentId)
      const res = await fetch(`/api/files?${params}`)
      if (res.ok) {
        const data = await res.json()
        const folderList = (Array.isArray(data) ? data : data.data || []).filter(
          (f: FolderItem) => f.isFolder && !fileIds.includes(f.id)
        )
        setFolders(folderList)
      }
    } catch {
      toast.error('Failed to load folders')
    } finally {
      setLoading(false)
    }
  }, [fileIds])

  useEffect(() => {
    if (isOpen) {
      setCurrentFolderId(null)
      setBreadcrumbs([{ id: null, name: 'Home' }])
      setSelectedFolderId('root')
      fetchFolders(null)
    }
  }, [isOpen, fetchFolders])

  function navigateInto(folder: FolderItem) {
    setCurrentFolderId(folder.id)
    setBreadcrumbs(prev => [...prev, { id: folder.id, name: folder.fileName }])
    setSelectedFolderId(folder.id)
    fetchFolders(folder.id)
  }

  function navigateToBreadcrumb(index: number) {
    const crumb = breadcrumbs[index]
    setCurrentFolderId(crumb.id)
    setBreadcrumbs(prev => prev.slice(0, index + 1))
    setSelectedFolderId(crumb.id === null ? 'root' : crumb.id)
    fetchFolders(crumb.id)
  }

  async function handleMove() {
    const targetId = selectedFolderId === 'root' ? null : selectedFolderId
    setMoving(true)
    try {
      const res = await fetch('/api/files/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'move',
          fileIds,
          targetFolderId: targetId,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        toast.success(`Moved ${data.affected} file${data.affected !== 1 ? 's' : ''}`)
        onMoved()
        onClose()
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to move files')
      }
    } catch {
      toast.error('Failed to move files')
    } finally {
      setMoving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Move To Folder" size="md">
      <ModalBody>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
          Select destination for {fileIds.length} file{fileIds.length !== 1 ? 's' : ''}
        </p>

        {/* Breadcrumbs */}
        <div className="flex items-center gap-1 text-sm mb-3 flex-wrap">
          {breadcrumbs.map((crumb, i) => (
            <span key={crumb.id ?? 'root'} className="flex items-center gap-1">
              {i > 0 && <ChevronRight size={12} className="text-gray-400" />}
              <button
                onClick={() => navigateToBreadcrumb(i)}
                className={`px-1.5 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-1 ${
                  i === breadcrumbs.length - 1
                    ? 'font-medium text-gray-900 dark:text-white'
                    : 'text-gray-500 dark:text-gray-400'
                }`}
              >
                {i === 0 && <Home size={12} />}
                {crumb.name}
              </button>
            </span>
          ))}
        </div>

        {/* Current folder as destination option */}
        <div
          onClick={() => setSelectedFolderId(currentFolderId === null ? 'root' : currentFolderId)}
          className={`flex items-center gap-2 px-3 py-2 rounded border cursor-pointer transition-colors mb-2 ${
            selectedFolderId === (currentFolderId === null ? 'root' : currentFolderId)
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-400'
              : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
          }`}
        >
          <FolderOpen size={16} className="text-amber-500 flex-shrink-0" />
          <span className="text-sm font-medium text-gray-900 dark:text-white">
            Move here ({breadcrumbs[breadcrumbs.length - 1].name})
          </span>
        </div>

        {/* Subfolder list */}
        <div className="border dark:border-gray-700 rounded max-h-64 overflow-y-auto">
          {loading ? (
            <div className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
              <Loader2 size={20} className="animate-spin mx-auto mb-2" />
              Loading folders...
            </div>
          ) : folders.length === 0 ? (
            <div className="px-4 py-6 text-center text-gray-400 dark:text-gray-500 text-sm">
              No subfolders
            </div>
          ) : (
            folders.map((folder) => (
              <div
                key={folder.id}
                className={`flex items-center gap-2 px-3 py-2.5 cursor-pointer transition-colors border-b last:border-b-0 dark:border-gray-700 ${
                  selectedFolderId === folder.id
                    ? 'bg-blue-50 dark:bg-blue-900/20'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                }`}
                onClick={() => setSelectedFolderId(folder.id)}
                onDoubleClick={() => navigateInto(folder)}
              >
                <Folder size={16} className="text-amber-500 flex-shrink-0" />
                <span className="text-sm text-gray-900 dark:text-white flex-1 truncate">
                  {folder.fileName}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    navigateInto(folder)
                  }}
                  className="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded"
                  title="Open folder"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            ))
          )}
        </div>
      </ModalBody>

      <ModalFooter>
        <button
          onClick={onClose}
          disabled={moving}
          className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={handleMove}
          disabled={moving || selectedFolderId === undefined}
          className="px-4 py-2 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
        >
          {moving && <Loader2 size={14} className="animate-spin" />}
          {moving ? 'Moving...' : 'Move Here'}
        </button>
      </ModalFooter>
    </Modal>
  )
}
