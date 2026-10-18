'use client'

import { useState, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import {
  X, ChevronLeft, ChevronRight, Download, ZoomIn, ZoomOut, RotateCw,
  FileText, Image as ImageIcon, FileSpreadsheet, Play, FileType2
} from 'lucide-react'

// Lazy-load heavy viewer components (zero impact on initial page load)
const ExcelViewer = dynamic(() => import('@/components/viewers/ExcelViewer'), {
  loading: () => <ViewerLoading message="Loading spreadsheet viewer..." />,
  ssr: false,
})

const DocxViewer = dynamic(() => import('@/components/viewers/DocxViewer'), {
  loading: () => <ViewerLoading message="Loading document viewer..." />,
  ssr: false,
})

const VideoPlayer = dynamic(() => import('@/components/viewers/VideoPlayer'), {
  loading: () => <ViewerLoading message="Loading video player..." />,
  ssr: false,
})

const TextViewer = dynamic(() => import('@/components/viewers/TextViewer'), {
  loading: () => <ViewerLoading message="Loading text viewer..." />,
  ssr: false,
})

function ViewerLoading({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-white">
      <div className="w-10 h-10 border-4 border-white/30 border-t-white rounded-full animate-spin mb-4" />
      <p className="text-sm text-gray-400">{message}</p>
    </div>
  )
}

type ViewerType = 'image' | 'pdf' | 'excel' | 'docx' | 'video' | 'csv' | 'text' | 'unsupported'

function getViewerType(fileType: string, fileName: string): ViewerType {
  if (fileType.startsWith('image/')) return 'image'
  if (fileType === 'application/pdf') return 'pdf'

  // Excel
  if (
    fileType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    fileType === 'application/vnd.ms-excel' ||
    fileName.endsWith('.xlsx') || fileName.endsWith('.xls')
  ) return 'excel'

  // Word (DOCX only - mammoth doesn't support .doc binary format)
  if (
    fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    fileType === 'application/msword' ||
    fileName.endsWith('.docx') || fileName.endsWith('.doc')
  ) return 'docx'

  // Video
  if (fileType.startsWith('video/') || fileName.endsWith('.mkv')) return 'video'

  // CSV
  if (fileType === 'text/csv' || fileName.endsWith('.csv')) return 'csv'

  // Plain text
  if (fileType === 'text/plain' || fileName.endsWith('.txt')) return 'text'

  return 'unsupported'
}

interface Attachment {
  id: string
  fileName: string
  fileType: string
  fileSize: number
  filePath: string
  thumbnailPath?: string | null
  category?: string | null
  description?: string | null
  createdAt: string
  uploadedByUser?: { fullName: string } | null
}

interface DocumentViewerProps {
  isOpen: boolean
  onClose: () => void
  attachments: Attachment[]
  initialIndex?: number
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString()
}

function getHeaderIcon(viewerType: ViewerType) {
  switch (viewerType) {
    case 'image': return <ImageIcon size={20} className="text-blue-400" />
    case 'pdf': return <FileText size={20} className="text-red-400" />
    case 'excel': case 'csv': return <FileSpreadsheet size={20} className="text-green-400" />
    case 'docx': return <FileType2 size={20} className="text-blue-400" />
    case 'video': return <Play size={20} className="text-purple-400" />
    case 'text': return <FileText size={20} className="text-gray-400" />
    default: return <FileText size={20} className="text-gray-400" />
  }
}

function getThumbnailIcon(attachment: Attachment) {
  const vt = getViewerType(attachment.fileType, attachment.fileName)
  switch (vt) {
    case 'excel': case 'csv': return <FileSpreadsheet size={24} className="text-green-400" />
    case 'docx': return <FileType2 size={24} className="text-blue-400" />
    case 'video': return <Play size={24} className="text-purple-400" />
    case 'text': return <FileText size={24} className="text-yellow-400" />
    default: return <FileText size={24} className="text-gray-400" />
  }
}

export function DocumentViewer({ isOpen, onClose, attachments, initialIndex = 0 }: DocumentViewerProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex)
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [loading, setLoading] = useState(true)

  const currentAttachment = attachments[currentIndex]
  const viewerType = currentAttachment ? getViewerType(currentAttachment.fileType, currentAttachment.fileName) : 'unsupported'

  // Reset state when attachment changes
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setZoom(1); setRotation(0); setLoading(true) }, [currentIndex])

  // Reset index when attachments change or modal opens
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (isOpen) setCurrentIndex(initialIndex) }, [isOpen, initialIndex])

  const goToPrevious = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1)
    }
  }, [currentIndex])

  const goToNext = useCallback(() => {
    if (currentIndex < attachments.length - 1) {
      setCurrentIndex(currentIndex + 1)
    }
  }, [currentIndex, attachments.length])

  const handleZoomIn = () => setZoom(prev => Math.min(prev + 0.25, 3))
  const handleZoomOut = () => setZoom(prev => Math.max(prev - 0.25, 0.5))

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept Ctrl+F/Ctrl+C when sub-viewers handle them
      if (viewerType === 'excel' || viewerType === 'csv') {
        if (e.key !== 'Escape' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      }

      switch (e.key) {
        case 'Escape':
          onClose()
          break
        case 'ArrowLeft':
          goToPrevious()
          break
        case 'ArrowRight':
          goToNext()
          break
        case '+':
        case '=':
          if (viewerType === 'image') handleZoomIn()
          break
        case '-':
          if (viewerType === 'image') handleZoomOut()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, currentIndex, attachments.length, goToPrevious, goToNext, onClose, viewerType])

  const handleRotate = () => setRotation(prev => (prev + 90) % 360)

  const handleDownload = () => {
    if (currentAttachment) {
      const link = document.createElement('a')
      link.href = currentAttachment.filePath
      link.download = currentAttachment.fileName
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    }
  }

  if (!isOpen || !currentAttachment) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-black/50 text-white flex-shrink-0">
        <div className="flex items-center gap-4 min-w-0">
          {getHeaderIcon(viewerType)}
          <div className="min-w-0">
            <h3 className="font-medium truncate">{currentAttachment.fileName}</h3>
            <p className="text-sm text-gray-400 truncate">
              {formatFileSize(currentAttachment.fileSize)}
              {currentAttachment.uploadedByUser && ` • Uploaded by ${currentAttachment.uploadedByUser.fullName}`}
              {currentAttachment.createdAt && ` • ${formatDate(currentAttachment.createdAt)}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Zoom controls (for images only) */}
          {viewerType === 'image' && (
            <>
              <button
                onClick={handleZoomOut}
                className="p-2 hover:bg-white/10 rounded transition"
                title="Zoom out (-)"
              >
                <ZoomOut size={20} />
              </button>
              <span className="text-sm min-w-[4rem] text-center">{Math.round(zoom * 100)}%</span>
              <button
                onClick={handleZoomIn}
                className="p-2 hover:bg-white/10 rounded transition"
                title="Zoom in (+)"
              >
                <ZoomIn size={20} />
              </button>
              <button
                onClick={handleRotate}
                className="p-2 hover:bg-white/10 rounded transition"
                title="Rotate"
              >
                <RotateCw size={20} />
              </button>
              <div className="w-px h-6 bg-white/20 mx-2" />
            </>
          )}

          <button
            onClick={handleDownload}
            className="p-2 hover:bg-white/10 rounded transition"
            title="Download"
          >
            <Download size={20} />
          </button>

          <button
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded transition ml-2"
            title="Close (Esc)"
          >
            <X size={24} />
          </button>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 relative overflow-hidden flex items-center justify-center">
        {/* Navigation arrows */}
        {attachments.length > 1 && (
          <>
            <button
              onClick={goToPrevious}
              disabled={currentIndex === 0}
              className={`absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-black/50 text-white transition z-20 ${
                currentIndex === 0 ? 'opacity-30 cursor-not-allowed' : 'hover:bg-black/70'
              }`}
            >
              <ChevronLeft size={32} />
            </button>
            <button
              onClick={goToNext}
              disabled={currentIndex === attachments.length - 1}
              className={`absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-black/50 text-white transition z-20 ${
                currentIndex === attachments.length - 1 ? 'opacity-30 cursor-not-allowed' : 'hover:bg-black/70'
              }`}
            >
              <ChevronRight size={32} />
            </button>
          </>
        )}

        {/* Image viewer — progressive: thumbnail first, then full image */}
        {viewerType === 'image' && (
          <div className="w-full h-full flex items-center justify-center overflow-auto p-4">
            {loading && currentAttachment.thumbnailPath && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={currentAttachment.thumbnailPath}
                alt={currentAttachment.fileName}
                className="max-w-full max-h-full object-contain transition-transform duration-200"
                style={{
                  transform: `scale(${zoom}) rotate(${rotation}deg)`,
                }}
                draggable={false}
              />
            )}
            {loading && !currentAttachment.thumbnailPath && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-10 h-10 border-4 border-white/30 border-t-white rounded-full animate-spin" />
              </div>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={currentAttachment.filePath}
              alt={currentAttachment.fileName}
              onLoad={() => setLoading(false)}
              className="max-w-full max-h-full object-contain transition-transform duration-200"
              style={{
                transform: `scale(${zoom}) rotate(${rotation}deg)`,
                opacity: loading ? 0 : 1,
                position: loading ? 'absolute' : 'relative',
              }}
              draggable={false}
            />
          </div>
        )}

        {/* PDF viewer */}
        {viewerType === 'pdf' && (
          <div className="w-full h-full flex items-center justify-center p-4">
            <iframe
              src={`${currentAttachment.filePath}#toolbar=1&navpanes=0`}
              className="w-full max-w-4xl h-full bg-white rounded shadow-lg"
              title={currentAttachment.fileName}
            />
          </div>
        )}

        {/* Excel viewer */}
        {viewerType === 'excel' && (
          <div className="w-full h-full p-2">
            <ExcelViewer
              filePath={currentAttachment.filePath}
              fileName={currentAttachment.fileName}
              fileType={currentAttachment.fileType}
            />
          </div>
        )}

        {/* Word document viewer */}
        {viewerType === 'docx' && (
          <DocxViewer
            filePath={currentAttachment.filePath}
            fileName={currentAttachment.fileName}
            fileType={currentAttachment.fileType}
          />
        )}

        {/* Video player */}
        {viewerType === 'video' && (
          <VideoPlayer
            filePath={currentAttachment.filePath}
            fileName={currentAttachment.fileName}
            fileType={currentAttachment.fileType}
          />
        )}

        {/* CSV viewer */}
        {viewerType === 'csv' && (
          <div className="w-full h-full">
            <TextViewer
              filePath={currentAttachment.filePath}
              fileName={currentAttachment.fileName}
              fileType={currentAttachment.fileType}
              mode="csv"
            />
          </div>
        )}

        {/* Text viewer */}
        {viewerType === 'text' && (
          <TextViewer
            filePath={currentAttachment.filePath}
            fileName={currentAttachment.fileName}
            fileType={currentAttachment.fileType}
            mode="text"
          />
        )}

        {/* Unsupported file type */}
        {viewerType === 'unsupported' && (
          <div className="text-center text-white">
            <FileText size={64} className="mx-auto mb-4 text-gray-400" />
            <p className="text-lg mb-2">Cannot preview this file type</p>
            <p className="text-gray-400 mb-4">{currentAttachment.fileType}</p>
            <button
              onClick={handleDownload}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded transition"
            >
              Download File
            </button>
          </div>
        )}
      </div>

      {/* Footer - thumbnails */}
      {attachments.length > 1 && (
        <div className="p-4 bg-black/50 flex-shrink-0">
          <div className="flex items-center justify-center gap-2 overflow-x-auto">
            {attachments.map((attachment, index) => {
              const isImg = attachment.fileType.startsWith('image/')
              return (
                <button
                  key={attachment.id}
                  onClick={() => setCurrentIndex(index)}
                  className={`flex-shrink-0 w-16 h-16 rounded overflow-hidden border-2 transition ${
                    index === currentIndex
                      ? 'border-blue-500 ring-2 ring-blue-500/50'
                      : 'border-transparent hover:border-white/30'
                  }`}
                >
                  {isImg ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={attachment.thumbnailPath || attachment.filePath}
                      alt={attachment.fileName}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div className="w-full h-full bg-gray-700 flex items-center justify-center">
                      {getThumbnailIcon(attachment)}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
          <p className="text-center text-gray-400 text-sm mt-2">
            {currentIndex + 1} of {attachments.length}
          </p>
        </div>
      )}

      {/* Category/Description info */}
      {(currentAttachment.category || currentAttachment.description) && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 bg-black/70 text-white px-4 py-2 rounded max-w-md text-center">
          {currentAttachment.category && (
            <span className="inline-block px-2 py-0.5 bg-blue-500/30 text-blue-300 text-xs rounded mr-2">
              {currentAttachment.category}
            </span>
          )}
          {currentAttachment.description && (
            <span className="text-sm">{currentAttachment.description}</span>
          )}
        </div>
      )}
    </div>
  )
}
