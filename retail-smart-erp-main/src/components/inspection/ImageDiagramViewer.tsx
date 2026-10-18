'use client'

import { useState, useRef, useEffect } from 'react'
import { ZoomIn, ZoomOut, RotateCcw, Move } from 'lucide-react'

interface DamageMark {
  id: string
  diagramViewId: string | null
  positionX: string
  positionY: string
  damageType: string
  severity: string
  isPreExisting: boolean
  description: string | null
}

interface Props {
  imageUrl: string
  imageWidth?: number | null
  imageHeight?: number | null
  damageMarks: DamageMark[]
  onAddMark?: (position: { x: number; y: number }) => void
  onSelectMark?: (mark: DamageMark) => void
  selectedMarkId?: string
  readonly?: boolean
}

const damageTypeIcons: Record<string, { icon: string; color: string }> = {
  scratch: { icon: '/', color: '#f97316' },
  dent: { icon: 'O', color: '#3b82f6' },
  crack: { icon: '!', color: '#ef4444' },
  rust: { icon: '~', color: '#a16207' },
  paint: { icon: '#', color: '#9333ea' },
  broken: { icon: 'X', color: '#dc2626' },
  missing: { icon: '?', color: '#6b7280' },
  other: { icon: '*', color: '#71717a' },
}

const severityRings: Record<string, string> = {
  minor: '2',
  moderate: '3',
  severe: '4',
}

export function ImageDiagramViewer({
  imageUrl,
  imageWidth,
  damageMarks,
  onAddMark,
  onSelectMark,
  selectedMarkId,
  readonly = false,
}: Props) {
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [isPanMode, setIsPanMode] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLDivElement>(null)

  // Prevent accidental mark placement during drag
  const [dragMoved, setDragMoved] = useState(false)

  const handleZoom = (delta: number) => {
    setScale(prev => Math.max(0.5, Math.min(3, prev + delta)))
  }

  const handleReset = () => {
    setScale(1)
    setPosition({ x: 0, y: 0 })
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return // Only left click

    // Only start drag if in pan mode or ctrl/cmd key is held
    if (isPanMode || e.ctrlKey || e.metaKey) {
      setIsDragging(true)
      setDragMoved(false)
      setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y })
    }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return
    setDragMoved(true)
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    })
  }

  const handleMouseUp = () => {
    setIsDragging(false)
    // Reset dragMoved after a short delay to allow click handler to check it first
    setTimeout(() => setDragMoved(false), 10)
  }

  // Reset dragMoved when exiting pan mode
  const togglePanMode = () => {
    setIsPanMode(!isPanMode)
    setDragMoved(false)
  }

  // Touch support
  const [touchStart, setTouchStart] = useState<{ x: number; y: number; distance?: number } | null>(null)

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0]
      setTouchStart({ x: touch.clientX, y: touch.clientY })
    } else if (e.touches.length === 2) {
      // Pinch-to-zoom
      const distance = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      )
      setTouchStart({ x: 0, y: 0, distance })
    }
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStart) return

    if (e.touches.length === 2 && touchStart.distance) {
      // Pinch-to-zoom
      const newDistance = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      )
      const scaleDiff = (newDistance - touchStart.distance) / 200
      setScale(prev => Math.max(0.5, Math.min(3, prev + scaleDiff)))
      setTouchStart({ ...touchStart, distance: newDistance })
    }
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    // If it was a tap (not a drag), handle it as a click
    if (touchStart && e.changedTouches.length === 1) {
      const touch = e.changedTouches[0]
      const moved = Math.abs(touch.clientX - touchStart.x) > 10 ||
                   Math.abs(touch.clientY - touchStart.y) > 10

      if (!moved && !readonly && onAddMark) {
        // Calculate position
        const imageElement = imageRef.current?.querySelector('img')
        if (imageElement) {
          const rect = imageElement.getBoundingClientRect()
          const x = ((touch.clientX - rect.left) / rect.width) * 100
          const y = ((touch.clientY - rect.top) / rect.height) * 100

          if (x >= 0 && x <= 100 && y >= 0 && y <= 100) {
            onAddMark({ x, y })
          }
        }
      }
    }
    setTouchStart(null)
  }

  const handleClick = (e: React.MouseEvent) => {
    // Don't add mark if we were dragging, in pan mode, or if ctrl is held
    if (readonly || !onAddMark || dragMoved || isPanMode || e.ctrlKey || e.metaKey) return

    const imageElement = imageRef.current?.querySelector('img')
    if (!imageElement) return

    const rect = imageElement.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100

    // Check if click is within bounds
    if (x >= 0 && x <= 100 && y >= 0 && y <= 100) {
      onAddMark({ x, y })
    }
  }

  // Handle wheel zoom
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const delta = e.deltaY > 0 ? -0.1 : 0.1
        setScale(prev => Math.max(0.5, Math.min(3, prev + delta)))
      }
    }

    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => container.removeEventListener('wheel', handleWheel)
  }, [])

  return (
    <div className="relative bg-gray-50 rounded border overflow-hidden">
      {/* Controls */}
      <div className="absolute top-2 right-2 z-10 flex gap-1 bg-white rounded shadow p-1">
        <button
          onClick={(e) => {
            e.stopPropagation()
            togglePanMode()
          }}
          className={`p-2 rounded ${isPanMode ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100'}`}
          title={isPanMode ? 'Exit pan mode to add marks' : 'Pan mode (or hold Ctrl to pan)'}
        >
          <Move size={18} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            handleZoom(0.2)
          }}
          className="p-2 hover:bg-gray-100 rounded"
          title="Zoom in"
        >
          <ZoomIn size={18} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            handleZoom(-0.2)
          }}
          className="p-2 hover:bg-gray-100 rounded"
          title="Zoom out"
        >
          <ZoomOut size={18} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            handleReset()
          }}
          className="p-2 hover:bg-gray-100 rounded"
          title="Reset view"
        >
          <RotateCcw size={18} />
        </button>
      </div>

      {/* Image container */}
      <div
        ref={containerRef}
        className={`relative h-[400px] overflow-hidden ${
          isPanMode ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'
        }`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div
          ref={imageRef}
          className="absolute inset-0 flex items-center justify-center"
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            transformOrigin: 'center center',
          }}
          onClick={handleClick}
        >
          {/* Image */}
          <div className="relative" style={{ maxWidth: '100%', maxHeight: '100%' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt="Vehicle diagram"
              className="max-w-full max-h-[380px] object-contain select-none"
              draggable={false}
              style={{
                width: imageWidth ? `${Math.min(imageWidth, 500)}px` : 'auto',
              }}
            />

            {/* Damage Marks Overlay */}
            <div className="absolute inset-0 pointer-events-none">
              {damageMarks.map((mark) => {
                const typeInfo = damageTypeIcons[mark.damageType] || damageTypeIcons.other
                const ringWidth = severityRings[mark.severity] || '2'
                const isSelected = selectedMarkId === mark.id

                return (
                  <div
                    key={mark.id}
                    className="absolute pointer-events-auto cursor-pointer transition-transform"
                    style={{
                      left: `${mark.positionX}%`,
                      top: `${mark.positionY}%`,
                      transform: `translate(-50%, -50%) ${isSelected ? 'scale(1.2)' : ''}`,
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelectMark?.(mark)
                    }}
                  >
                    <div
                      className={`flex items-center justify-center rounded-full font-bold text-white text-xs transition-all ${
                        isSelected ? 'ring-2 ring-white' : ''
                      }`}
                      style={{
                        width: '24px',
                        height: '24px',
                        backgroundColor: typeInfo.color,
                        border: mark.isPreExisting ? '2px dashed white' : 'none',
                        boxShadow: `0 0 0 ${ringWidth}px ${typeInfo.color}40`,
                      }}
                      title={`${mark.damageType}${mark.description ? `: ${mark.description}` : ''}`}
                    >
                      {typeInfo.icon}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="p-2 border-t bg-white">
        <div className="flex flex-wrap gap-3 text-xs">
          {Object.entries(damageTypeIcons).map(([type, { icon, color }]) => (
            <div key={type} className="flex items-center gap-1">
              <span
                className="w-4 h-4 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
                style={{ backgroundColor: color }}
              >
                {icon}
              </span>
              <span className="capitalize">{type}</span>
            </div>
          ))}
        </div>
        <div className="flex gap-4 mt-2 text-xs text-gray-500">
          <span>{readonly ? 'View only' : 'Click on image to add damage mark'}</span>
          <span className="flex items-center gap-1">
            <span className="w-4 h-4 rounded-full border-2 border-dashed border-gray-400"></span>
            Pre-existing damage
          </span>
        </div>
      </div>
    </div>
  )
}
