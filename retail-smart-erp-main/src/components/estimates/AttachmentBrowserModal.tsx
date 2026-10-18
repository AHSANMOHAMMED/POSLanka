'use client'

import { useState, useEffect, useMemo } from 'react'
import { X, Search, ChevronDown, ChevronRight, FileText, Check, Link2 } from 'lucide-react'

interface Attachment {
  id: string
  fileName: string
  fileType: string
  fileSize: number
  filePath: string
  fileHash: string | null
  category: string | null
  createdAt: Date
}

interface EstimateGroup {
  estimateId: string
  estimateNo: string
  customerName: string | null
  vehicleInfo: string | null
  attachments: Attachment[]
}

interface Props {
  isOpen: boolean
  onClose: () => void
  estimateId: string
  onLink: (attachmentIds: string[]) => Promise<void>
}

export function AttachmentBrowserModal({ isOpen, onClose, estimateId, onLink }: Props) {
  const [groups, setGroups] = useState<EstimateGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [linking, setLinking] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [expandedEstimates, setExpandedEstimates] = useState<Set<string>>(new Set())

  // Fetch attachments when modal opens
  useEffect(() => {
    async function fetchAttachments() {
      if (!isOpen) return

      setLoading(true)
      try {
        const res = await fetch(`/api/insurance-estimates/attachments/browse?excludeEstimateId=${estimateId}`)
        if (res.ok) {
          const data = await res.json()
          setGroups(data)
          // Expand first group by default
          if (data.length > 0) {
            setExpandedEstimates(new Set([data[0].estimateId]))
          }
        }
      } catch (error) {
        console.error('Error fetching attachments:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchAttachments()
    // Reset selection when modal opens
    setSelectedIds(new Set())
    setSearchQuery('')
  }, [isOpen, estimateId])

  // Filter groups and attachments by search query
  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return groups

    const query = searchQuery.toLowerCase()
    return groups.map(group => ({
      ...group,
      attachments: group.attachments.filter(a =>
        a.fileName.toLowerCase().includes(query) ||
        (a.category && a.category.toLowerCase().includes(query))
      ),
    })).filter(group =>
      group.attachments.length > 0 ||
      group.estimateNo.toLowerCase().includes(query) ||
      (group.customerName && group.customerName.toLowerCase().includes(query)) ||
      (group.vehicleInfo && group.vehicleInfo.toLowerCase().includes(query))
    )
  }, [groups, searchQuery])

  const toggleEstimateExpand = (estimateId: string) => {
    setExpandedEstimates(prev => {
      const next = new Set(prev)
      if (next.has(estimateId)) {
        next.delete(estimateId)
      } else {
        next.add(estimateId)
      }
      return next
    })
  }

  const toggleAttachmentSelection = (attachmentId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(attachmentId)) {
        next.delete(attachmentId)
      } else {
        next.add(attachmentId)
      }
      return next
    })
  }

  const handleLinkSelected = async () => {
    if (selectedIds.size === 0) return

    setLinking(true)
    try {
      await onLink(Array.from(selectedIds))
      onClose()
    } catch (error) {
      console.error('Error linking attachments:', error)
    } finally {
      setLinking(false)
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">Browse Existing Attachments</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded"
          >
            <X size={20} />
          </button>
        </div>

        {/* Search bar */}
        <div className="p-4 border-b bg-gray-50">
          <div className="relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search files..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="text-center py-8 text-gray-500">Loading...</div>
          ) : filteredGroups.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              {searchQuery ? 'No attachments match your search' : 'No attachments found in other estimates'}
            </div>
          ) : (
            <div className="space-y-4">
              {filteredGroups.map(group => (
                <div key={group.estimateId} className="border rounded overflow-hidden">
                  {/* Estimate header */}
                  <button
                    onClick={() => toggleEstimateExpand(group.estimateId)}
                    className="w-full flex items-center gap-3 p-3 bg-gray-50 hover:bg-gray-100 text-left"
                  >
                    {expandedEstimates.has(group.estimateId) ? (
                      <ChevronDown size={18} className="text-gray-500" />
                    ) : (
                      <ChevronRight size={18} className="text-gray-500" />
                    )}
                    <div className="flex-1">
                      <div className="font-medium">{group.estimateNo}</div>
                      <div className="text-sm text-gray-500">
                        {group.customerName}
                        {group.vehicleInfo && ` - ${group.vehicleInfo}`}
                      </div>
                    </div>
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                      {group.attachments.length} file{group.attachments.length !== 1 ? 's' : ''}
                    </span>
                  </button>

                  {/* Attachments grid */}
                  {expandedEstimates.has(group.estimateId) && (
                    <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4">
                      {group.attachments.map(attachment => {
                        const isSelected = selectedIds.has(attachment.id)
                        return (
                          <button
                            key={attachment.id}
                            onClick={() => toggleAttachmentSelection(attachment.id)}
                            className={`relative text-left rounded border-2 overflow-hidden transition-colors ${
                              isSelected
                                ? 'border-blue-500 ring-2 ring-blue-200'
                                : 'border-transparent hover:border-gray-300'
                            }`}
                          >
                            {/* Thumbnail */}
                            <div className="aspect-square bg-gray-100">
                              {attachment.fileType.startsWith('image/') ? (
                                /* eslint-disable-next-line @next/next/no-img-element */
                                <img
                                  src={attachment.filePath}
                                  alt={attachment.fileName}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="flex items-center justify-center w-full h-full">
                                  <FileText size={32} className="text-gray-400" />
                                </div>
                              )}
                            </div>

                            {/* Selection indicator */}
                            <div className={`absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center ${
                              isSelected
                                ? 'bg-blue-500 text-white'
                                : 'bg-white/80 border border-gray-300'
                            }`}>
                              {isSelected && <Check size={14} />}
                            </div>

                            {/* Info */}
                            <div className="p-2">
                              <p className="text-xs font-medium truncate" title={attachment.fileName}>
                                {attachment.fileName}
                              </p>
                              <p className="text-xs text-gray-500">
                                {formatFileSize(attachment.fileSize)}
                              </p>
                              {attachment.category && (
                                <span className="inline-block mt-1 px-1.5 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">
                                  {attachment.category}
                                </span>
                              )}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t flex items-center justify-between bg-gray-50">
          <div className="text-sm text-gray-600">
            {selectedIds.size > 0 && (
              <span className="font-medium">{selectedIds.size} file{selectedIds.size !== 1 ? 's' : ''} selected</span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-600 border rounded hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              onClick={handleLinkSelected}
              disabled={selectedIds.size === 0 || linking}
              className={`flex items-center gap-2 px-4 py-2 rounded text-white ${
                selectedIds.size === 0 || linking
                  ? 'bg-gray-300 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              <Link2 size={16} />
              {linking ? 'Linking...' : 'Link Selected'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
