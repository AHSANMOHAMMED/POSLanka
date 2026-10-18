'use client'

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { usePaginatedData } from '@/hooks'
import { FileDetailPanel } from '@/components/files/FileDetailPanel'
import { CollectionSidebar } from '@/components/files/CollectionSidebar'
import { ContextMenu, ContextMenuItem } from '@/components/ui/context-menu'

// Lazy-load modals and heavy components — not needed for initial render
const ConfirmModal = dynamic(() => import('@/components/ui/confirm-modal').then(m => ({ default: m.ConfirmModal })), { ssr: false })
const FileUploadModal = dynamic(() => import('@/components/files/FileUploadModal').then(m => ({ default: m.FileUploadModal })), { ssr: false })
const FolderCreateModal = dynamic(() => import('@/components/files/FolderCreateModal').then(m => ({ default: m.FolderCreateModal })), { ssr: false })
const BulkActionsBar = dynamic(() => import('@/components/files/BulkActionsBar').then(m => ({ default: m.BulkActionsBar })), { ssr: false })
const DocumentViewer = dynamic(() => import('@/components/ui/document-viewer').then(m => ({ default: m.DocumentViewer })), { ssr: false })
const MoveToFolderModal = dynamic(() => import('@/components/files/MoveToFolderModal').then(m => ({ default: m.MoveToFolderModal })), { ssr: false })
import { useFileClipboard } from '@/lib/stores/file-clipboard-store'
import { Pagination } from '@/components/ui/pagination'
import { toast } from '@/components/ui/toast'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import {
  FolderPlus,
  Upload,
  Trash2,
  Folder,
  FileText,
  Image as ImageIcon,
  File,
  FileSpreadsheet,
  Download,
  Lock,
  ChevronRight,
  Home,
  LayoutGrid,
  List,
  Star,
  PanelRightClose,
  PanelRightOpen,
  Copy,
  Scissors,
  ClipboardPaste,
  Pencil,
  FolderInput,
  Info,
  Video,
} from 'lucide-react'

interface FileRecord {
  id: string
  fileName: string
  fileUrl: string
  fileSize: number | null
  fileType: string | null
  contentHash: string | null
  thumbnailUrl: string | null
  isPrivate: boolean
  isFolder: boolean
  folderId: string | null
  attachedToType: string | null
  attachedToId: string | null
  description: string | null
  category: string | null
  tags: string[] | null
  isStarred: boolean
  versionNumber: number | null
  metadata: Record<string, unknown> | null
  uploadedBy: string | null
  uploadedByUser?: { fullName: string } | null
  createdAt: string
  updatedAt: string
}

interface FolderBreadcrumb {
  id: string | null
  name: string
}

type ViewMode = 'grid' | 'list'
type TypeFilter = 'all' | 'image' | 'document' | 'starred'

function getFileIcon(file: FileRecord, size = 18) {
  if (file.isFolder) return <Folder size={size} className="text-amber-500" />
  if (!file.fileType) return <File size={size} className="text-gray-400" />
  if (file.fileType.startsWith('image/')) return <ImageIcon size={size} className="text-blue-500" />
  if (file.fileType === 'application/pdf') return <FileText size={size} className="text-red-500" />
  if (file.fileType.includes('spreadsheet') || file.fileType.includes('excel') || file.fileType.includes('csv'))
    return <FileSpreadsheet size={size} className="text-green-500" />
  if (file.fileType.includes('wordprocessingml') || file.fileType === 'application/msword')
    return <FileText size={size} className="text-blue-600" />
  if (file.fileType.startsWith('video/'))
    return <Video size={size} className="text-purple-500" />
  return <File size={size} className="text-gray-400" />
}

function getFileIconLarge(file: FileRecord) {
  return getFileIcon(file, 40)
}

function formatSize(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function isImageFile(file: FileRecord): boolean {
  return !file.isFolder && !!file.fileType?.startsWith('image/')
}

function isPreviewableFile(file: FileRecord): boolean {
  if (file.isFolder) return false
  if (!file.fileType) return false

  // Images and PDFs
  if (file.fileType.startsWith('image/')) return true
  if (file.fileType === 'application/pdf') return true

  // Spreadsheets
  if (file.fileType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return true
  if (file.fileType === 'application/vnd.ms-excel') return true

  // Word documents
  if (file.fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return true
  if (file.fileType === 'application/msword') return true

  // Videos
  if (file.fileType.startsWith('video/')) return true

  // Text files
  if (file.fileType === 'text/csv') return true
  if (file.fileType === 'text/plain') return true

  // Fallback: check extension
  const ext = file.fileName.split('.').pop()?.toLowerCase()
  if (ext && ['xlsx', 'xls', 'docx', 'doc', 'csv', 'txt', 'mp4', 'webm', 'mov', 'ogg'].includes(ext)) return true

  return false
}

export default function FilesPage() {
  // View state
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('files-view-mode') as ViewMode) || 'grid'
    }
    return 'grid'
  })
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')

  // Folder navigation
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [folderPath, setFolderPath] = useState<FolderBreadcrumb[]>([{ id: null, name: 'Home' }])

  // Modals
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [showFolderModal, setShowFolderModal] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deletingFile, setDeletingFile] = useState<FileRecord | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [showMoveModal, setShowMoveModal] = useState(false)
  const [moveFileIds, setMoveFileIds] = useState<string[]>([])

  // Document viewer
  const [viewerOpen, setViewerOpen] = useState(false)
  const [viewerIndex, setViewerIndex] = useState(0)

  // Selection state
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const lastSelectedRef = useRef<string | null>(null)
  const selectedFilesRef = useRef<Set<string>>(new Set())
  selectedFilesRef.current = selectedFiles

  // Detail panel
  const [detailFile, setDetailFile] = useState<FileRecord | null>(null)
  const detailFileRef = useRef<FileRecord | null>(null)
  detailFileRef.current = detailFile

  // Collections sidebar
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null)
  const [showCollections, setShowCollections] = useState(true)

  // Context menu
  const [contextMenu, setContextMenu] = useState<{ position: { x: number; y: number }; file: FileRecord | null } | null>(null)

  // Inline rename
  const [renamingFileId, setRenamingFileId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // Clipboard
  const clipboard = useFileClipboard()

  // Build additional params based on filters
  const additionalParams = useMemo(() => {
    const params: Record<string, string> = {}
    if (currentFolderId) params.folderId = currentFolderId
    if (typeFilter === 'image' || typeFilter === 'document') params.type = typeFilter
    if (typeFilter === 'starred') params.starred = 'true'
    if (activeCollectionId) params.collectionId = activeCollectionId
    return params
  }, [currentFolderId, typeFilter, activeCollectionId])

  const {
    data: fileList,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<FileRecord>({
    endpoint: '/api/files',
    entityType: 'file',
    storageKey: 'files-page-size',
    additionalParams,
  })

  // Stable ref for fileList — used inside callbacks to avoid recreating them
  const fileListRef = useRef<FileRecord[]>([])
  fileListRef.current = fileList

  // Build attachments array for DocumentViewer (only previewable files) - lazy
  const viewerAttachments = useMemo(() => {
    if (!viewerOpen) return [] // Skip computation when viewer is closed
    // File types that need client-side parsing (fetch as ArrayBuffer/text)
    const needsFetchTypes = new Set([
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'text/csv',
      'text/plain',
    ])

    return fileList
      .filter((f) => isPreviewableFile(f))
      .map((f) => {
        // Use /view endpoint for private files or files that need client-side parsing
        // Also check extension in case MIME type is generic (e.g., application/octet-stream)
        const ext = f.fileName.split('.').pop()?.toLowerCase()
        const extNeedsFetch = ext ? ['xlsx', 'xls', 'docx', 'doc', 'csv', 'txt'].includes(ext) : false
        const needsViewEndpoint = f.isPrivate || needsFetchTypes.has(f.fileType || '') || extNeedsFetch
        // Thumbnail for image files — use pre-generated thumbnail or thumbnail API
        const isImg = f.fileType?.startsWith('image/')
        let thumbnailPath: string | null = null
        if (isImg) {
          thumbnailPath = f.thumbnailUrl
            ? (f.isPrivate ? `/api/files/${f.id}/thumbnail` : f.thumbnailUrl)
            : (f.isPrivate ? `/api/files/${f.id}/thumbnail` : null)
        }
        return {
          id: f.id,
          fileName: f.fileName,
          fileType: f.fileType || '',
          fileSize: f.fileSize || 0,
          filePath: needsViewEndpoint ? `/api/files/${f.id}/view` : f.fileUrl,
          thumbnailPath,
          category: f.category,
          description: f.description,
          createdAt: f.createdAt,
          uploadedByUser: f.uploadedByUser,
        }
      })
  }, [fileList, viewerOpen])

  // Cut file IDs for visual dimming
  const cutFileIds = useMemo(() => {
    if (clipboard.mode === 'cut') return new Set(clipboard.fileIds)
    return new Set<string>()
  }, [clipboard.mode, clipboard.fileIds])

  function changeViewMode(mode: ViewMode) {
    setViewMode(mode)
    localStorage.setItem('files-view-mode', mode)
  }

  function navigateToFolder(file: FileRecord) {
    if (!file.isFolder) return
    setCurrentFolderId(file.id)
    setFolderPath((prev) => [...prev, { id: file.id, name: file.fileName }])
  }

  function navigateToBreadcrumb(index: number) {
    const crumb = folderPath[index]
    setCurrentFolderId(crumb.id)
    setFolderPath((prev) => prev.slice(0, index + 1))
  }

  function handleDeleteClick(file: FileRecord, e?: React.MouseEvent) {
    e?.stopPropagation()
    setDeletingFile(file)
    setShowDeleteConfirm(true)
  }

  async function handleDelete() {
    if (!deletingFile) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/files/${deletingFile.id}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success(`${deletingFile.isFolder ? 'Folder' : 'File'} deleted`)
        if (detailFile?.id === deletingFile.id) {
          setDetailFile(null)
        }
        // Remove from selection
        setSelectedFiles((prev) => {
          const next = new Set(prev)
          next.delete(deletingFile.id)
          return next
        })
        refresh()
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to delete')
      }
    } catch {
      toast.error('Failed to delete')
    } finally {
      setDeleting(false)
      setShowDeleteConfirm(false)
      setDeletingFile(null)
    }
  }

  // Handle file click - open detail panel for files, navigate for folders
  const handleFileClick = useCallback((file: FileRecord) => {
    if (file.isFolder) {
      // Inline folder navigation to avoid stale closure over navigateToFolder
      setCurrentFolderId(file.id)
      setFolderPath((prev) => [...prev, { id: file.id, name: file.fileName }])
      return
    }

    // Show detail panel
    setDetailFile(file)
  }, [])

  // Double-click to open in viewer or download
  const handleFileDoubleClick = useCallback((file: FileRecord) => {
    if (file.isFolder) return

    if (isPreviewableFile(file)) {
      const previewableFiles = fileListRef.current.filter((f) => isPreviewableFile(f))
      const idx = previewableFiles.findIndex((f) => f.id === file.id)
      if (idx >= 0) {
        setViewerIndex(idx)
        setViewerOpen(true)
      }
      return
    }

    // Non-previewable: download
    if (file.isPrivate) {
      window.open(`/api/files/${file.id}/download`, '_blank')
    } else {
      window.open(file.fileUrl, '_blank')
    }
  }, []) // Stable — reads fileList from ref

  // Selection handling
  const handleToggleSelect = useCallback((fileId: string, shiftKey: boolean) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev)

      if (shiftKey && lastSelectedRef.current) {
        // Range selection — read from ref to keep callback stable
        const currentList = fileListRef.current
        const lastIdx = currentList.findIndex((f) => f.id === lastSelectedRef.current)
        const currentIdx = currentList.findIndex((f) => f.id === fileId)
        if (lastIdx >= 0 && currentIdx >= 0) {
          const start = Math.min(lastIdx, currentIdx)
          const end = Math.max(lastIdx, currentIdx)
          for (let i = start; i <= end; i++) {
            next.add(currentList[i].id)
          }
        }
      } else {
        if (next.has(fileId)) {
          next.delete(fileId)
        } else {
          next.add(fileId)
        }
      }

      lastSelectedRef.current = fileId
      return next
    })
  }, []) // Stable — reads fileList from ref

  const handleClearSelection = useCallback(() => {
    setSelectedFiles(new Set())
    lastSelectedRef.current = null
  }, [])

  // Star toggle directly from grid/list views
  const handleToggleStar = useCallback(async (file: FileRecord, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      const res = await fetch(`/api/files/${file.id}/star`, { method: 'POST' })
      if (res.ok) {
        refresh()
      } else {
        toast.error('Failed to update star')
      }
    } catch {
      toast.error('Failed to update star')
    }
  }, [refresh])

  function handleTypeFilter(filter: TypeFilter) {
    setTypeFilter(filter)
    setPage(1)
  }

  // When detail panel refreshes, also refresh the list to keep in sync
  const handleDetailRefresh = useCallback(() => {
    refresh()
  }, [refresh])

  // Keep detail panel in sync with file list data
  useEffect(() => {
    if (detailFileRef.current) {
      const updated = fileList.find((f) => f.id === detailFileRef.current!.id)
      if (updated && updated.updatedAt !== detailFileRef.current!.updatedAt) {
        setDetailFile(updated)
      }
    }
  }, [fileList])

  const selectedIdsArray = useMemo(() => Array.from(selectedFiles), [selectedFiles])
  const selectedIdsArrayRef = useRef<string[]>([])
  selectedIdsArrayRef.current = selectedIdsArray

  // =====================================================
  // Clipboard operations
  // =====================================================

  function getTargetFileIds(contextFile: FileRecord | null): string[] {
    // If right-clicked file is already in selection, use entire selection
    if (contextFile && selectedFiles.has(contextFile.id)) {
      return selectedIdsArray
    }
    // Otherwise use just the right-clicked file
    if (contextFile) return [contextFile.id]
    return selectedIdsArray
  }

  const handleCopy = useCallback((ids?: string[]) => {
    const fileIds = ids || selectedIdsArray
    if (fileIds.length === 0) return
    clipboard.copy(fileIds, currentFolderId)
    toast.success(`Copied ${fileIds.length} file${fileIds.length !== 1 ? 's' : ''} to clipboard`)
  }, [selectedIdsArray, currentFolderId, clipboard])

  const handleCut = useCallback((ids?: string[]) => {
    const fileIds = ids || selectedIdsArray
    if (fileIds.length === 0) return
    clipboard.cut(fileIds, currentFolderId)
    toast.success(`Cut ${fileIds.length} file${fileIds.length !== 1 ? 's' : ''} to clipboard`)
  }, [selectedIdsArray, currentFolderId, clipboard])

  const handlePaste = useCallback(async () => {
    if (!clipboard.mode || clipboard.fileIds.length === 0) return

    try {
      if (clipboard.mode === 'cut') {
        // Move files
        const res = await fetch('/api/files/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'move',
            fileIds: clipboard.fileIds,
            targetFolderId: currentFolderId,
          }),
        })
        if (res.ok) {
          toast.success(`Moved ${clipboard.fileIds.length} file${clipboard.fileIds.length !== 1 ? 's' : ''}`)
          clipboard.clear()
          refresh()
        } else {
          const err = await res.json()
          toast.error(err.error || 'Failed to move files')
        }
      } else {
        // Copy files
        const res = await fetch('/api/files/bulk-copy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileIds: clipboard.fileIds,
            targetFolderId: currentFolderId,
          }),
        })
        if (res.ok) {
          toast.success(`Pasted ${clipboard.fileIds.length} file${clipboard.fileIds.length !== 1 ? 's' : ''}`)
          refresh()
        } else {
          const err = await res.json()
          toast.error(err.error || 'Failed to copy files')
        }
      }
    } catch {
      toast.error('Paste operation failed')
    }
  }, [clipboard, currentFolderId, refresh])

  // =====================================================
  // Inline rename
  // =====================================================

  function startRename(file: FileRecord) {
    setRenamingFileId(file.id)
    setRenameValue(file.fileName)
  }

  async function commitRename() {
    if (!renamingFileId || !renameValue.trim()) {
      setRenamingFileId(null)
      return
    }

    try {
      const res = await fetch(`/api/files/${renamingFileId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: renameValue.trim() }),
      })
      if (res.ok) {
        toast.success('Renamed successfully')
        refresh()
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to rename')
      }
    } catch {
      toast.error('Failed to rename')
    } finally {
      setRenamingFileId(null)
    }
  }

  // =====================================================
  // Context menu
  // =====================================================

  const handleContextMenu = useCallback((e: React.MouseEvent, file: FileRecord | null) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ position: { x: e.clientX, y: e.clientY }, file })
  }, [])

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  // Build context menu items — lazy: skip computation when menu is closed
  const contextMenuItems = useMemo((): ContextMenuItem[] => {
    if (!contextMenu) return [] // Skip expensive computation when closed
    const file = contextMenu.file
    const items: ContextMenuItem[] = []

    if (file) {
      const targetIds = getTargetFileIds(file)
      const multipleSelected = targetIds.length > 1

      if (!multipleSelected) {
        // Single file actions
        if (file.isFolder) {
          items.push({
            label: 'Open Folder',
            icon: <Folder size={14} />,
            onClick: () => navigateToFolder(file),
          })
        } else {
          if (isPreviewableFile(file)) {
            items.push({
              label: 'Preview',
              icon: <ImageIcon size={14} />,
              onClick: () => handleFileDoubleClick(file),
            })
          }
          items.push({
            label: 'Download',
            icon: <Download size={14} />,
            onClick: () => {
              const url = file.isPrivate ? `/api/files/${file.id}/download` : file.fileUrl
              window.open(url, '_blank')
            },
          })
        }

        items.push({ label: '', onClick: () => {}, divider: true })

        items.push({
          label: 'Rename',
          icon: <Pencil size={14} />,
          onClick: () => startRename(file),
          shortcut: 'F2',
        })
      }

      // Copy / Cut (single or multi)
      if (!file.isFolder || !multipleSelected) {
        items.push({
          label: multipleSelected ? `Copy (${targetIds.length})` : 'Copy',
          icon: <Copy size={14} />,
          onClick: () => handleCopy(targetIds),
          shortcut: 'Ctrl+C',
        })
        items.push({
          label: multipleSelected ? `Cut (${targetIds.length})` : 'Cut',
          icon: <Scissors size={14} />,
          onClick: () => handleCut(targetIds),
          shortcut: 'Ctrl+X',
        })
      }

      // Move to
      items.push({
        label: multipleSelected ? `Move To... (${targetIds.length})` : 'Move To...',
        icon: <FolderInput size={14} />,
        onClick: () => {
          setMoveFileIds(targetIds)
          setShowMoveModal(true)
        },
      })

      items.push({ label: '', onClick: () => {}, divider: true })

      // Star / unstar
      if (!file.isFolder) {
        items.push({
          label: file.isStarred ? 'Unstar' : 'Star',
          icon: <Star size={14} />,
          onClick: async () => {
            await fetch(`/api/files/${file.id}/star`, { method: 'POST' })
            refresh()
          },
        })
      }

      // Properties
      if (!multipleSelected && !file.isFolder) {
        items.push({
          label: 'Properties',
          icon: <Info size={14} />,
          onClick: () => setDetailFile(file),
        })
      }

      items.push({ label: '', onClick: () => {}, divider: true })

      // Delete
      items.push({
        label: multipleSelected ? `Delete (${targetIds.length})` : 'Delete',
        icon: <Trash2 size={14} />,
        onClick: () => {
          if (multipleSelected) {
            // Bulk delete via BulkActionsBar would handle this, but trigger confirm
            setDeletingFile(file)
            setShowDeleteConfirm(true)
          } else {
            handleDeleteClick(file)
          }
        },
        danger: true,
      })
    } else {
      // Empty space context menu
      if (clipboard.mode && clipboard.fileIds.length > 0) {
        items.push({
          label: `Paste (${clipboard.fileIds.length})`,
          icon: <ClipboardPaste size={14} />,
          onClick: handlePaste,
          shortcut: 'Ctrl+V',
        })
        items.push({ label: '', onClick: () => {}, divider: true })
      }

      items.push({
        label: 'Upload Files',
        icon: <Upload size={14} />,
        onClick: () => setShowUploadModal(true),
      })
      items.push({
        label: 'New Folder',
        icon: <FolderPlus size={14} />,
        onClick: () => setShowFolderModal(true),
      })

      if (selectedFiles.size > 0) {
        items.push({ label: '', onClick: () => {}, divider: true })
        items.push({
          label: 'Select All',
          icon: <List size={14} />,
          onClick: () => setSelectedFiles(new Set(fileList.map(f => f.id))),
          shortcut: 'Ctrl+A',
        })
        items.push({
          label: 'Clear Selection',
          onClick: handleClearSelection,
        })
      }
    }

    return items
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextMenu, selectedFiles, clipboard, fileList, currentFolderId])

  // =====================================================
  // Keyboard shortcuts
  // =====================================================

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Skip when typing in inputs
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      const ctrl = e.ctrlKey || e.metaKey

      if (e.key === 'Escape') {
        setContextMenu(null)
        setSelectedFiles(new Set())
        lastSelectedRef.current = null
        return
      }

      if (ctrl && e.key === 'a') {
        e.preventDefault()
        setSelectedFiles(new Set(fileListRef.current.map(f => f.id)))
        return
      }

      if (ctrl && e.key === 'c') { e.preventDefault(); handleCopy(); return }
      if (ctrl && e.key === 'x') { e.preventDefault(); handleCut(); return }
      if (ctrl && e.key === 'v') { e.preventDefault(); handlePaste(); return }

      if (e.key === 'Delete') {
        if (selectedFilesRef.current.size > 0) {
          e.preventDefault()
          const firstId = selectedIdsArrayRef.current[0]
          const file = fileListRef.current.find(f => f.id === firstId)
          if (file) {
            setDeletingFile(file)
            setShowDeleteConfirm(true)
          }
        }
        return
      }

      if (e.key === 'F2') {
        if (selectedFilesRef.current.size === 1) {
          e.preventDefault()
          const fileId = selectedIdsArrayRef.current[0]
          const file = fileListRef.current.find(f => f.id === fileId)
          if (file) startRename(file)
        }
        return
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleCopy, handleCut, handlePaste]) // Minimal deps — rest via refs

  // =====================================================
  // Move modal handler (for BulkActionsBar)
  // =====================================================

  const handleBulkMove = useCallback(() => {
    setMoveFileIds(selectedIdsArray)
    setShowMoveModal(true)
  }, [selectedIdsArray])

  const handleMoveComplete = useCallback(() => {
    handleClearSelection()
    refresh()
  }, [handleClearSelection, refresh])

  return (
    <ListPageLayout
      module="Files"
      moduleHref="/files"
      title="File Manager"
      actionContent={
        <div className="flex items-center gap-2">
          {/* Clipboard indicator */}
          {clipboard.mode && clipboard.fileIds.length > 0 && (
            <div className="flex items-center gap-1.5 px-2 py-1 text-xs bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700 rounded">
              {clipboard.mode === 'cut' ? <Scissors size={12} /> : <Copy size={12} />}
              <span>{clipboard.fileIds.length} {clipboard.mode === 'cut' ? 'cut' : 'copied'}</span>
              <button
                onClick={() => clipboard.clear()}
                className="ml-1 hover:text-amber-900 dark:hover:text-amber-100"
                title="Clear clipboard"
              >
                ×
              </button>
            </div>
          )}

          {/* Collections sidebar toggle */}
          <button
            onClick={() => setShowCollections(!showCollections)}
            className={`p-1.5 transition-colors rounded ${
              showCollections
                ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}
            title={showCollections ? 'Hide collections' : 'Show collections'}
          >
            {showCollections ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          </button>

          {/* View toggle */}
          <div className="flex items-center border dark:border-gray-600 rounded-md overflow-hidden">
            <button
              onClick={() => changeViewMode('grid')}
              className={`p-1.5 transition-colors ${
                viewMode === 'grid'
                  ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
              title="Grid view"
            >
              <LayoutGrid size={16} />
            </button>
            <button
              onClick={() => changeViewMode('list')}
              className={`p-1.5 transition-colors ${
                viewMode === 'list'
                  ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
              title="List view"
            >
              <List size={16} />
            </button>
          </div>

          <button
            onClick={() => setShowFolderModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
          >
            <FolderPlus size={16} />
            <span className="hidden sm:inline">New Folder</span>
          </button>
          <button
            onClick={() => setShowUploadModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-white bg-blue-600 rounded hover:bg-blue-700 transition-colors"
          >
            <Upload size={16} />
            <span className="hidden sm:inline">Upload</span>
          </button>
        </div>
      }
      search={search}
      setSearch={setSearch}
      onRefresh={refresh}
      searchPlaceholder="Search files..."
      filterContent={
        <div className="flex items-center gap-1.5">
          {(['all', 'image', 'document', 'starred'] as TypeFilter[]).map((filter) => (
            <button
              key={filter}
              onClick={() => handleTypeFilter(filter)}
              className={`px-3 py-1 text-xs font-medium rounded-full transition-colors flex items-center gap-1 ${
                typeFilter === filter
                  ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              {filter === 'starred' && <Star size={10} fill={typeFilter === 'starred' ? 'currentColor' : 'none'} />}
              {filter === 'all' ? 'All' : filter === 'image' ? 'Images' : filter === 'document' ? 'Documents' : 'Starred'}
            </button>
          ))}
        </div>
      }
    >
      {/* Main content area with optional sidebars */}
      <div className="flex flex-1 overflow-hidden">
        {/* Collections sidebar */}
        {showCollections && (
          <CollectionSidebar
            activeCollectionId={activeCollectionId}
            onSelectCollection={setActiveCollectionId}
            onRefresh={refresh}
          />
        )}

        {/* File list area */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Folder breadcrumbs */}
          {typeFilter === 'all' && !activeCollectionId && (
            <div className="flex items-center gap-1 text-sm px-4 py-2 bg-white dark:bg-gray-800 border-b dark:border-gray-700 flex-wrap flex-shrink-0">
              {folderPath.map((crumb, i) => (
                <span key={crumb.id ?? 'root'} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight size={14} className="text-gray-400" />}
                  <button
                    onClick={() => navigateToBreadcrumb(i)}
                    className={`px-1.5 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-1 ${
                      i === folderPath.length - 1
                        ? 'font-medium text-gray-900 dark:text-white'
                        : 'text-gray-500 dark:text-gray-400'
                    }`}
                  >
                    {i === 0 && <Home size={14} />}
                    {crumb.name}
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Active collection indicator */}
          {activeCollectionId && (
            <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 dark:bg-blue-900/20 border-b dark:border-gray-700 flex-shrink-0">
              <span className="text-xs text-blue-700 dark:text-blue-300 font-medium">
                Filtered by collection
              </span>
              <button
                onClick={() => setActiveCollectionId(null)}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                Clear filter
              </button>
            </div>
          )}

          {/* Content */}
          <div
            className="flex-1 overflow-y-auto"
            onContextMenu={(e) => {
              // Right-click on empty space
              if ((e.target as HTMLElement).closest('[data-file-card]') || (e.target as HTMLElement).closest('[data-file-row]')) return
              handleContextMenu(e, null)
            }}
          >
            {viewMode === 'grid' ? (
              <GridView
                files={fileList}
                loading={loading}
                search={search}
                selectedFiles={selectedFiles}
                cutFileIds={cutFileIds}
                renamingFileId={renamingFileId}
                renameValue={renameValue}
                onRenameChange={setRenameValue}
                onRenameCommit={commitRename}
                onRenameCancel={() => setRenamingFileId(null)}
                onFileClick={handleFileClick}
                onFileDoubleClick={handleFileDoubleClick}
                onDelete={handleDeleteClick}
                onToggleSelect={handleToggleSelect}
                onToggleStar={handleToggleStar}
                onContextMenu={handleContextMenu}
              />
            ) : (
              <ListView
                files={fileList}
                loading={loading}
                search={search}
                selectedFiles={selectedFiles}
                cutFileIds={cutFileIds}
                renamingFileId={renamingFileId}
                renameValue={renameValue}
                onRenameChange={setRenameValue}
                onRenameCommit={commitRename}
                onRenameCancel={() => setRenamingFileId(null)}
                onFileClick={handleFileClick}
                onFileDoubleClick={handleFileDoubleClick}
                onDelete={handleDeleteClick}
                onToggleSelect={handleToggleSelect}
                onToggleStar={handleToggleStar}
                onContextMenu={handleContextMenu}
              />
            )}
          </div>

          {/* Pagination */}
          <div className="bg-white dark:bg-gray-800 border-t dark:border-gray-700 flex-shrink-0">
            <Pagination
              page={pagination.page}
              pageSize={pagination.pageSize}
              total={pagination.total}
              totalPages={pagination.totalPages}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              className="px-4"
            />
          </div>
        </div>

        {/* File detail panel */}
        {detailFile && (
          <FileDetailPanel
            file={detailFile}
            onClose={() => setDetailFile(null)}
            onRefresh={handleDetailRefresh}
            onDelete={(file) => handleDeleteClick(file)}
          />
        )}
      </div>

      {/* Context menu */}
      <ContextMenu
        items={contextMenuItems}
        position={contextMenu?.position || null}
        onClose={closeContextMenu}
      />

      {/* Bulk actions bar */}
      <BulkActionsBar
        selectedIds={selectedIdsArray}
        currentFolderId={currentFolderId}
        onClear={handleClearSelection}
        onComplete={refresh}
        onCopy={handleCopy}
        onCut={handleCut}
        onMove={handleBulkMove}
      />

      {/* Document Viewer */}
      <DocumentViewer
        isOpen={viewerOpen}
        onClose={() => setViewerOpen(false)}
        attachments={viewerAttachments}
        initialIndex={viewerIndex}
      />

      {/* Modals */}
      <FileUploadModal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        folderId={currentFolderId}
        onUploaded={refresh}
      />

      <FolderCreateModal
        isOpen={showFolderModal}
        onClose={() => setShowFolderModal(false)}
        parentFolderId={currentFolderId}
        onCreated={refresh}
      />

      <MoveToFolderModal
        isOpen={showMoveModal}
        onClose={() => setShowMoveModal(false)}
        fileIds={moveFileIds}
        onMoved={handleMoveComplete}
      />

      <ConfirmModal
        isOpen={showDeleteConfirm}
        onClose={() => {
          setShowDeleteConfirm(false)
          setDeletingFile(null)
        }}
        onConfirm={handleDelete}
        title={`Delete ${deletingFile?.isFolder ? 'Folder' : 'File'}`}
        message={`Are you sure you want to delete "${deletingFile?.fileName}"?${
          deletingFile?.isFolder ? ' All files inside will be moved to the root.' : ''
        }`}
        confirmText="Delete"
        processing={deleting}
      />
    </ListPageLayout>
  )
}

// =====================================================
// Grid View
// =====================================================

interface ViewProps {
  files: FileRecord[]
  loading: boolean
  search: string
  selectedFiles: Set<string>
  cutFileIds: Set<string>
  renamingFileId: string | null
  renameValue: string
  onRenameChange: (value: string) => void
  onRenameCommit: () => void
  onRenameCancel: () => void
  onFileClick: (file: FileRecord) => void
  onFileDoubleClick: (file: FileRecord) => void
  onDelete: (file: FileRecord, e?: React.MouseEvent) => void
  onToggleSelect: (fileId: string, shiftKey: boolean) => void
  onToggleStar: (file: FileRecord, e: React.MouseEvent) => void
  onContextMenu: (e: React.MouseEvent, file: FileRecord | null) => void
}

const GridView = React.memo(function GridView({
  files,
  loading,
  search,
  selectedFiles,
  cutFileIds,
  renamingFileId,
  renameValue,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  onFileClick,
  onFileDoubleClick,
  onDelete,
  onToggleSelect,
  onToggleStar,
  onContextMenu,
}: ViewProps) {
  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 p-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="border border-gray-200 dark:border-gray-700 rounded overflow-hidden animate-pulse">
              <div className="h-[140px] bg-gray-100 dark:bg-gray-700" />
              <div className="p-2 space-y-1.5">
                <div className="h-3 bg-gray-100 dark:bg-gray-700 rounded w-3/4" />
                <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (files.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 px-4 py-16 text-center text-gray-500 dark:text-gray-400">
        <File size={40} className="mx-auto mb-3 text-gray-300 dark:text-gray-600" />
        <p>{search ? 'No files match your search' : 'This folder is empty'}</p>
        <p className="text-sm mt-1">Upload files or create a folder to get started</p>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-800 p-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
        {files.map((file, index) => (
          <FileCard
            key={file.id}
            file={file}
            index={index}
            isSelected={selectedFiles.has(file.id)}
            isCut={cutFileIds.has(file.id)}
            isRenaming={renamingFileId === file.id}
            renameValue={renameValue}
            onRenameChange={onRenameChange}
            onRenameCommit={onRenameCommit}
            onRenameCancel={onRenameCancel}
            onClick={() => onFileClick(file)}
            onDoubleClick={() => onFileDoubleClick(file)}
            onDelete={(e) => onDelete(file, e)}
            onToggleSelect={(e) => onToggleSelect(file.id, e.shiftKey)}
            onToggleStar={(e) => onToggleStar(file, e)}
            onContextMenu={(e) => onContextMenu(e, file)}
          />
        ))}
      </div>
    </div>
  )
})

const FileCard = React.memo(function FileCard({
  file,
  index = 0,
  isSelected,
  isCut,
  isRenaming,
  renameValue,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  onClick,
  onDoubleClick,
  onDelete,
  onToggleSelect,
  onToggleStar,
  onContextMenu,
}: {
  file: FileRecord
  index?: number
  isSelected: boolean
  isCut: boolean
  isRenaming: boolean
  renameValue: string
  onRenameChange: (value: string) => void
  onRenameCommit: () => void
  onRenameCancel: () => void
  onClick: () => void
  onDoubleClick: () => void
  onDelete: (e: React.MouseEvent) => void
  onToggleSelect: (e: React.MouseEvent) => void
  onToggleStar: (e: React.MouseEvent) => void
  onContextMenu: (e: React.MouseEvent) => void
}) {
  const [imgError, setImgError] = useState(false)
  const showThumbnail = isImageFile(file) && !imgError
  // Prefer pre-generated thumbnail: for public files use CDN URL directly, for private use thumbnail API
  const thumbnailUrl = file.thumbnailUrl
    ? (file.isPrivate ? `/api/files/${file.id}/thumbnail` : file.thumbnailUrl)
    : (file.isPrivate ? `/api/files/${file.id}/thumbnail` : file.fileUrl)

  return (
    <div
      data-file-card
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      className={`group relative border rounded overflow-hidden cursor-pointer hover:shadow-md transition-all bg-white dark:bg-gray-800 ${
        isCut ? 'opacity-50' : ''
      } ${
        isSelected
          ? 'border-blue-500 dark:border-blue-400 ring-1 ring-blue-500/50'
          : 'border-gray-200 dark:border-gray-700 hover:border-blue-400 dark:hover:border-blue-500'
      }`}
    >
      {/* Thumbnail / Icon area */}
      <div className="h-[140px] flex items-center justify-center bg-gray-50 dark:bg-gray-900/50 overflow-hidden relative">
        {showThumbnail ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={thumbnailUrl}
            alt={file.fileName}
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
            loading={index < 6 ? 'eager' : 'lazy'}
            decoding="async"
            fetchPriority={index < 6 ? 'high' : 'low'}
          />
        ) : file.isFolder ? (
          <Folder size={48} className="text-amber-400" />
        ) : (
          getFileIconLarge(file)
        )}

        {/* Checkbox overlay - top left */}
        <div
          className={`absolute top-2 left-2 transition-opacity ${
            isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          <button
            onClick={(e) => {
              e.stopPropagation()
              onToggleSelect(e)
            }}
            className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
              isSelected
                ? 'bg-blue-600 border-blue-600 text-white'
                : 'bg-white/90 dark:bg-gray-800/90 border-gray-300 dark:border-gray-500 hover:border-blue-500'
            }`}
            aria-label={isSelected ? 'Deselect' : 'Select'}
          >
            {isSelected && (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M1.5 5L4 7.5L8.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </div>

        {/* Star - top left next to checkbox */}
        {!file.isFolder && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onToggleStar(e)
            }}
            className={`absolute top-2 left-9 transition-opacity ${
              file.isStarred ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
            title={file.isStarred ? 'Unstar' : 'Star'}
          >
            <Star
              size={14}
              className={file.isStarred ? 'text-amber-400 fill-amber-400' : 'text-white/80 hover:text-amber-400'}
              fill={file.isStarred ? 'currentColor' : 'none'}
            />
          </button>
        )}
      </div>

      {/* Info area */}
      <div className="p-2.5">
        {isRenaming ? (
          <input
            type="text"
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRenameCommit()
              if (e.key === 'Escape') onRenameCancel()
            }}
            onBlur={onRenameCommit}
            onClick={(e) => e.stopPropagation()}
            className="w-full text-sm font-medium text-gray-900 dark:text-white bg-white dark:bg-gray-700 border border-blue-500 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
            autoFocus
          />
        ) : (
          <p className="text-sm font-medium text-gray-900 dark:text-white truncate" title={file.fileName}>
            {file.fileName}
          </p>
        )}
        <div className="flex items-center gap-1.5 mt-1">
          {!file.isFolder && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {formatSize(file.fileSize)}
            </span>
          )}
          {!file.isFolder && (
            <>
              <span className="text-xs text-gray-300 dark:text-gray-600">&middot;</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {formatDate(file.createdAt)}
              </span>
            </>
          )}
          {file.isFolder && (
            <span className="text-xs text-gray-500 dark:text-gray-400">Folder</span>
          )}
        </div>
      </div>

      {/* Badges & actions overlay */}
      <div className="absolute top-2 right-2 flex items-center gap-1">
        {file.isPrivate && (
          <span className="p-1 bg-black/50 rounded" title="Private">
            <Lock size={12} className="text-white" />
          </span>
        )}
      </div>

      {/* Hover actions */}
      <div className="absolute bottom-12 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {!file.isFolder && (
          <a
            href={file.isPrivate ? `/api/files/${file.id}/download` : file.fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="p-1.5 bg-white dark:bg-gray-700 rounded-md shadow-sm border dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
            title="Download"
          >
            <Download size={14} />
          </a>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDelete(e)
          }}
          className="p-1.5 bg-white dark:bg-gray-700 rounded-md shadow-sm border dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:text-red-600 dark:hover:text-red-400 transition-colors"
          title="Delete"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
})

// =====================================================
// List View
// =====================================================

const ListView = React.memo(function ListView({
  files,
  loading,
  search,
  selectedFiles,
  cutFileIds,
  renamingFileId,
  renameValue,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  onFileClick,
  onFileDoubleClick,
  onDelete,
  onToggleSelect,
  onToggleStar,
  onContextMenu,
}: ViewProps) {
  return (
    <div className="bg-white dark:bg-gray-800">
      <table className="w-full">
        <caption className="sr-only">List of files</caption>
        <thead className="table-sticky-header bg-gray-50 dark:bg-gray-900">
          <tr className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase border-b dark:border-gray-700">
            <th scope="col" className="px-2 py-3 w-10">
              {/* Select all placeholder */}
            </th>
            <th scope="col" className="px-4 py-3">Name</th>
            <th scope="col" className="px-4 py-3 hidden md:table-cell">Type</th>
            <th scope="col" className="px-4 py-3 hidden md:table-cell">Size</th>
            <th scope="col" className="px-4 py-3 hidden lg:table-cell">Uploaded By</th>
            <th scope="col" className="px-4 py-3 hidden md:table-cell">Date</th>
            <th scope="col" className="px-4 py-3 w-20"></th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <>
              {Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b dark:border-gray-700 animate-pulse">
                  <td className="px-2 py-3"><div className="w-4 h-4 bg-gray-100 dark:bg-gray-700 rounded" /></td>
                  <td className="px-4 py-3"><div className="flex items-center gap-2"><div className="w-5 h-5 bg-gray-100 dark:bg-gray-700 rounded" /><div className="h-3 bg-gray-100 dark:bg-gray-700 rounded w-32" /></div></td>
                  <td className="px-4 py-3 hidden md:table-cell"><div className="h-3 bg-gray-100 dark:bg-gray-700 rounded w-16" /></td>
                  <td className="px-4 py-3 hidden md:table-cell"><div className="h-3 bg-gray-100 dark:bg-gray-700 rounded w-12" /></td>
                  <td className="px-4 py-3 hidden lg:table-cell"><div className="h-3 bg-gray-100 dark:bg-gray-700 rounded w-20" /></td>
                  <td className="px-4 py-3 hidden md:table-cell"><div className="h-3 bg-gray-100 dark:bg-gray-700 rounded w-16" /></td>
                  <td className="px-4 py-3"><div className="h-3 bg-gray-100 dark:bg-gray-700 rounded w-8" /></td>
                </tr>
              ))}
            </>
          ) : files.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-4 py-12 text-center text-gray-500 dark:text-gray-400">
                {search ? 'No files match your search' : 'This folder is empty'}
              </td>
            </tr>
          ) : (
            files.map((file) => {
              const isSelected = selectedFiles.has(file.id)
              const isCut = cutFileIds.has(file.id)
              const isRenaming = renamingFileId === file.id
              return (
                <tr
                  key={file.id}
                  data-file-row
                  className={`border-b dark:border-gray-700 last:border-b-0 cursor-pointer transition-colors ${
                    isCut ? 'opacity-50' : ''
                  } ${
                    isSelected
                      ? 'bg-blue-50 dark:bg-blue-900/20'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                  }`}
                  onClick={() => onFileClick(file)}
                  onDoubleClick={() => onFileDoubleClick(file)}
                  onContextMenu={(e) => onContextMenu(e, file)}
                >
                  {/* Checkbox */}
                  <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onToggleSelect(file.id, e.shiftKey)
                      }}
                      className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                        isSelected
                          ? 'bg-blue-600 border-blue-600 text-white'
                          : 'border-gray-300 dark:border-gray-500 hover:border-blue-500'
                      }`}
                      aria-label={isSelected ? 'Deselect' : 'Select'}
                    >
                      {isSelected && (
                        <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                          <path d="M1.5 5L4 7.5L8.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {getFileIcon(file)}
                      {isRenaming ? (
                        <input
                          type="text"
                          value={renameValue}
                          onChange={(e) => onRenameChange(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') onRenameCommit()
                            if (e.key === 'Escape') onRenameCancel()
                          }}
                          onBlur={onRenameCommit}
                          onClick={(e) => e.stopPropagation()}
                          className="text-sm font-medium text-gray-900 dark:text-white bg-white dark:bg-gray-700 border border-blue-500 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500 w-48"
                          autoFocus
                        />
                      ) : (
                        <span className="text-sm font-medium text-gray-900 dark:text-white truncate max-w-xs">
                          {file.fileName}
                        </span>
                      )}
                      {file.isPrivate && <Lock size={12} className="text-gray-400 flex-shrink-0" />}
                      {/* Star icon */}
                      {!file.isFolder && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onToggleStar(file, e)
                          }}
                          className={`flex-shrink-0 p-0.5 rounded transition-colors ${
                            file.isStarred
                              ? 'text-amber-400'
                              : 'text-gray-300 dark:text-gray-600 hover:text-amber-400'
                          }`}
                          title={file.isStarred ? 'Unstar' : 'Star'}
                        >
                          <Star size={12} fill={file.isStarred ? 'currentColor' : 'none'} />
                        </button>
                      )}
                      {/* Tags */}
                      {file.tags && file.tags.length > 0 && (
                        <div className="hidden lg:flex items-center gap-1 flex-shrink-0">
                          {file.tags.slice(0, 2).map((tag) => (
                            <span
                              key={tag}
                              className="inline-block bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-[10px] px-1.5 py-0 rounded-full"
                            >
                              {tag}
                            </span>
                          ))}
                          {file.tags.length > 2 && (
                            <span className="text-[10px] text-gray-400 dark:text-gray-500">
                              +{file.tags.length - 2}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 hidden md:table-cell">
                    {file.isFolder ? 'Folder' : (file.fileType?.split('/')[1] || '-')}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 hidden md:table-cell">
                    {file.isFolder ? '-' : formatSize(file.fileSize)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 hidden lg:table-cell">
                    {file.uploadedByUser?.fullName || '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 hidden md:table-cell">
                    {formatDate(file.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      {!file.isFolder && (
                        <a
                          href={file.isPrivate ? `/api/files/${file.id}/download` : file.fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1 text-gray-400 hover:text-blue-600 rounded"
                          title="Download"
                        >
                          <Download size={14} />
                        </a>
                      )}
                      <button
                        onClick={(e) => onDelete(file, e)}
                        className="p-1 text-gray-400 hover:text-red-600 rounded"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
})
