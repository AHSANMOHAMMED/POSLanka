'use client'

import { useRef, useCallback } from 'react'
import type { LabelElement, LabelShape } from '@/lib/labels/types'
import { LabelElementComponent } from './LabelElement'
import type { ResizeHandle } from './LabelElement'

interface LabelCanvasProps {
  widthMm: number
  heightMm: number
  labelShape?: LabelShape
  cornerRadius?: number | null
  elements: LabelElement[]
  selectedId: string | null
  zoom: number
  showGrid: boolean
  onSelectElement: (id: string | null) => void
  onUpdateElement: (id: string, updates: Partial<LabelElement>) => void
  codeWord?: string
}

const MIN_SIZE_MM = 1 // minimum element dimension in mm

export function LabelCanvas({
  widthMm,
  heightMm,
  labelShape,
  cornerRadius,
  elements,
  selectedId,
  zoom,
  showGrid,
  onSelectElement,
  onUpdateElement,
  codeWord,
}: LabelCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ elementId: string; startX: number; startY: number; origX: number; origY: number } | null>(null)
  const resizeRef = useRef<{
    elementId: string
    handle: ResizeHandle
    startX: number
    startY: number
    origX: number
    origY: number
    origW: number
    origH: number
  } | null>(null)

  const mmToPx = useCallback((mm: number) => mm * (96 / 25.4) * zoom, [zoom])
  const pxToMm = useCallback((px: number) => px / ((96 / 25.4) * zoom), [zoom])

  const canvasWidthPx = mmToPx(widthMm)
  const canvasHeightPx = mmToPx(heightMm)

  // Snap value to 0.5mm grid
  const snap = (v: number) => Math.round(v * 2) / 2

  function handleDragStart(elementId: string, e: React.MouseEvent) {
    const el = elements.find(el => el.id === elementId)
    if (!el) return
    dragRef.current = {
      elementId,
      startX: e.clientX,
      startY: e.clientY,
      origX: el.x,
      origY: el.y,
    }

    function handleMouseMove(ev: MouseEvent) {
      if (!dragRef.current) return
      const dx = pxToMm(ev.clientX - dragRef.current.startX)
      const dy = pxToMm(ev.clientY - dragRef.current.startY)
      const newX = Math.max(0, Math.min(widthMm - 1, dragRef.current.origX + dx))
      const newY = Math.max(0, Math.min(heightMm - 1, dragRef.current.origY + dy))
      onUpdateElement(dragRef.current.elementId, { x: snap(newX), y: snap(newY) })
    }

    function handleMouseUp() {
      dragRef.current = null
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  function handleResizeStart(elementId: string, e: React.MouseEvent, handle: ResizeHandle) {
    e.stopPropagation()
    const el = elements.find(el => el.id === elementId)
    if (!el) return

    resizeRef.current = {
      elementId,
      handle,
      startX: e.clientX,
      startY: e.clientY,
      origX: el.x,
      origY: el.y,
      origW: el.width,
      origH: el.height,
    }

    function handleMouseMove(ev: MouseEvent) {
      if (!resizeRef.current) return
      const r = resizeRef.current
      const dxMm = pxToMm(ev.clientX - r.startX)
      const dyMm = pxToMm(ev.clientY - r.startY)

      let newX = r.origX
      let newY = r.origY
      let newW = r.origW
      let newH = r.origH

      // Determine which axes are affected by the handle
      // 'nw' contains 'w' and 'n', 'se' contains 's' and 'e', etc.
      const affectsLeft = r.handle.includes('w')
      const affectsRight = r.handle.includes('e')
      const affectsTop = r.handle.includes('n')
      const affectsBottom = r.handle.includes('s')

      if (affectsLeft) {
        newX = r.origX + dxMm
        newW = r.origW - dxMm
        if (newX < 0) { newW += newX; newX = 0 }
        if (newW < MIN_SIZE_MM) { newX = r.origX + r.origW - MIN_SIZE_MM; newW = MIN_SIZE_MM }
      } else if (affectsRight) {
        newW = r.origW + dxMm
        if (newW < MIN_SIZE_MM) newW = MIN_SIZE_MM
        if (newX + newW > widthMm) newW = widthMm - newX
      }

      if (affectsTop) {
        newY = r.origY + dyMm
        newH = r.origH - dyMm
        if (newY < 0) { newH += newY; newY = 0 }
        if (newH < MIN_SIZE_MM) { newY = r.origY + r.origH - MIN_SIZE_MM; newH = MIN_SIZE_MM }
      } else if (affectsBottom) {
        newH = r.origH + dyMm
        if (newH < MIN_SIZE_MM) newH = MIN_SIZE_MM
        if (newY + newH > heightMm) newH = heightMm - newY
      }

      onUpdateElement(r.elementId, {
        x: snap(newX),
        y: snap(newY),
        width: snap(Math.max(MIN_SIZE_MM, newW)),
        height: snap(Math.max(MIN_SIZE_MM, newH)),
      })
    }

    function handleMouseUp() {
      resizeRef.current = null
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  // Grid pattern
  const gridSvg = showGrid ? `
    <svg width="${mmToPx(1)}" height="${mmToPx(1)}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${mmToPx(1)}" height="${mmToPx(1)}" fill="none" stroke="#e5e7eb" stroke-width="0.5"/>
    </svg>
  ` : ''

  const gridBg = showGrid ? {
    backgroundImage: `url("data:image/svg+xml;base64,${btoa(gridSvg)}")`,
    backgroundRepeat: 'repeat',
  } : {}

  const shapeBorderRadius =
    labelShape === 'circle' || labelShape === 'oval' ? '50%' :
    labelShape === 'rounded-rectangle' ? `${(cornerRadius ?? 5) * (96 / 25.4) * zoom}px` :
    undefined

  return (
    <div className="flex-1 overflow-auto bg-gray-200 p-8 flex items-start justify-center">
      <div
        ref={canvasRef}
        style={{
          width: canvasWidthPx,
          height: canvasHeightPx,
          position: 'relative',
          background: 'white',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          borderRadius: shapeBorderRadius,
          overflow: 'hidden',
          ...gridBg,
        }}
        onMouseDown={(e) => {
          if (e.target === canvasRef.current) {
            onSelectElement(null)
          }
        }}
      >
        {elements
          .sort((a, b) => a.zIndex - b.zIndex)
          .map(el => (
            <LabelElementComponent
              key={el.id}
              element={el}
              zoom={zoom}
              selected={el.id === selectedId}
              onSelect={() => onSelectElement(el.id)}
              onDragStart={(e) => handleDragStart(el.id, e)}
              onResizeStart={(e, handle) => handleResizeStart(el.id, e, handle)}
              codeWord={codeWord}
            />
          ))}
      </div>
    </div>
  )
}
