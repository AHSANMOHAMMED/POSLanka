'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { X, Plus, Check, RotateCcw, GripVertical, Maximize2 } from 'lucide-react'
import type { WorkspaceConfig, WorkspaceBlock, WorkspaceBlockType, MetricValues } from '@/lib/workspace/types'
import { getIcon } from './icon-map'
import { getMetricKeys, getChartKeys, getQuickListKeys } from './add-block-options'

// Block renderer - imported lazily to avoid circular deps
import { HeadingBlock } from './blocks/HeadingBlock'
import { ParagraphBlock } from './blocks/ParagraphBlock'
import { NumberCardBlock } from './blocks/NumberCardBlock'
import { ShortcutBlock } from './blocks/ShortcutBlock'
import { ChartBlock } from './blocks/ChartBlock'
import { QuickListBlock } from './blocks/QuickListBlock'
import { CardBlock } from './blocks/CardBlock'
import { SpacerBlock } from './blocks/SpacerBlock'

// --- Types ---

interface WorkspaceCustomizerProps {
  config: WorkspaceConfig
  onSave: (blocks: WorkspaceBlock[]) => void
  onCancel: () => void
  onReset: () => void
  metrics?: MetricValues
  metricsLoading?: boolean
  basePath?: string
  colorScheme?: string
  renderSettingsContent?: (section: string) => React.ReactNode
}

interface DragState {
  draggedIdx: number | null
  dropTargetIdx: number | null
  dropSide: 'before' | 'after'
}

interface ResizeState {
  index: number
  startX: number
  startColSpan: number
  colUnit: number
  blockLeft: number
}

// --- Helpers ---

function getColSpanClass(colSpan?: number): string {
  if (!colSpan || colSpan === 12) return ''
  const classes: Record<number, string> = {
    2: 'sm:col-span-2',
    3: 'sm:col-span-3',
    4: 'sm:col-span-4',
    5: 'sm:col-span-5',
    6: 'sm:col-span-6',
    7: 'sm:col-span-7',
    8: 'sm:col-span-8',
    9: 'sm:col-span-9',
    10: 'sm:col-span-10',
    11: 'sm:col-span-11',
  }
  return classes[colSpan] || ''
}

function getBlockLabel(block: WorkspaceBlock): string {
  switch (block.type) {
    case 'heading':
      return block.data.text
    case 'paragraph':
      return block.data.text.slice(0, 40) + (block.data.text.length > 40 ? '...' : '')
    case 'number_card':
      return block.data.label
    case 'shortcut':
      return `${block.data.shortcuts.length} shortcuts`
    case 'chart':
      return block.data.title
    case 'quick_list':
      return block.data.title
    case 'card':
      return block.data.title
    case 'spacer':
      return `Spacer (${block.data.height || 16}px)`
    case 'settings_content':
      return block.data.section.replace(/_/g, ' ')
    default:
      return ''
  }
}

// --- Main Component ---

export function WorkspaceCustomizer({
  config,
  onSave,
  onCancel,
  onReset,
  metrics = {},
  metricsLoading = false,
  basePath = '',
  colorScheme = 'blue',
  renderSettingsContent,
}: WorkspaceCustomizerProps) {
  const [blocks, setBlocks] = useState<WorkspaceBlock[]>([...config.blocks])
  const [showAddPanel, setShowAddPanel] = useState(false)
  const [dragState, setDragState] = useState<DragState>({
    draggedIdx: null,
    dropTargetIdx: null,
    dropSide: 'before',
  })
  const [resizeState, setResizeState] = useState<ResizeState | null>(null)
  const [resizingColSpan, setResizingColSpan] = useState<number | null>(null)

  const gridRef = useRef<HTMLDivElement>(null)

  const Icon = getIcon(config.icon)

  // --- Drag and Drop ---

  const handleDragStart = useCallback((e: React.DragEvent, idx: number) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(idx))
    // Small timeout so the browser captures the drag image before opacity change
    setTimeout(() => {
      setDragState((prev) => ({ ...prev, draggedIdx: idx }))
    }, 0)
  }, [])

  const handleDragOver = useCallback(
    (e: React.DragEvent, idx: number) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'

      if (dragState.draggedIdx === null || dragState.draggedIdx === idx) return

      // Determine before/after based on cursor position relative to element center
      const rect = e.currentTarget.getBoundingClientRect()
      const midY = rect.top + rect.height / 2
      const side: 'before' | 'after' = e.clientY < midY ? 'before' : 'after'

      setDragState((prev) => ({
        ...prev,
        dropTargetIdx: idx,
        dropSide: side,
      }))
    },
    [dragState.draggedIdx]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const { draggedIdx, dropTargetIdx, dropSide } = dragState
      if (draggedIdx === null || dropTargetIdx === null) return
      if (draggedIdx === dropTargetIdx) return

      setBlocks((prev) => {
        const newBlocks = [...prev]
        const [dragged] = newBlocks.splice(draggedIdx, 1)
        // Calculate insert position after removal
        let insertIdx = dropTargetIdx
        if (draggedIdx < dropTargetIdx) {
          insertIdx -= 1 // Adjust for the removed item
        }
        if (dropSide === 'after') {
          insertIdx += 1
        }
        newBlocks.splice(insertIdx, 0, dragged)
        return newBlocks
      })

      setDragState({ draggedIdx: null, dropTargetIdx: null, dropSide: 'before' })
    },
    [dragState]
  )

  const handleDragEnd = useCallback(() => {
    setDragState({ draggedIdx: null, dropTargetIdx: null, dropSide: 'before' })
  }, [])

  // --- Resize ---

  const handleResizeStart = useCallback(
    (e: React.PointerEvent, idx: number) => {
      e.preventDefault()
      e.stopPropagation()

      const gridEl = gridRef.current
      if (!gridEl) return

      const gridWidth = gridEl.getBoundingClientRect().width
      const colUnit = gridWidth / 12
      const blockEl = (e.currentTarget as HTMLElement).parentElement
      if (!blockEl) return

      const blockLeft = blockEl.getBoundingClientRect().left
      const currentColSpan = blocks[idx].colSpan || 12

      setResizeState({
        index: idx,
        startX: e.clientX,
        startColSpan: currentColSpan,
        colUnit,
        blockLeft,
      })
      setResizingColSpan(currentColSpan)

      // Capture pointer for smooth tracking
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    },
    [blocks]
  )

  const handleResizeMove = useCallback(
    (e: React.PointerEvent) => {
      if (!resizeState) return

      const { blockLeft, colUnit } = resizeState
      const mouseX = e.clientX
      const widthFromLeft = mouseX - blockLeft
      let newColSpan = Math.round(widthFromLeft / colUnit)
      newColSpan = Math.max(2, Math.min(12, newColSpan))

      setResizingColSpan(newColSpan)
      setBlocks((prev) => {
        const newBlocks = [...prev]
        newBlocks[resizeState.index] = { ...newBlocks[resizeState.index], colSpan: newColSpan }
        return newBlocks
      })
    },
    [resizeState]
  )

  const handleResizeEnd = useCallback(() => {
    setResizeState(null)
    setResizingColSpan(null)
  }, [])

  // Apply cursor style to body during resize
  useEffect(() => {
    if (resizeState) {
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      return () => {
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
  }, [resizeState])

  // --- Block Operations ---

  const removeBlock = useCallback((index: number) => {
    setBlocks((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const addBlock = useCallback((block: WorkspaceBlock) => {
    setBlocks((prev) => [...prev, block])
    setShowAddPanel(false)
  }, [])

  // --- Block Content Renderer ---

  const renderBlockContent = useCallback(
    (block: WorkspaceBlock) => {
      switch (block.type) {
        case 'heading':
          return <HeadingBlock block={block} />
        case 'paragraph':
          return <ParagraphBlock block={block} />
        case 'number_card':
          return <NumberCardBlock block={block} metrics={metrics} loading={metricsLoading} />
        case 'shortcut':
          return <ShortcutBlock block={block} metrics={metrics} colorScheme={colorScheme} />
        case 'chart':
          return <ChartBlock block={block} />
        case 'quick_list':
          return <QuickListBlock block={block} basePath={basePath} />
        case 'card':
          return <CardBlock block={block} />
        case 'spacer':
          return <SpacerBlock block={block} />
        case 'settings_content':
          if (renderSettingsContent) {
            return <>{renderSettingsContent(block.data.section)}</>
          }
          return (
            <div className="p-4 bg-gray-50 rounded border border-dashed border-gray-300 text-sm text-gray-500">
              Settings: {block.data.section.replace(/_/g, ' ')}
            </div>
          )
        default:
          return null
      }
    },
    [metrics, metricsLoading, colorScheme, basePath, renderSettingsContent]
  )

  // --- Render ---

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-blue-50 dark:bg-blue-900/20 rounded-2xl border border-blue-200 dark:border-blue-800">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line react-hooks/static-components */}
          <Icon className="w-5 h-5 text-blue-600" />
          <div>
            <h2 className="font-semibold text-blue-900 dark:text-blue-100">
              Customize {config.title}
            </h2>
            <p className="text-sm text-blue-600 dark:text-blue-300">
              Drag to reorder, resize edges, or remove blocks.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onReset}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded hover:bg-gray-50 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset
          </button>
          <button
            onClick={onCancel}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded hover:bg-gray-50 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            Cancel
          </button>
          <button
            onClick={() => onSave(blocks)}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700 transition-colors"
          >
            <Check className="w-3.5 h-3.5" />
            Save
          </button>
        </div>
      </div>

      {/* Visual Grid Editor */}
      <div ref={gridRef} className="grid grid-cols-12 gap-4">
        {blocks.map((block, index) => {
          const isDragged = dragState.draggedIdx === index
          const isDropTarget = dragState.dropTargetIdx === index
          const isResizing = resizeState?.index === index

          return (
            <div
              key={block.id}
              className={`col-span-12 ${getColSpanClass(block.colSpan)} relative group transition-opacity ${
                isDragged ? 'opacity-40' : ''
              }`}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={handleDrop}
            >
              {/* Drop indicator - before */}
              {isDropTarget && dragState.dropSide === 'before' && (
                <div className="absolute -top-2 left-0 right-0 h-1 bg-blue-500 rounded-full z-20" />
              )}

              {/* Editable block wrapper */}
              <div
                className={`relative rounded-md border-2 transition-colors ${
                  isResizing
                    ? 'border-blue-400 ring-2 ring-blue-200'
                    : 'border-transparent group-hover:border-blue-300'
                }`}
              >
                {/* Live block content (non-interactive) */}
                <div className="pointer-events-none select-none">
                  {renderBlockContent(block)}
                </div>

                {/* Hover overlay controls */}
                <div className="absolute inset-0 rounded-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  {/* Top bar with drag handle + label + delete */}
                  <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-1 py-0.5 pointer-events-auto">
                    {/* Drag handle */}
                    <div
                      draggable
                      onDragStart={(e) => handleDragStart(e, index)}
                      onDragEnd={handleDragEnd}
                      className="flex items-center gap-1 px-1.5 py-0.5 bg-white/90 dark:bg-gray-800/90 rounded shadow-sm border border-gray-200 dark:border-gray-600 cursor-grab active:cursor-grabbing"
                      title="Drag to reorder"
                    >
                      <GripVertical className="w-3.5 h-3.5 text-gray-400" />
                      <span className="text-[10px] font-medium text-gray-500 max-w-[120px] truncate">
                        {getBlockLabel(block)}
                      </span>
                    </div>

                    {/* Delete button */}
                    <button
                      onClick={() => removeBlock(index)}
                      className="p-1 bg-white/90 dark:bg-gray-800/90 rounded shadow-sm border border-gray-200 dark:border-gray-600 text-gray-400 hover:text-red-500 hover:border-red-300 transition-colors"
                      title="Remove block"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Resize handle - right edge */}
                <div
                  className="absolute top-0 -right-1 w-3 h-full cursor-col-resize opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center z-10"
                  onPointerDown={(e) => handleResizeStart(e, index)}
                  onPointerMove={handleResizeMove}
                  onPointerUp={handleResizeEnd}
                  title="Drag to resize"
                >
                  <div className="w-1 h-8 bg-blue-400 rounded-full" />
                </div>

                {/* ColSpan badge - shown during resize or hover */}
                <div
                  className={`absolute -bottom-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 text-[10px] font-bold rounded shadow-sm z-20 transition-opacity ${
                    isResizing
                      ? 'opacity-100 bg-blue-500 text-white'
                      : 'opacity-0 group-hover:opacity-100 bg-white dark:bg-gray-800 text-gray-500 border border-gray-200 dark:border-gray-600'
                  }`}
                >
                  <span className="flex items-center gap-0.5">
                    <Maximize2 className="w-2.5 h-2.5" />
                    {isResizing ? resizingColSpan : (block.colSpan || 12)}/12
                  </span>
                </div>
              </div>

              {/* Drop indicator - after */}
              {isDropTarget && dragState.dropSide === 'after' && (
                <div className="absolute -bottom-2 left-0 right-0 h-1 bg-blue-500 rounded-full z-20" />
              )}
            </div>
          )
        })}
      </div>

      {/* Add Block Button / Panel */}
      {!showAddPanel ? (
        <button
          onClick={() => setShowAddPanel(true)}
          className="w-full flex items-center justify-center gap-2 p-4 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-md text-gray-400 hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50/50 transition-colors"
        >
          <Plus className="w-5 h-5" />
          <span className="text-sm font-medium">Add Block</span>
        </button>
      ) : (
        <AddBlockPanel onAdd={addBlock} onClose={() => setShowAddPanel(false)} />
      )}
    </div>
  )
}

// ============================================
// ADD BLOCK PANEL (kept from original)
// ============================================

interface AddBlockPanelProps {
  onAdd: (block: WorkspaceBlock) => void
  onClose: () => void
}

function AddBlockPanel({ onAdd, onClose }: AddBlockPanelProps) {
  const [selectedType, setSelectedType] = useState<WorkspaceBlockType | null>(null)

  // Form state for different block types
  const [label, setLabel] = useState('')
  const [metricKey, setMetricKey] = useState('')
  const [chartKey, setChartKey] = useState('')
  const [listKey, setListKey] = useState('')
  const [text, setText] = useState('')
  const [color, setColor] = useState('blue')
  const [icon, setIcon] = useState('Package')
  const [href, setHref] = useState('')
  const [chartType, setChartType] = useState<'bar' | 'line' | 'pie' | 'doughnut'>('bar')
  const [colSpan, setColSpan] = useState(12)

  const blockTypes: Array<{ type: WorkspaceBlockType; label: string; description: string }> = [
    { type: 'number_card', label: 'Number Card', description: 'Displays a metric value with icon' },
    { type: 'chart', label: 'Chart', description: 'Bar, line, pie, or doughnut chart' },
    { type: 'quick_list', label: 'Quick List', description: 'Recent records table' },
    { type: 'shortcut', label: 'Shortcuts', description: 'Grid of navigation shortcuts' },
    { type: 'card', label: 'Link Group', description: 'List of navigation links' },
    { type: 'heading', label: 'Heading', description: 'Section heading text' },
    { type: 'paragraph', label: 'Paragraph', description: 'Description text' },
    { type: 'spacer', label: 'Spacer', description: 'Empty space between blocks' },
  ]

  const handleAdd = () => {
    const id = `block_${Date.now()}`
    let block: WorkspaceBlock | null = null

    switch (selectedType) {
      case 'number_card':
        if (!metricKey || !label) return
        block = { id, type: 'number_card', colSpan, data: { label, metricKey, color, href: href || '/', icon } }
        break
      case 'chart':
        if (!chartKey || !label) return
        block = { id, type: 'chart', colSpan, data: { title: label, chartKey, chartType, color } }
        break
      case 'quick_list':
        if (!listKey || !label) return
        block = { id, type: 'quick_list', colSpan, data: { title: label, listKey, limit: 5, href: href || '/' } }
        break
      case 'heading':
        if (!text) return
        block = { id, type: 'heading', colSpan, data: { text, level: 3 } }
        break
      case 'paragraph':
        if (!text) return
        block = { id, type: 'paragraph', colSpan, data: { text } }
        break
      case 'spacer':
        block = { id, type: 'spacer', colSpan: 12, data: { height: 16 } }
        break
      case 'card':
        if (!label) return
        block = { id, type: 'card', colSpan, data: { title: label, links: [] } }
        break
      case 'shortcut':
        block = { id, type: 'shortcut', colSpan: 12, data: { shortcuts: [] } }
        break
    }

    if (block) onAdd(block)
  }

  const metricOptions = getMetricKeys()
  const chartOptions = getChartKeys()
  const listOptions = getQuickListKeys()

  const colorOptions = ['blue', 'green', 'red', 'purple', 'amber', 'violet', 'emerald', 'slate']
  const iconOptions = ['Package', 'ShoppingCart', 'Users', 'Wrench', 'Calendar', 'FileText', 'Receipt', 'Truck', 'Warehouse', 'AlertTriangle', 'Clock', 'Car', 'DollarSign', 'TrendingUp', 'Star']

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Add Block</h3>
        <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Block type selection */}
      {!selectedType ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {blockTypes.map((bt) => (
            <button
              key={bt.type}
              onClick={() => setSelectedType(bt.type)}
              className="p-3 border border-gray-200 rounded text-left hover:border-blue-300 hover:bg-blue-50/50 transition-colors"
            >
              <p className="text-sm font-medium">{bt.label}</p>
              <p className="text-xs text-gray-400 mt-0.5">{bt.description}</p>
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          <button
            onClick={() => setSelectedType(null)}
            className="text-xs text-blue-600 hover:text-blue-700"
          >
            &larr; Back to block types
          </button>

          {/* Number Card config */}
          {selectedType === 'number_card' && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Metric</label>
                <select value={metricKey} onChange={(e) => setMetricKey(e.target.value)} className="w-full px-3 py-2 border rounded text-sm">
                  <option value="">Select metric...</option>
                  {metricOptions.map((k) => <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Label</label>
                <input value={label} onChange={(e) => setLabel(e.target.value)} className="w-full px-3 py-2 border rounded text-sm" placeholder="Card label" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Color</label>
                  <select value={color} onChange={(e) => setColor(e.target.value)} className="w-full px-2 py-2 border rounded text-sm">
                    {colorOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Icon</label>
                  <select value={icon} onChange={(e) => setIcon(e.target.value)} className="w-full px-2 py-2 border rounded text-sm">
                    {iconOptions.map((i) => <option key={i} value={i}>{i}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Width</label>
                  <select value={colSpan} onChange={(e) => setColSpan(Number(e.target.value))} className="w-full px-2 py-2 border rounded text-sm">
                    <option value={3}>3 cols</option>
                    <option value={4}>4 cols</option>
                    <option value={6}>6 cols</option>
                    <option value={12}>Full</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Link (href)</label>
                <input value={href} onChange={(e) => setHref(e.target.value)} className="w-full px-3 py-2 border rounded text-sm" placeholder="/items" />
              </div>
            </>
          )}

          {/* Chart config */}
          {selectedType === 'chart' && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Chart Data</label>
                <select value={chartKey} onChange={(e) => setChartKey(e.target.value)} className="w-full px-3 py-2 border rounded text-sm">
                  <option value="">Select chart...</option>
                  {chartOptions.map((k) => <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Title</label>
                <input value={label} onChange={(e) => setLabel(e.target.value)} className="w-full px-3 py-2 border rounded text-sm" placeholder="Chart title" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
                  <select value={chartType} onChange={(e) => setChartType(e.target.value as typeof chartType)} className="w-full px-2 py-2 border rounded text-sm">
                    <option value="bar">Bar</option>
                    <option value="line">Line</option>
                    <option value="pie">Pie</option>
                    <option value="doughnut">Doughnut</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Color</label>
                  <select value={color} onChange={(e) => setColor(e.target.value)} className="w-full px-2 py-2 border rounded text-sm">
                    {colorOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Width</label>
                  <select value={colSpan} onChange={(e) => setColSpan(Number(e.target.value))} className="w-full px-2 py-2 border rounded text-sm">
                    <option value={4}>4 cols</option>
                    <option value={6}>6 cols</option>
                    <option value={8}>8 cols</option>
                    <option value={12}>Full</option>
                  </select>
                </div>
              </div>
            </>
          )}

          {/* Quick List config */}
          {selectedType === 'quick_list' && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">List Data</label>
                <select value={listKey} onChange={(e) => setListKey(e.target.value)} className="w-full px-3 py-2 border rounded text-sm">
                  <option value="">Select list...</option>
                  {listOptions.map((k) => <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Title</label>
                <input value={label} onChange={(e) => setLabel(e.target.value)} className="w-full px-3 py-2 border rounded text-sm" placeholder="List title" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">View All Link</label>
                <input value={href} onChange={(e) => setHref(e.target.value)} className="w-full px-3 py-2 border rounded text-sm" placeholder="/sales" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Width</label>
                <select value={colSpan} onChange={(e) => setColSpan(Number(e.target.value))} className="w-full px-2 py-2 border rounded text-sm">
                  <option value={6}>6 cols</option>
                  <option value={12}>Full</option>
                </select>
              </div>
            </>
          )}

          {/* Heading / Paragraph config */}
          {(selectedType === 'heading' || selectedType === 'paragraph') && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Text</label>
              <input value={text} onChange={(e) => setText(e.target.value)} className="w-full px-3 py-2 border rounded text-sm" placeholder="Enter text..." />
            </div>
          )}

          {/* Spacer - no config needed */}
          {selectedType === 'spacer' && (
            <p className="text-sm text-gray-500">Adds a 16px spacer between blocks.</p>
          )}

          {/* Shortcuts and Cards start empty, user can edit them later */}
          {(selectedType === 'shortcut' || selectedType === 'card') && (
            <p className="text-sm text-gray-500">
              {selectedType === 'shortcut' ? 'Creates an empty shortcuts block. Edit shortcuts after saving.' : 'Creates an empty link group. Add links after saving.'}
            </p>
          )}

          {selectedType === 'card' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Title</label>
              <input value={label} onChange={(e) => setLabel(e.target.value)} className="w-full px-3 py-2 border rounded text-sm" placeholder="Group title" />
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setSelectedType(null)}
              className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded hover:bg-gray-50"
            >
              Back
            </button>
            <button
              onClick={handleAdd}
              className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700"
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
