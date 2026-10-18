'use client'

import { useState, useEffect, useMemo } from 'react'
import { Loader2, AlertCircle, Download } from 'lucide-react'

interface TextViewerProps {
  filePath: string
  fileName: string
  fileType: string
  mode?: 'text' | 'csv'
}

const MAX_LINES = 5000
const MAX_CSV_ROWS = 10000

function getColumnLabel(index: number): string {
  let label = ''
  let n = index
  while (n >= 0) {
    label = String.fromCharCode(65 + (n % 26)) + label
    n = Math.floor(n / 26) - 1
  }
  return label
}

export default function TextViewer({ filePath, fileName, fileType, mode: modeProp }: TextViewerProps) {
  const [content, setContent] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Determine mode from prop or file type
  const mode = modeProp || (fileType === 'text/csv' || fileName.endsWith('.csv') ? 'csv' : 'text')

  useEffect(() => {
    let cancelled = false

    async function loadFile() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(filePath)
        if (!res.ok) throw new Error(`Failed to load file (${res.status})`)
        const text = await res.text()
        if (!cancelled) setContent(text)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load file')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadFile()
    return () => { cancelled = true }
  }, [filePath])

  // Parse CSV into rows
  const csvData = useMemo(() => {
    if (mode !== 'csv' || !content) return null

    const lines = content.split('\n').filter(l => l.trim())
    const truncated = lines.length > MAX_CSV_ROWS
    const rows = lines.slice(0, MAX_CSV_ROWS).map(line => {
      // Simple CSV parse: handle quoted fields
      const cells: string[] = []
      let current = ''
      let inQuotes = false
      for (let i = 0; i < line.length; i++) {
        const char = line[i]
        if (char === '"') {
          if (inQuotes && line[i + 1] === '"') {
            current += '"'
            i++
          } else {
            inQuotes = !inQuotes
          }
        } else if (char === ',' && !inQuotes) {
          cells.push(current.trim())
          current = ''
        } else {
          current += char
        }
      }
      cells.push(current.trim())
      return cells
    })

    return { rows, truncated, totalLines: lines.length }
  }, [content, mode])

  // Text lines
  const textLines = useMemo(() => {
    if (mode !== 'text' || !content) return null
    const lines = content.split('\n')
    const truncated = lines.length > MAX_LINES
    return {
      lines: lines.slice(0, MAX_LINES),
      truncated,
      totalLines: lines.length,
    }
  }, [content, mode])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center text-white p-8">
        <Loader2 size={32} className="animate-spin mb-3" />
        <p className="text-sm text-gray-400">Loading {mode === 'csv' ? 'spreadsheet' : 'text file'}...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center text-white p-8">
        <AlertCircle size={48} className="text-red-400 mb-4" />
        <p className="text-lg mb-2">Failed to load file</p>
        <p className="text-sm text-gray-400 mb-4">{error}</p>
        <a
          href={filePath}
          download={fileName}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded transition flex items-center gap-2"
        >
          <Download size={16} />
          Download Instead
        </a>
      </div>
    )
  }

  // CSV table view
  if (mode === 'csv' && csvData) {
    const maxCols = csvData.rows.reduce((max, row) => Math.max(max, row.length), 0)

    return (
      <div className="w-full max-w-6xl mx-auto p-4">
        {csvData.truncated && (
          <div className="mb-2 px-3 py-1.5 bg-amber-900/50 text-amber-300 text-xs rounded">
            Showing first {MAX_CSV_ROWS.toLocaleString()} of {csvData.totalLines.toLocaleString()} rows
          </div>
        )}
        <div className="bg-white rounded shadow-lg overflow-auto" style={{ maxHeight: 'calc(100vh - 10rem)' }}>
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-gray-100 text-gray-600">
                <th className="sticky left-0 z-20 bg-gray-200 text-gray-500 text-xs font-normal px-2 py-1.5 border-b border-r border-gray-300 w-12 text-center">
                  #
                </th>
                {Array.from({ length: maxCols }, (_, i) => (
                  <th key={i} className="px-3 py-1.5 border-b border-r border-gray-300 text-xs font-medium text-left whitespace-nowrap">
                    {getColumnLabel(i)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {csvData.rows.map((row, rowIdx) => (
                <tr key={rowIdx} className="hover:bg-blue-50/50">
                  <td className="sticky left-0 bg-gray-50 text-gray-400 text-xs px-2 py-1 border-b border-r border-gray-200 text-center font-mono">
                    {rowIdx + 1}
                  </td>
                  {Array.from({ length: maxCols }, (_, colIdx) => (
                    <td key={colIdx} className="px-3 py-1 border-b border-r border-gray-100 text-gray-800 whitespace-nowrap max-w-[300px] truncate">
                      {row[colIdx] || ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // Plain text view
  if (mode === 'text' && textLines) {
    return (
      <div className="w-full max-w-5xl mx-auto p-4">
        {textLines.truncated && (
          <div className="mb-2 px-3 py-1.5 bg-amber-900/50 text-amber-300 text-xs rounded">
            Showing first {MAX_LINES.toLocaleString()} of {textLines.totalLines.toLocaleString()} lines
          </div>
        )}
        <div className="bg-gray-900 rounded shadow-lg overflow-auto" style={{ maxHeight: 'calc(100vh - 10rem)' }}>
          <table className="w-full font-mono text-sm">
            <tbody>
              {textLines.lines.map((line, i) => (
                <tr key={i} className="hover:bg-gray-800/50">
                  <td className="text-gray-500 text-right px-3 py-0.5 select-none border-r border-gray-700 sticky left-0 bg-gray-900 w-12 text-xs">
                    {i + 1}
                  </td>
                  <td className="text-gray-200 px-3 py-0.5 whitespace-pre">{line}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return null
}
