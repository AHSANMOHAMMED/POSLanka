'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Paperclip, Upload, Download, Trash2, Loader2, FileText, Image, File as FileIcon } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { formatDate } from '@/lib/utils/date-format'

interface Attachment {
  id: string
  fileName: string
  fileType: string | null
  fileSize: number | null
  filePath: string
  category: string | null
  description: string | null
  createdAt: string
  uploadedByUser?: { fullName: string | null } | null
}

interface DocumentAttachmentsProps {
  entityType: string
  entityId: string
  apiBasePath: string // e.g. '/api/purchase-orders/[id]/attachments'
  permission?: boolean
  onCountChange?: (count: number) => void
}

function getFileIcon(fileType: string | null) {
  if (!fileType) return <FileIcon className="h-4 w-4" />
  // eslint-disable-next-line jsx-a11y/alt-text -- lucide-react icon, not an img element
  if (fileType.startsWith('image/')) return <Image className="h-4 w-4 text-blue-500" />
  if (fileType === 'application/pdf') return <FileText className="h-4 w-4 text-red-500" />
  return <FileIcon className="h-4 w-4 text-gray-500" />
}

function formatFileSize(bytes: number | null) {
  if (!bytes) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function DocumentAttachments({ entityType: _entityType, entityId: _entityId, apiBasePath, permission = true, onCountChange }: DocumentAttachmentsProps) {
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchAttachments = useCallback(async () => {
    try {
      const res = await fetch(apiBasePath)
      if (res.ok) {
        const data = await res.json()
        setAttachments(data)
        onCountChange?.(data.length)
      }
    } catch {
      // Silent fail
    } finally {
      setLoading(false)
    }
  }, [apiBasePath, onCountChange])

  useEffect(() => {
    fetchAttachments()
  }, [fetchAttachments])

  async function uploadFile(file: File) {
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch(apiBasePath, {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Upload failed')
      }

      toast.success('File uploaded')
      fetchAttachments()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(attachmentId: string) {
    if (!confirm('Delete this attachment?')) return
    setDeleting(attachmentId)
    try {
      const res = await fetch(`${apiBasePath}?attachmentId=${attachmentId}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed')
      toast.success('Attachment deleted')
      fetchAttachments()
    } catch {
      toast.error('Failed to delete')
    } finally {
      setDeleting(null)
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) uploadFile(file)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) uploadFile(file)
  }

  return (
    <div className="bg-card rounded border">
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <Paperclip className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium text-foreground">
            Attachments ({attachments.length})
          </h3>
        </div>
        {permission && (
          <>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              Upload
            </button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleFileSelect}
              accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv"
            />
          </>
        )}
      </div>

      {/* Drop zone */}
      {permission && (
        <div
          onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`mx-4 mt-3 mb-1 border-2 border-dashed rounded p-4 text-center transition-colors ${
            isDragging ? 'border-primary bg-primary/5' : 'border-muted'
          }`}
        >
          <p className="text-xs text-muted-foreground">
            {uploading ? 'Uploading...' : 'Drag and drop files here'}
          </p>
        </div>
      )}

      {/* File list */}
      <div className="p-4">
        {loading ? (
          <div className="text-center py-4 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mx-auto" />
          </div>
        ) : attachments.length === 0 ? (
          <p className="text-center py-4 text-sm text-muted-foreground">No attachments</p>
        ) : (
          <div className="space-y-2">
            {attachments.map(att => (
              <div key={att.id} className="flex items-center justify-between p-2 rounded hover:bg-muted/30 group">
                <div className="flex items-center gap-3 min-w-0">
                  {getFileIcon(att.fileType)}
                  <div className="min-w-0">
                    <a
                      href={att.filePath}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-foreground hover:text-primary truncate block"
                    >
                      {att.fileName}
                    </a>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{formatFileSize(att.fileSize)}</span>
                      <span>{formatDate(att.createdAt)}</span>
                      {att.uploadedByUser?.fullName && <span>by {att.uploadedByUser.fullName}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <a href={att.filePath} download className="p-1.5 hover:bg-muted rounded">
                    <Download className="h-3.5 w-3.5 text-muted-foreground" />
                  </a>
                  {permission && (
                    <button
                      onClick={() => handleDelete(att.id)}
                      disabled={deleting === att.id}
                      className="p-1.5 hover:bg-red-100 dark:hover:bg-red-900/30 rounded"
                    >
                      {deleting === att.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-red-500" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5 text-red-500" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
