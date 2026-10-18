'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Loader2, AlertCircle, Download, Search, X, ChevronUp, ChevronDown } from 'lucide-react'
import { toast } from '@/components/ui/toast'

interface ExcelViewerProps {
  filePath: string
  fileName: string
  fileType: string
}

interface CellPosition {
  row: number
  col: number
}

interface SelectionRange {
  startRow: number
  startCol: number
  endRow: number
  endCol: number
}

const MAX_ROWS = 10000
const MIN_COL_WIDTH = 60
const MAX_COL_WIDTH = 300
const DEFAULT_COL_WIDTH = 100

function getColumnLabel(index: number): string {
  let label = ''
  let n = index
  while (n >= 0) {
    label = String.fromCharCode(65 + (n % 26)) + label
    n = Math.floor(n / 26) - 1
  }
  return label
}

function normalizeRange(range: SelectionRange): SelectionRange {
  return {
    startRow: Math.min(range.startRow, range.endRow),
    startCol: Math.min(range.startCol, range.endCol),
    endRow: Math.max(range.startRow, range.endRow),
    endCol: Math.max(range.startCol, range.endCol),
  }
}

function isCellInRange(row: number, col: number, range: SelectionRange | null): boolean {
  if (!range) return false
  const r = normalizeRange(range)
  return row >= r.startRow && row <= r.endRow && col >= r.startCol && col <= r.endCol
}

export default function ExcelViewer({ filePath, fileName }: ExcelViewerProps) {
  // Core state
  type WorkBookType = import('xlsx').WorkBook
  const [workbook, setWorkbook] = useState<WorkBookType | null>(null)
  const [activeSheet, setActiveSheet] = useState<string>('')
  const [sheetData, setSheetData] = useState<string[][]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [totalRows, setTotalRows] = useState(0)

  // Selection
  const [selectedCell, setSelectedCell] = useState<CellPosition | null>(null)
  const [selectionRange, setSelectionRange] = useState<SelectionRange | null>(null)

  // Search
  const [showSearch, setShowSearch] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchMatches, setSearchMatches] = useState<CellPosition[]>([])
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0)

  // Column widths
  const [colWidths, setColWidths] = useState<number[]>([])

  // Refs
  const containerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const xlsxRef = useRef<typeof import('xlsx') | null>(null)

  // Load file
  useEffect(() => {
    let cancelled = false

    async function loadFile() {
      setLoading(true)
      setError(null)
      try {
        const [response, XLSX] = await Promise.all([
          fetch(filePath),
          import('xlsx'),
        ])

        if (!response.ok) throw new Error(`Failed to load file (${response.status})`)
        const arrayBuffer = await response.arrayBuffer()

        xlsxRef.current = XLSX
        const wb = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' })

        if (!cancelled) {
          setWorkbook(wb)
          if (wb.SheetNames.length > 0) {
            setActiveSheet(wb.SheetNames[0])
          }
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Failed to load spreadsheet'
          if (message.includes('password') || message.includes('encrypt')) {
            setError('This spreadsheet is password-protected. Please download to open.')
          } else {
            setError(message)
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadFile()
    return () => { cancelled = true }
  }, [filePath])

  // Parse active sheet into 2D array
  useEffect(() => {
    if (!workbook || !activeSheet || !xlsxRef.current) return

    const XLSX = xlsxRef.current
    const sheet = workbook.Sheets[activeSheet]
    if (!sheet) return

    const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
      raw: false, // Get formatted strings
    })

    setTotalRows(raw.length)
    const isTruncated = raw.length > MAX_ROWS
    setTruncated(isTruncated)

    const rows = (isTruncated ? raw.slice(0, MAX_ROWS) : raw).map(row =>
      (row as unknown[]).map(cell => (cell === null || cell === undefined) ? '' : String(cell))
    )

    setSheetData(rows)

    // Auto-calculate column widths
    const maxCols = rows.reduce((max, row) => Math.max(max, row.length), 0)
    const widths: number[] = []
    for (let col = 0; col < maxCols; col++) {
      let maxLen = getColumnLabel(col).length
      for (let row = 0; row < Math.min(rows.length, 100); row++) {
        const val = rows[row]?.[col] || ''
        maxLen = Math.max(maxLen, val.length)
      }
      widths.push(Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, maxLen * 8 + 16)))
    }
    setColWidths(widths)

    // Reset selection when sheet changes
    setSelectedCell(null)
    setSelectionRange(null)
    setSearchQuery('')
    setSearchMatches([])
  }, [workbook, activeSheet])

  // Search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchMatches([])
      setCurrentMatchIndex(0)
      return
    }

    const query = searchQuery.toLowerCase()
    const matches: CellPosition[] = []
    for (let row = 0; row < sheetData.length; row++) {
      for (let col = 0; col < sheetData[row].length; col++) {
        if (sheetData[row][col].toLowerCase().includes(query)) {
          matches.push({ row, col })
        }
      }
    }
    setSearchMatches(matches)
    setCurrentMatchIndex(0)
  }, [searchQuery, sheetData])

  // Scroll search match into view
  useEffect(() => {
    if (searchMatches.length === 0) return
    const match = searchMatches[currentMatchIndex]
    if (!match) return

    const cellEl = containerRef.current?.querySelector(`[data-cell="${match.row}-${match.col}"]`)
    cellEl?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' })
  }, [currentMatchIndex, searchMatches])

  const maxCols = useMemo(() => {
    return sheetData.reduce((max, row) => Math.max(max, row.length), 0)
  }, [sheetData])

  // Cell click handler
  const handleCellClick = useCallback((row: number, col: number, shiftKey: boolean) => {
    if (shiftKey && selectedCell) {
      setSelectionRange({
        startRow: selectedCell.row,
        startCol: selectedCell.col,
        endRow: row,
        endCol: col,
      })
    } else {
      setSelectedCell({ row, col })
      setSelectionRange(null)
    }
  }, [selectedCell])

  // Copy selected cells
  const handleCopy = useCallback(() => {
    let text = ''

    if (selectionRange) {
      const r = normalizeRange(selectionRange)
      for (let row = r.startRow; row <= r.endRow; row++) {
        const rowCells: string[] = []
        for (let col = r.startCol; col <= r.endCol; col++) {
          rowCells.push(sheetData[row]?.[col] || '')
        }
        text += rowCells.join('\t') + '\n'
      }
    } else if (selectedCell) {
      text = sheetData[selectedCell.row]?.[selectedCell.col] || ''
    }

    if (text) {
      navigator.clipboard.writeText(text.trimEnd()).then(() => {
        toast.success('Copied to clipboard')
      }).catch(() => {
        toast.error('Failed to copy')
      })
    }
  }, [selectionRange, selectedCell, sheetData])

  // Keyboard handler
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey

      // Ctrl+F: toggle search
      if (ctrl && e.key === 'f') {
        e.preventDefault()
        e.stopPropagation()
        setShowSearch(prev => {
          if (!prev) {
            setTimeout(() => searchInputRef.current?.focus(), 50)
          }
          return !prev
        })
        return
      }

      // Ctrl+C: copy
      if (ctrl && e.key === 'c') {
        e.preventDefault()
        e.stopPropagation()
        handleCopy()
        return
      }

      // Escape: close search or clear selection
      if (e.key === 'Escape') {
        if (showSearch) {
          setShowSearch(false)
          setSearchQuery('')
          setSearchMatches([])
        } else {
          setSelectedCell(null)
          setSelectionRange(null)
        }
        return
      }

      // Search navigation
      if (showSearch && searchMatches.length > 0) {
        if (e.key === 'Enter') {
          e.preventDefault()
          setCurrentMatchIndex(prev =>
            e.shiftKey
              ? (prev - 1 + searchMatches.length) % searchMatches.length
              : (prev + 1) % searchMatches.length
          )
          return
        }
      }

      // Arrow key navigation
      if (selectedCell && !showSearch) {
        const { row, col } = selectedCell
        let newRow = row
        let newCol = col

        switch (e.key) {
          case 'ArrowUp': newRow = Math.max(0, row - 1); break
          case 'ArrowDown': newRow = Math.min(sheetData.length - 1, row + 1); break
          case 'ArrowLeft': newCol = Math.max(0, col - 1); break
          case 'ArrowRight': newCol = Math.min(maxCols - 1, col + 1); break
          case 'Tab':
            e.preventDefault()
            newCol = e.shiftKey ? Math.max(0, col - 1) : Math.min(maxCols - 1, col + 1)
            break
          default: return
        }

        if (newRow !== row || newCol !== col) {
          e.preventDefault()
          if (e.shiftKey && e.key.startsWith('Arrow')) {
            setSelectionRange(prev => ({
              startRow: prev ? prev.startRow : row,
              startCol: prev ? prev.startCol : col,
              endRow: newRow,
              endCol: newCol,
            }))
          } else {
            setSelectedCell({ row: newRow, col: newCol })
            setSelectionRange(null)
          }

          // Scroll into view
          const cellEl = containerRef.current?.querySelector(`[data-cell="${newRow}-${newCol}"]`)
          cellEl?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [selectedCell, selectionRange, showSearch, searchMatches, sheetData, maxCols, handleCopy])

  // Column resize handler
  const handleColumnResize = useCallback((colIndex: number, startX: number) => {
    const startWidth = colWidths[colIndex] || DEFAULT_COL_WIDTH

    function onMouseMove(e: MouseEvent) {
      const delta = e.clientX - startX
      setColWidths(prev => {
        const next = [...prev]
        next[colIndex] = Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, startWidth + delta))
        return next
      })
    }

    function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [colWidths])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center text-white p-8">
        <Loader2 size={32} className="animate-spin mb-3" />
        <p className="text-sm text-gray-400">Loading spreadsheet...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center text-white p-8">
        <AlertCircle size={48} className="text-amber-400 mb-4" />
        <p className="text-lg mb-2">Cannot preview spreadsheet</p>
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

  if (!workbook) return null

  return (
    <div className="w-full h-full flex flex-col" onClick={(e) => e.stopPropagation()}>
      {/* Search bar */}
      {showSearch && (
        <div className="flex items-center gap-2 px-3 py-2 bg-gray-800 border-b border-gray-700 flex-shrink-0">
          <Search size={14} className="text-gray-400" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Find in sheet..."
            className="flex-1 bg-gray-700 text-white text-sm px-2 py-1 rounded border border-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500 max-w-xs"
            autoFocus
          />
          {searchMatches.length > 0 && (
            <span className="text-xs text-gray-400 whitespace-nowrap">
              {currentMatchIndex + 1} of {searchMatches.length}
            </span>
          )}
          {searchQuery && searchMatches.length === 0 && (
            <span className="text-xs text-gray-500">No matches</span>
          )}
          <button
            onClick={() => setCurrentMatchIndex(prev => (prev - 1 + searchMatches.length) % searchMatches.length)}
            disabled={searchMatches.length === 0}
            className="p-1 text-gray-400 hover:text-white disabled:opacity-30 rounded"
            title="Previous (Shift+Enter)"
          >
            <ChevronUp size={14} />
          </button>
          <button
            onClick={() => setCurrentMatchIndex(prev => (prev + 1) % searchMatches.length)}
            disabled={searchMatches.length === 0}
            className="p-1 text-gray-400 hover:text-white disabled:opacity-30 rounded"
            title="Next (Enter)"
          >
            <ChevronDown size={14} />
          </button>
          <button
            onClick={() => {
              setShowSearch(false)
              setSearchQuery('')
              setSearchMatches([])
            }}
            className="p-1 text-gray-400 hover:text-white rounded"
            title="Close (Esc)"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Truncation warning */}
      {truncated && (
        <div className="px-3 py-1.5 bg-amber-900/50 text-amber-300 text-xs flex-shrink-0">
          Showing first {MAX_ROWS.toLocaleString()} of {totalRows.toLocaleString()} rows
        </div>
      )}

      {/* Selected cell info */}
      {selectedCell && (
        <div className="px-3 py-1 bg-gray-800 border-b border-gray-700 text-xs text-gray-400 flex items-center gap-3 flex-shrink-0">
          <span className="font-mono text-white">
            {getColumnLabel(selectedCell.col)}{selectedCell.row + 1}
          </span>
          <span className="text-gray-500">|</span>
          <span className="truncate max-w-md">
            {sheetData[selectedCell.row]?.[selectedCell.col] || '(empty)'}
          </span>
        </div>
      )}

      {/* Spreadsheet grid */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-white"
      >
        <table className="border-collapse" style={{ minWidth: '100%' }}>
          <thead className="sticky top-0 z-10">
            <tr>
              {/* Corner cell */}
              <th className="sticky left-0 z-20 bg-gray-200 border-b border-r border-gray-300 w-12 min-w-[48px]" />
              {/* Column headers */}
              {Array.from({ length: maxCols }, (_, colIdx) => (
                <th
                  key={colIdx}
                  className="relative bg-gray-100 border-b border-r border-gray-300 px-1 py-1.5 text-xs font-medium text-gray-600 text-center select-none"
                  style={{ width: colWidths[colIdx] || DEFAULT_COL_WIDTH, minWidth: MIN_COL_WIDTH }}
                >
                  {getColumnLabel(colIdx)}
                  {/* Resize handle */}
                  <div
                    className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-blue-400"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      handleColumnResize(colIdx, e.clientX)
                    }}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheetData.map((row, rowIdx) => (
              <tr key={rowIdx}>
                {/* Row number */}
                <td className="sticky left-0 z-[5] bg-gray-50 border-b border-r border-gray-200 text-xs text-gray-400 text-center font-mono py-0.5 select-none">
                  {rowIdx + 1}
                </td>
                {/* Data cells */}
                {Array.from({ length: maxCols }, (_, colIdx) => {
                  const value = row[colIdx] || ''
                  const isSelected = selectedCell?.row === rowIdx && selectedCell?.col === colIdx
                  const isInRange = isCellInRange(rowIdx, colIdx, selectionRange)
                  const isSearchMatch = searchMatches.some(m => m.row === rowIdx && m.col === colIdx)
                  const isCurrentMatch = searchMatches[currentMatchIndex]?.row === rowIdx &&
                    searchMatches[currentMatchIndex]?.col === colIdx

                  return (
                    <td
                      key={colIdx}
                      data-cell={`${rowIdx}-${colIdx}`}
                      onClick={(e) => handleCellClick(rowIdx, colIdx, e.shiftKey)}
                      className={`border-b border-r border-gray-100 px-2 py-0.5 text-sm text-gray-800 whitespace-nowrap cursor-cell truncate ${
                        isCurrentMatch
                          ? 'bg-orange-200'
                          : isSearchMatch
                            ? 'bg-yellow-100'
                            : isInRange
                              ? 'bg-blue-100'
                              : ''
                      } ${isSelected ? 'ring-2 ring-blue-500 ring-inset z-[1] relative' : ''}`}
                      style={{
                        maxWidth: colWidths[colIdx] || DEFAULT_COL_WIDTH,
                        minWidth: MIN_COL_WIDTH,
                      }}
                      title={value}
                    >
                      {value}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Sheet tabs */}
      {workbook.SheetNames.length > 1 && (
        <div className="flex items-center gap-0 bg-gray-800 border-t border-gray-700 flex-shrink-0 overflow-x-auto">
          {workbook.SheetNames.map((name) => (
            <button
              key={name}
              onClick={() => setActiveSheet(name)}
              className={`px-4 py-2 text-xs font-medium whitespace-nowrap border-r border-gray-700 transition-colors ${
                activeSheet === name
                  ? 'bg-white text-gray-900'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {/* Keyboard hints */}
      <div className="flex items-center gap-4 px-3 py-1 bg-gray-900 text-[10px] text-gray-500 flex-shrink-0">
        <span>Ctrl+F Find</span>
        <span>Ctrl+C Copy</span>
        <span>Arrow keys Navigate</span>
        <span>Shift+Click Range select</span>
      </div>
    </div>
  )
}
