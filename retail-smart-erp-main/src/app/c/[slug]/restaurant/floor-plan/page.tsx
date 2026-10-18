'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Edit3, Save, RotateCcw, ZoomIn, ZoomOut, Plus, Loader2 } from 'lucide-react'
import { useRealtimeData } from '@/hooks'
import { PageLoading } from '@/components/ui/loading-spinner'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { toast } from '@/components/ui/toast'

interface FloorTable {
  id: string
  name: string
  capacity: number
  status: string
  positionX: number | null
  positionY: number | null
  width: number | null
  height: number | null
  shape: string | null
  rotation: number | null
}

const STATUS_COLORS: Record<string, { fill: string; stroke: string; text: string }> = {
  available: { fill: '#dcfce7', stroke: '#22c55e', text: '#166534' },
  occupied: { fill: '#fecaca', stroke: '#ef4444', text: '#991b1b' },
  reserved: { fill: '#fef3c7', stroke: '#eab308', text: '#854d0e' },
  unavailable: { fill: '#f3f4f6', stroke: '#9ca3af', text: '#6b7280' },
}

const GRID_SIZE = 10
const DEFAULT_TABLE_WIDTH = 80
const DEFAULT_TABLE_HEIGHT = 60

export default function FloorPlanPage() {
  const params = useParams()
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const slug = params.slug as string

  const [tables, setTables] = useState<FloorTable[]>([])
  const [loading, setLoading] = useState(true)
  const [editMode, setEditMode] = useState(false)
  const [saving, setSaving] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  // Original positions for reset
  const [originalPositions, setOriginalPositions] = useState<Map<string, FloorTable>>(new Map())

  const fetchTables = useCallback(async () => {
    try {
      const res = await fetch('/api/restaurant-tables?all=true')
      if (res.ok) {
        const data = await res.json()
        setTables(data.filter((t: FloorTable) => t.positionX !== null || editMode))
        if (!editMode) {
          setTables(data)
        }
      }
    } catch (error) {
      console.error('Error fetching tables:', error)
    } finally {
      setLoading(false)
    }
  }, [editMode])

  useEffect(() => {
    fetchTables()
  }, [fetchTables])

  useRealtimeData(fetchTables, { entityType: ['table', 'restaurant-order'], enabled: !editMode, refreshOnMount: false })

  function enterEditMode() {
    setEditMode(true)
    const posMap = new Map<string, FloorTable>()
    tables.forEach(t => posMap.set(t.id, { ...t }))
    setOriginalPositions(posMap)
  }

  function cancelEdit() {
    // Restore original positions
    setTables(prev => prev.map(t => {
      const orig = originalPositions.get(t.id)
      return orig || t
    }))
    setEditMode(false)
    setSelectedId(null)
  }

  async function saveLayout() {
    setSaving(true)
    try {
      const layoutData = tables
        .filter(t => t.positionX !== null)
        .map(t => ({
          id: t.id,
          positionX: t.positionX || 0,
          positionY: t.positionY || 0,
          width: t.width || DEFAULT_TABLE_WIDTH,
          height: t.height || DEFAULT_TABLE_HEIGHT,
          shape: t.shape || 'rectangle',
          rotation: t.rotation || 0,
        }))

      const res = await fetch('/api/restaurant-tables/layout', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tables: layoutData }),
      })

      if (!res.ok) throw new Error('Failed to save layout')

      toast.success('Floor plan saved')
      setEditMode(false)
      setSelectedId(null)
    } catch {
      toast.error('Failed to save floor plan')
    } finally {
      setSaving(false)
    }
  }

  function snapToGrid(val: number): number {
    return Math.round(val / GRID_SIZE) * GRID_SIZE
  }

  function handleMouseDown(e: React.MouseEvent, tableId: string) {
    if (!editMode) return
    e.preventDefault()
    const svg = svgRef.current
    if (!svg) return

    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const svgP = pt.matrixTransform(svg.getScreenCTM()!.inverse())

    const table = tables.find(t => t.id === tableId)
    if (!table) return

    setDraggingId(tableId)
    setSelectedId(tableId)
    setDragOffset({
      x: svgP.x - (table.positionX || 0),
      y: svgP.y - (table.positionY || 0),
    })
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!draggingId || !editMode) return
    const svg = svgRef.current
    if (!svg) return

    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const svgP = pt.matrixTransform(svg.getScreenCTM()!.inverse())

    const newX = snapToGrid(svgP.x - dragOffset.x)
    const newY = snapToGrid(svgP.y - dragOffset.y)

    setTables(prev => prev.map(t =>
      t.id === draggingId ? { ...t, positionX: Math.max(0, newX), positionY: Math.max(0, newY) } : t
    ))
  }

  function handleMouseUp() {
    setDraggingId(null)
  }

  function placeUnpositionedTable(tableId: string) {
    setTables(prev => prev.map(t =>
      t.id === tableId ? {
        ...t,
        positionX: snapToGrid(50 + Math.random() * 400),
        positionY: snapToGrid(50 + Math.random() * 300),
        width: t.width || DEFAULT_TABLE_WIDTH,
        height: t.height || DEFAULT_TABLE_HEIGHT,
        shape: t.shape || 'rectangle',
        rotation: t.rotation || 0,
      } : t
    ))
  }

  function rotateTable(tableId: string) {
    setTables(prev => prev.map(t =>
      t.id === tableId ? { ...t, rotation: ((t.rotation || 0) + 45) % 360 } : t
    ))
  }

  function changeShape(tableId: string, shape: string) {
    setTables(prev => prev.map(t =>
      t.id === tableId ? { ...t, shape } : t
    ))
  }

  if (loading) {
    return <PageLoading text="Loading floor plan..." />
  }

  const positionedTables = tables.filter(t => t.positionX !== null && t.positionY !== null)
  const unpositionedTables = tables.filter(t => t.positionX === null || t.positionY === null)
  const selectedTable = selectedId ? tables.find(t => t.id === selectedId) : null

  return (
    <ListPageLayout
      module="Restaurant"
      moduleHref="/restaurant"
      title="Floor Plan"
      onRefresh={fetchTables}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4 bg-white dark:bg-gray-800 border rounded p-3">
        <div className="flex items-center gap-2">
          {!editMode ? (
            <button
              onClick={enterEditMode}
              className="flex items-center gap-2 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              <Edit3 size={14} /> Edit Layout
            </button>
          ) : (
            <>
              <button
                onClick={saveLayout}
                disabled={saving}
                className="flex items-center gap-2 px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save
              </button>
              <button
                onClick={cancelEdit}
                className="flex items-center gap-2 px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300"
              >
                Cancel
              </button>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {editMode && selectedTable && (
            <div className="flex items-center gap-1 mr-4">
              <span className="text-xs text-gray-500 mr-2">{selectedTable.name}</span>
              <button
                onClick={() => rotateTable(selectedId!)}
                className="p-1.5 text-gray-600 hover:bg-gray-100 rounded"
                title="Rotate 45°"
              >
                <RotateCcw size={16} />
              </button>
              {['rectangle', 'round'].map(shape => (
                <button
                  key={shape}
                  onClick={() => changeShape(selectedId!, shape)}
                  className={`px-2 py-1 text-xs rounded ${selectedTable.shape === shape ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:bg-gray-100'}`}
                >
                  {shape === 'round' ? 'Round' : 'Rect'}
                </button>
              ))}
            </div>
          )}
          <button onClick={() => setZoom(z => Math.min(z + 0.1, 2))} className="p-1.5 text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
            <ZoomIn size={16} />
          </button>
          <span className="text-xs text-gray-500 w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.max(z - 0.1, 0.5))} className="p-1.5 text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
            <ZoomOut size={16} />
          </button>
        </div>

        <div className="flex items-center gap-3 text-xs">
          {Object.entries(STATUS_COLORS).map(([status, colors]) => (
            <div key={status} className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-sm border" style={{ backgroundColor: colors.fill, borderColor: colors.stroke }} />
              <span className="text-gray-500 capitalize">{status}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-4">
        {/* SVG Canvas */}
        <div className="flex-1 bg-white dark:bg-gray-800 border rounded overflow-hidden" style={{ minHeight: '500px' }}>
          <svg
            ref={svgRef}
            width="100%"
            height="500"
            viewBox={`0 0 ${800 / zoom} ${500 / zoom}`}
            className={`${editMode ? 'cursor-crosshair' : ''}`}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            {/* Grid */}
            <defs>
              <pattern id="grid" width={GRID_SIZE} height={GRID_SIZE} patternUnits="userSpaceOnUse">
                <path d={`M ${GRID_SIZE} 0 L 0 0 0 ${GRID_SIZE}`} fill="none" stroke="#f0f0f0" strokeWidth="0.5" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />

            {/* Tables */}
            {positionedTables.map(table => {
              const colors = STATUS_COLORS[table.status] || STATUS_COLORS.unavailable
              const w = table.width || DEFAULT_TABLE_WIDTH
              const h = table.height || DEFAULT_TABLE_HEIGHT
              const x = table.positionX || 0
              const y = table.positionY || 0
              const r = table.rotation || 0
              const isSelected = selectedId === table.id
              const isRound = table.shape === 'round'

              return (
                <g
                  key={table.id}
                  transform={`translate(${x + w / 2}, ${y + h / 2}) rotate(${r}) translate(${-w / 2}, ${-h / 2})`}
                  onMouseDown={(e) => handleMouseDown(e, table.id)}
                  onClick={() => !editMode && setSelectedId(selectedId === table.id ? null : table.id)}
                  className={editMode ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}
                >
                  {isRound ? (
                    <ellipse
                      cx={w / 2}
                      cy={h / 2}
                      rx={w / 2 - 2}
                      ry={h / 2 - 2}
                      fill={colors.fill}
                      stroke={isSelected ? '#3b82f6' : colors.stroke}
                      strokeWidth={isSelected ? 3 : 2}
                    />
                  ) : (
                    <rect
                      x={2}
                      y={2}
                      width={w - 4}
                      height={h - 4}
                      rx={6}
                      fill={colors.fill}
                      stroke={isSelected ? '#3b82f6' : colors.stroke}
                      strokeWidth={isSelected ? 3 : 2}
                    />
                  )}
                  <text
                    x={w / 2}
                    y={h / 2 - 4}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill={colors.text}
                    fontSize="12"
                    fontWeight="600"
                  >
                    {table.name}
                  </text>
                  <text
                    x={w / 2}
                    y={h / 2 + 12}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill={colors.text}
                    fontSize="9"
                    opacity={0.7}
                  >
                    {table.capacity} seats
                  </text>
                </g>
              )
            })}
          </svg>
        </div>

        {/* Edit mode sidebar: unpositioned tables */}
        {editMode && unpositionedTables.length > 0 && (
          <div className="w-48 bg-white dark:bg-gray-800 border rounded p-3">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Unplaced Tables</h4>
            <div className="space-y-2">
              {unpositionedTables.map(table => (
                <button
                  key={table.id}
                  onClick={() => placeUnpositionedTable(table.id)}
                  className="w-full flex items-center gap-2 p-2 text-sm text-left bg-gray-50 dark:bg-gray-700 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                >
                  <Plus size={14} className="text-blue-500" />
                  <div>
                    <div className="font-medium text-gray-900 dark:text-white">{table.name}</div>
                    <div className="text-xs text-gray-400">{table.capacity} seats</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Live mode: table info */}
        {!editMode && selectedTable && (
          <div className="w-56 bg-white dark:bg-gray-800 border rounded p-4">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">{selectedTable.name}</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Status</span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  selectedTable.status === 'available' ? 'bg-green-100 text-green-800' :
                  selectedTable.status === 'occupied' ? 'bg-red-100 text-red-800' :
                  selectedTable.status === 'reserved' ? 'bg-yellow-100 text-yellow-800' :
                  'bg-gray-100 text-gray-800'
                }`}>
                  {selectedTable.status}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Capacity</span>
                <span className="text-gray-900 dark:text-white">{selectedTable.capacity} seats</span>
              </div>
              {selectedTable.shape && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Shape</span>
                  <span className="text-gray-900 dark:text-white capitalize">{selectedTable.shape}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </ListPageLayout>
  )
}
