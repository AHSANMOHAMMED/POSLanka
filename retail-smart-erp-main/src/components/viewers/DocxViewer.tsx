'use client'

import { useState, useEffect } from 'react'
import { Loader2, AlertCircle, Download } from 'lucide-react'
import { sanitizeHtml } from '@/lib/utils/sanitize-html'

interface DocxViewerProps {
  filePath: string
  fileName: string
  fileType: string
}

export default function DocxViewer({ filePath, fileName, fileType }: DocxViewerProps) {
  const [html, setHtml] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // .doc (old binary format) is not supported by mammoth
  const isOldDocFormat = fileType === 'application/msword' || fileName.endsWith('.doc')

  useEffect(() => {
    if (isOldDocFormat) {
      setLoading(false)
      setError('Preview is not available for .doc files. Please download and open in Microsoft Word.')
      return
    }

    let cancelled = false

    async function loadDocument() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(filePath)
        if (!res.ok) throw new Error(`Failed to load file (${res.status})`)
        const arrayBuffer = await res.arrayBuffer()

        const mammoth = await import('mammoth')
        const result = await mammoth.convertToHtml({ arrayBuffer })

        if (!cancelled) {
          setHtml(sanitizeHtml(result.value))
          if (result.messages.length > 0) {
            console.warn('Mammoth conversion warnings:', result.messages)
          }
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Failed to load document'
          if (message.includes('password') || message.includes('encrypted')) {
            setError('This document is password-protected. Please download to open.')
          } else {
            setError(message)
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadDocument()
    return () => { cancelled = true }
  }, [filePath, isOldDocFormat])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center text-white p-8">
        <Loader2 size={32} className="animate-spin mb-3" />
        <p className="text-sm text-gray-400">Loading document...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center text-white p-8">
        <AlertCircle size={48} className="text-amber-400 mb-4" />
        <p className="text-lg mb-2">Cannot preview document</p>
        <p className="text-sm text-gray-400 mb-4">{error}</p>
        <a
          href={filePath}
          download={fileName}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded transition flex items-center gap-2"
        >
          <Download size={16} />
          Download {fileName}
        </a>
      </div>
    )
  }

  return (
    <div className="w-full max-w-4xl mx-auto p-4">
      <div
        className="bg-white rounded shadow-lg overflow-auto"
        style={{ maxHeight: 'calc(100vh - 10rem)' }}
      >
        <div
          className="p-8 prose prose-sm max-w-none
            prose-headings:text-gray-900 prose-p:text-gray-700
            prose-a:text-blue-600 prose-strong:text-gray-900
            prose-table:border-collapse
            prose-th:border prose-th:border-gray-300 prose-th:px-3 prose-th:py-2 prose-th:bg-gray-50
            prose-td:border prose-td:border-gray-300 prose-td:px-3 prose-td:py-2
            prose-img:max-w-full prose-img:rounded"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  )
}
