'use client'

import { useState } from 'react'
import { usePaginatedData } from '@/hooks'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { FileUploadModal } from '@/components/files/FileUploadModal'
import { FolderCreateModal } from '@/components/files/FolderCreateModal'
import { Pagination } from '@/components/ui/pagination'
import { toast } from '@/components/ui/toast'
import { Breadcrumb } from '@/components/ui/page-header'
import {
  FolderTree,
  Upload,
  FolderPlus,
  Trash2,
  Search,
  Folder,
  FileText,
  Image as ImageIcon,
  File,
  FileSpreadsheet,
  Download,
  Lock,
  Loader2,
  ChevronRight,
  Home,
} from 'lucide-react'

interface FileRecord {
  id: string
  fileName: string
  fileUrl: string
  fileSize: number | null
  fileType: string | null
  contentHash: string | null
  isPrivate: boolean
  isFolder: boolean
  folderId: string | null
  attachedToType: string | null
  attachedToId: string | null
  description: string | null
  category: string | null
  uploadedBy: string | null
  uploadedByUser?: { fullName: string } | null
  createdAt: string
  updatedAt: string
}

interface FolderBreadcrumb {
  id: string | null
  name: string
}

function getFileIcon(file: FileRecord) {
  if (file.isFolder) return <Folder size={18} className="text-amber-500" />
  if (!file.fileType) return <File size={18} className="text-gray-400" />

  if (file.fileType.startsWith('image/')) return <ImageIcon size={18} className="text-blue-500" />
  if (file.fileType === 'application/pdf') return <FileText size={18} className="text-red-500" />
  if (file.fileType.includes('spreadsheet') || file.fileType.includes('excel') || file.fileType.includes('csv'))
    return <FileSpreadsheet size={18} className="text-green-500" />

  return <File size={18} className="text-gray-400" />
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

export default function FileManagerPage() {
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [folderPath, setFolderPath] = useState<FolderBreadcrumb[]>([{ id: null, name: 'Home' }])
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [showFolderModal, setShowFolderModal] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deletingFile, setDeletingFile] = useState<FileRecord | null>(null)
  const [deleting, setDeleting] = useState(false)

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
    additionalParams: currentFolderId ? { folderId: currentFolderId } : {},
  })

  function navigateToFolder(file: FileRecord) {
    if (!file.isFolder) return
    setCurrentFolderId(file.id)
    setFolderPath(prev => [...prev, { id: file.id, name: file.fileName }])
  }

  function navigateToBreadcrumb(index: number) {
    const crumb = folderPath[index]
    setCurrentFolderId(crumb.id)
    setFolderPath(prev => prev.slice(0, index + 1))
  }

  function handleDeleteClick(file: FileRecord) {
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

  function handleFileClick(file: FileRecord) {
    if (file.isFolder) {
      navigateToFolder(file)
    } else if (!file.isPrivate) {
      window.open(file.fileUrl, '_blank')
    } else {
      window.open(`/api/files/${file.id}/download`, '_blank')
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Breadcrumb items={[
          { label: 'Settings', href: '/settings' },
          { label: 'File Manager' },
        ]} />
        <div className="flex items-center justify-between mt-2">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FolderTree size={24} />
            File Manager
          </h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowFolderModal(true)}
              className="px-3 py-2 text-sm text-gray-700 bg-white border rounded-md hover:bg-gray-50 flex items-center gap-1.5"
            >
              <FolderPlus size={16} />
              New Folder
            </button>
            <button
              onClick={() => setShowUploadModal(true)}
              className="px-3 py-2 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 flex items-center gap-1.5"
            >
              <Upload size={16} />
              Upload
            </button>
          </div>
        </div>
      </div>

      {/* Folder breadcrumbs */}
      <div className="flex items-center gap-1 text-sm mb-4 flex-wrap">
        {folderPath.map((crumb, i) => (
          <span key={crumb.id ?? 'root'} className="flex items-center gap-1">
            {i > 0 && <ChevronRight size={14} className="text-gray-400" />}
            <button
              onClick={() => navigateToBreadcrumb(i)}
              className={`px-1.5 py-0.5 rounded hover:bg-gray-100 flex items-center gap-1 ${
                i === folderPath.length - 1 ? 'font-medium text-gray-900' : 'text-gray-500'
              }`}
            >
              {i === 0 && <Home size={14} />}
              {crumb.name}
            </button>
          </span>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search files..."
          className="w-full pl-9 pr-4 py-2 text-sm border rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* File table */}
      <div className="bg-white rounded border">
        <table className="w-full">
          <thead className="table-sticky-header">
            <tr className="text-left text-xs font-medium text-gray-500 uppercase border-b">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3 hidden md:table-cell">Type</th>
              <th className="px-4 py-3 hidden md:table-cell">Size</th>
              <th className="px-4 py-3 hidden lg:table-cell">Attached To</th>
              <th className="px-4 py-3 hidden lg:table-cell">Uploaded By</th>
              <th className="px-4 py-3 hidden md:table-cell">Date</th>
              <th className="px-4 py-3 w-16"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-gray-500">
                  <Loader2 size={24} className="animate-spin mx-auto mb-2" />
                  Loading...
                </td>
              </tr>
            ) : fileList.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-gray-500">
                  {search ? 'No files match your search' : 'This folder is empty'}
                </td>
              </tr>
            ) : (
              fileList.map((file) => (
                <tr
                  key={file.id}
                  className="border-b last:border-b-0 hover:bg-gray-50 cursor-pointer"
                  onClick={() => handleFileClick(file)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {getFileIcon(file)}
                      <span className="text-sm font-medium text-gray-900 truncate max-w-xs">
                        {file.fileName}
                      </span>
                      {file.isPrivate && <Lock size={12} className="text-gray-400" />}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 hidden md:table-cell">
                    {file.isFolder ? 'Folder' : (file.fileType?.split('/')[1] || '-')}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 hidden md:table-cell">
                    {file.isFolder ? '-' : formatSize(file.fileSize)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 hidden lg:table-cell">
                    {file.attachedToType ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-gray-100">
                        {file.attachedToType}
                      </span>
                    ) : '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 hidden lg:table-cell">
                    {file.uploadedByUser?.fullName || '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 hidden md:table-cell">
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
                        onClick={() => handleDeleteClick(file)}
                        className="p-1 text-gray-400 hover:text-red-600 rounded"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <Pagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          totalPages={pagination.totalPages}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          className="border-t px-4"
        />
      </div>

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

      <ConfirmModal
        isOpen={showDeleteConfirm}
        onClose={() => { setShowDeleteConfirm(false); setDeletingFile(null) }}
        onConfirm={handleDelete}
        title={`Delete ${deletingFile?.isFolder ? 'Folder' : 'File'}`}
        message={`Are you sure you want to delete "${deletingFile?.fileName}"?${
          deletingFile?.isFolder ? ' All files inside will be moved to the root.' : ''
        }`}
        confirmText="Delete"
        processing={deleting}
      />
    </div>
  )
}
