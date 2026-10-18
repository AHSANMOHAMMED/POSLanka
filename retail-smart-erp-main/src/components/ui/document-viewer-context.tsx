'use client'

import { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import { DocumentViewer } from './document-viewer'

export interface ViewerAttachment {
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

interface DocumentViewerContextType {
  openViewer: (attachments: ViewerAttachment[], initialIndex?: number) => void
  closeViewer: () => void
  isOpen: boolean
}

const DocumentViewerContext = createContext<DocumentViewerContextType | null>(null)

export function useDocumentViewer() {
  const context = useContext(DocumentViewerContext)
  if (!context) {
    throw new Error('useDocumentViewer must be used within a DocumentViewerProvider')
  }
  return context
}

interface DocumentViewerProviderProps {
  children: ReactNode
}

export function DocumentViewerProvider({ children }: DocumentViewerProviderProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [attachments, setAttachments] = useState<ViewerAttachment[]>([])
  const [initialIndex, setInitialIndex] = useState(0)

  const openViewer = useCallback((files: ViewerAttachment[], index: number = 0) => {
    setAttachments(files)
    setInitialIndex(index)
    setIsOpen(true)
  }, [])

  const closeViewer = useCallback(() => {
    setIsOpen(false)
  }, [])

  return (
    <DocumentViewerContext.Provider value={{ openViewer, closeViewer, isOpen }}>
      {children}
      <DocumentViewer
        isOpen={isOpen}
        onClose={closeViewer}
        attachments={attachments}
        initialIndex={initialIndex}
      />
    </DocumentViewerContext.Provider>
  )
}
