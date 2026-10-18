'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  X,
  Star,
  Download,
  Trash2,
  Tag,
  Edit2,
  FileText,
  Image as ImageIcon,
  History,
  Shield,
  ChevronDown,
  ChevronRight,
  Upload,
  Loader2,
  File,
  FileSpreadsheet,
  Folder,
  Check,
} from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { FileTagInput } from './FileTagInput'

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

interface FileVersion {
  id: string
  versionNumber: number
  fileUrl: string
  fileSize: number | null
  changeDescription: string | null
  uploadedBy: string | null
  uploadedByUser?: { fullName: string } | null
  createdAt: string
}

interface AuditLogEntry {
  id: string
  action: string
  fileName: string | null
  userId: string | null
  user?: { fullName: string } | null
  details: Record<string, unknown> | null
  createdAt: string
}

interface FileDetailPanelProps {
  file: FileRecord | null
  onClose: () => void
  onRefresh: () => void
  onDelete?: (file: FileRecord) => void
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

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getFileTypeLabel(fileType: string | null): string {
  if (!fileType) return 'Unknown'
  if (fileType.startsWith('image/')) return 'Image'
  if (fileType === 'application/pdf') return 'PDF'
  if (fileType.includes('spreadsheet') || fileType.includes('excel') || fileType.includes('csv')) return 'Spreadsheet'
  if (fileType.includes('word') || fileType.includes('document')) return 'Document'
  return fileType.split('/')[1]?.toUpperCase() || 'File'
}

function getFileIcon(fileType: string | null, size = 18) {
  if (!fileType) return <File size={size} className="text-gray-400" />
  if (fileType.startsWith('image/')) return <ImageIcon size={size} className="text-blue-500" />
  if (fileType === 'application/pdf') return <FileText size={size} className="text-red-500" />
  if (fileType.includes('spreadsheet') || fileType.includes('excel') || fileType.includes('csv'))
    return <FileSpreadsheet size={size} className="text-green-500" />
  return <File size={size} className="text-gray-400" />
}

function getAuditActionLabel(action: string): string {
  const labels: Record<string, string> = {
    viewed: 'Viewed',
    downloaded: 'Downloaded',
    uploaded: 'Uploaded',
    deleted: 'Deleted',
    renamed: 'Renamed',
    moved: 'Moved',
    shared: 'Shared',
    version_created: 'New version',
    restored: 'Restored',
    starred: 'Starred',
    unstarred: 'Unstarred',
    tagged: 'Tags updated',
  }
  return labels[action] || action
}

export function FileDetailPanel({ file, onClose, onRefresh, onDelete }: FileDetailPanelProps) {
  // Edit states
  const [editingName, setEditingName] = useState(false)
  const [editName, setEditName] = useState('')
  const [editingDescription, setEditingDescription] = useState(false)
  const [editDescription, setEditDescription] = useState('')
  const [saving, setSaving] = useState(false)

  // Version & audit state
  const [versions, setVersions] = useState<FileVersion[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([])
  const [versionsExpanded, setVersionsExpanded] = useState(false)
  const [auditExpanded, setAuditExpanded] = useState(false)
  const [loadingVersions, setLoadingVersions] = useState(false)
  const [loadingAudit, setLoadingAudit] = useState(false)
  const [togglingStarred, setTogglingStarred] = useState(false)

  // Upload version
  const versionInputRef = useRef<HTMLInputElement>(null)
  const [uploadingVersion, setUploadingVersion] = useState(false)

  // Name input ref for auto-focus
  const nameInputRef = useRef<HTMLInputElement>(null)

  // Reset state when file changes
  useEffect(() => {
    if (file) {
      setEditingName(false)
      setEditName(file.fileName)
      setEditingDescription(false)
      setEditDescription(file.description || '')
      setVersions([])
      setAuditLogs([])
      setVersionsExpanded(false)
      setAuditExpanded(false)
    }
  }, [file?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Focus name input when editing starts
  useEffect(() => {
    if (editingName && nameInputRef.current) {
      nameInputRef.current.focus()
      nameInputRef.current.select()
    }
  }, [editingName])

  const fetchVersions = useCallback(async () => {
    if (!file) return
    setLoadingVersions(true)
    try {
      const res = await fetch(`/api/files/${file.id}/versions`)
      if (res.ok) {
        const data = await res.json()
        setVersions(Array.isArray(data) ? data : data.data || [])
      }
    } catch {
      // Silently fail - versions may not be available yet
    } finally {
      setLoadingVersions(false)
    }
  }, [file])

  const fetchAuditLogs = useCallback(async () => {
    if (!file) return
    setLoadingAudit(true)
    try {
      const res = await fetch(`/api/files/${file.id}/audit`)
      if (res.ok) {
        const data = await res.json()
        setAuditLogs(Array.isArray(data) ? data : data.data || [])
      }
    } catch {
      // Silently fail - audit may not be available yet
    } finally {
      setLoadingAudit(false)
    }
  }, [file])

  // Fetch versions when expanded
  useEffect(() => {
    if (versionsExpanded && versions.length === 0) {
      fetchVersions()
    }
  }, [versionsExpanded, versions.length, fetchVersions])

  // Fetch audit logs when expanded
  useEffect(() => {
    if (auditExpanded && auditLogs.length === 0) {
      fetchAuditLogs()
    }
  }, [auditExpanded, auditLogs.length, fetchAuditLogs])

  const handleSaveName = useCallback(async () => {
    if (!file || !editName.trim() || editName.trim() === file.fileName) {
      setEditingName(false)
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/files/${file.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: editName.trim() }),
      })
      if (res.ok) {
        toast.success('File renamed')
        onRefresh()
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to rename')
      }
    } catch {
      toast.error('Failed to rename file')
    } finally {
      setSaving(false)
      setEditingName(false)
    }
  }, [file, editName, onRefresh])

  const handleSaveDescription = useCallback(async () => {
    if (!file) return
    if (editDescription === (file.description || '')) {
      setEditingDescription(false)
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/files/${file.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: editDescription || null }),
      })
      if (res.ok) {
        toast.success('Description updated')
        onRefresh()
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to update description')
      }
    } catch {
      toast.error('Failed to update description')
    } finally {
      setSaving(false)
      setEditingDescription(false)
    }
  }, [file, editDescription, onRefresh])

  const handleTagsChange = useCallback(async (newTags: string[]) => {
    if (!file) return
    try {
      const res = await fetch(`/api/files/${file.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: newTags }),
      })
      if (res.ok) {
        onRefresh()
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to update tags')
      }
    } catch {
      toast.error('Failed to update tags')
    }
  }, [file, onRefresh])

  const handleToggleStar = useCallback(async () => {
    if (!file || togglingStarred) return
    setTogglingStarred(true)
    try {
      const res = await fetch(`/api/files/${file.id}/star`, {
        method: 'POST',
      })
      if (res.ok) {
        onRefresh()
      } else {
        toast.error('Failed to update star')
      }
    } catch {
      toast.error('Failed to update star')
    } finally {
      setTogglingStarred(false)
    }
  }, [file, togglingStarred, onRefresh])

  const handleUploadVersion = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!file || !e.target.files || e.target.files.length === 0) return
    const uploadFile = e.target.files[0]
    setUploadingVersion(true)
    try {
      const formData = new FormData()
      formData.append('file', uploadFile)

      const res = await fetch(`/api/files/${file.id}/versions`, {
        method: 'POST',
        body: formData,
      })
      if (res.ok) {
        toast.success('New version uploaded')
        onRefresh()
        fetchVersions()
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to upload version')
      }
    } catch {
      toast.error('Failed to upload version')
    } finally {
      setUploadingVersion(false)
      // Reset file input
      if (versionInputRef.current) {
        versionInputRef.current.value = ''
      }
    }
  }, [file, onRefresh, fetchVersions])

  const handleDownload = useCallback(() => {
    if (!file) return
    if (file.isPrivate) {
      window.open(`/api/files/${file.id}/download`, '_blank')
    } else {
      window.open(file.fileUrl, '_blank')
    }
  }, [file])

  if (!file) return null

  const isImage = file.fileType?.startsWith('image/')
  const thumbnailUrl = file.thumbnailUrl
    ? (file.isPrivate ? `/api/files/${file.id}/thumbnail` : file.thumbnailUrl)
    : (file.isPrivate ? `/api/files/${file.id}/thumbnail` : file.fileUrl)

  return (
    <div className="w-80 border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex flex-col h-full overflow-hidden flex-shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate">
          File Details
        </h3>
        <button
          onClick={onClose}
          className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
          aria-label="Close details panel"
        >
          <X size={16} />
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Preview */}
        <div className="h-40 flex items-center justify-center bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
          {isImage ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={thumbnailUrl}
              alt={file.fileName}
              className="max-w-full max-h-full object-contain"
              decoding="async"
            />
          ) : file.isFolder ? (
            <Folder size={48} className="text-amber-400" />
          ) : (
            getFileIcon(file.fileType, 48)
          )}
        </div>

        {/* File name */}
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          {editingName ? (
            <div className="flex items-center gap-1">
              <input
                ref={nameInputRef}
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveName()
                  if (e.key === 'Escape') {
                    setEditingName(false)
                    setEditName(file.fileName)
                  }
                }}
                className="flex-1 text-sm font-medium text-gray-900 dark:text-white bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                disabled={saving}
              />
              <button
                onClick={handleSaveName}
                disabled={saving}
                className="p-1 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded transition-colors"
                aria-label="Save name"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              </button>
              <button
                onClick={() => {
                  setEditingName(false)
                  setEditName(file.fileName)
                }}
                className="p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                aria-label="Cancel rename"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 group">
              <span className="text-sm font-medium text-gray-900 dark:text-white truncate flex-1" title={file.fileName}>
                {file.fileName}
              </span>
              {!file.isFolder && (
                <button
                  onClick={() => {
                    setEditName(file.fileName)
                    setEditingName(true)
                  }}
                  className="p-1 text-gray-400 opacity-0 group-hover:opacity-100 hover:text-gray-600 dark:hover:text-gray-300 transition-all"
                  aria-label="Rename file"
                >
                  <Edit2 size={12} />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Quick actions */}
        {!file.isFolder && (
          <div className="flex items-center gap-1 px-4 py-2 border-b border-gray-200 dark:border-gray-700">
            <button
              onClick={handleToggleStar}
              disabled={togglingStarred}
              className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded transition-colors ${
                file.isStarred
                  ? 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
              title={file.isStarred ? 'Unstar' : 'Star'}
            >
              <Star size={14} fill={file.isStarred ? 'currentColor' : 'none'} />
              {file.isStarred ? 'Starred' : 'Star'}
            </button>
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
              title="Download"
            >
              <Download size={14} />
              Download
            </button>
            {onDelete && (
              <button
                onClick={() => onDelete(file)}
                className="flex items-center gap-1.5 px-2 py-1 text-xs text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                title="Delete"
              >
                <Trash2 size={14} />
                Delete
              </button>
            )}
          </div>
        )}

        {/* Metadata */}
        <div className="px-4 py-3 space-y-2 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-500 dark:text-gray-400 w-20 flex-shrink-0">Type</span>
            <span className="text-gray-900 dark:text-white flex items-center gap-1">
              {getFileIcon(file.fileType, 12)}
              {file.isFolder ? 'Folder' : getFileTypeLabel(file.fileType)}
            </span>
          </div>
          {!file.isFolder && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-gray-500 dark:text-gray-400 w-20 flex-shrink-0">Size</span>
              <span className="text-gray-900 dark:text-white">{formatSize(file.fileSize)}</span>
            </div>
          )}
          {file.versionNumber && file.versionNumber > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-gray-500 dark:text-gray-400 w-20 flex-shrink-0">Version</span>
              <span className="text-gray-900 dark:text-white">v{file.versionNumber}</span>
            </div>
          )}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-500 dark:text-gray-400 w-20 flex-shrink-0">Uploaded by</span>
            <span className="text-gray-900 dark:text-white">{file.uploadedByUser?.fullName || '-'}</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-500 dark:text-gray-400 w-20 flex-shrink-0">Created</span>
            <span className="text-gray-900 dark:text-white">{formatDateTime(file.createdAt)}</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-500 dark:text-gray-400 w-20 flex-shrink-0">Updated</span>
            <span className="text-gray-900 dark:text-white">{formatDateTime(file.updatedAt)}</span>
          </div>
          {file.category && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-gray-500 dark:text-gray-400 w-20 flex-shrink-0">Category</span>
              <span className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-xs">
                {file.category}
              </span>
            </div>
          )}
        </div>

        {/* Description */}
        {!file.isFolder && (
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Description</span>
              {!editingDescription && (
                <button
                  onClick={() => {
                    setEditDescription(file.description || '')
                    setEditingDescription(true)
                  }}
                  className="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  aria-label="Edit description"
                >
                  <Edit2 size={11} />
                </button>
              )}
            </div>
            {editingDescription ? (
              <div className="space-y-1.5">
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={3}
                  className="w-full text-xs text-gray-900 dark:text-white bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                  placeholder="Add a description..."
                  disabled={saving}
                />
                <div className="flex items-center gap-1 justify-end">
                  <button
                    onClick={() => {
                      setEditingDescription(false)
                      setEditDescription(file.description || '')
                    }}
                    className="px-2 py-0.5 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveDescription}
                    disabled={saving}
                    className="px-2 py-0.5 text-xs text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors disabled:opacity-50 flex items-center gap-1"
                  >
                    {saving && <Loader2 size={10} className="animate-spin" />}
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-700 dark:text-gray-300">
                {file.description || <span className="text-gray-400 dark:text-gray-500 italic">No description</span>}
              </p>
            )}
          </div>
        )}

        {/* Tags */}
        {!file.isFolder && (
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Tag size={12} className="text-gray-400" />
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Tags</span>
            </div>
            <FileTagInput
              tags={file.tags || []}
              onChange={handleTagsChange}
            />
          </div>
        )}

        {/* Version History */}
        {!file.isFolder && (
          <div className="border-b border-gray-200 dark:border-gray-700">
            <button
              onClick={() => setVersionsExpanded(!versionsExpanded)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
            >
              <div className="flex items-center gap-1.5">
                <History size={12} />
                Version History
              </div>
              {versionsExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            {versionsExpanded && (
              <div className="px-4 pb-3">
                {/* Upload new version button */}
                <button
                  onClick={() => versionInputRef.current?.click()}
                  disabled={uploadingVersion}
                  className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded border border-blue-200 dark:border-blue-800 transition-colors mb-2 disabled:opacity-50"
                >
                  {uploadingVersion ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Upload size={12} />
                  )}
                  {uploadingVersion ? 'Uploading...' : 'Upload New Version'}
                </button>
                <input
                  ref={versionInputRef}
                  type="file"
                  className="hidden"
                  onChange={handleUploadVersion}
                />

                {loadingVersions ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 size={16} className="animate-spin text-gray-400" />
                  </div>
                ) : versions.length === 0 ? (
                  <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-2">No version history</p>
                ) : (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {versions.map((v) => (
                      <div key={v.id} className="flex items-start gap-2 text-xs p-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <div className="w-5 h-5 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <span className="text-[10px] font-medium text-gray-600 dark:text-gray-400">v{v.versionNumber}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-gray-900 dark:text-white">
                            {v.changeDescription || `Version ${v.versionNumber}`}
                          </p>
                          <p className="text-gray-400 dark:text-gray-500">
                            {v.uploadedByUser?.fullName || 'Unknown'} &middot; {formatDate(v.createdAt)}
                            {v.fileSize ? ` &middot; ${formatSize(v.fileSize)}` : ''}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Audit Log */}
        {!file.isFolder && (
          <div className="border-b border-gray-200 dark:border-gray-700">
            <button
              onClick={() => setAuditExpanded(!auditExpanded)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
            >
              <div className="flex items-center gap-1.5">
                <Shield size={12} />
                Activity Log
              </div>
              {auditExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            {auditExpanded && (
              <div className="px-4 pb-3">
                {loadingAudit ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 size={16} className="animate-spin text-gray-400" />
                  </div>
                ) : auditLogs.length === 0 ? (
                  <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-2">No activity recorded</p>
                ) : (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {auditLogs.map((log) => (
                      <div key={log.id} className="flex items-start gap-2 text-xs p-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600 mt-1.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-gray-900 dark:text-white">
                            <span className="font-medium">{getAuditActionLabel(log.action)}</span>
                            {log.user && (
                              <span className="text-gray-500 dark:text-gray-400"> by {log.user.fullName}</span>
                            )}
                          </p>
                          <p className="text-gray-400 dark:text-gray-500">
                            {formatDateTime(log.createdAt)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
