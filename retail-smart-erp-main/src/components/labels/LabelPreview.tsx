'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import type { LabelTemplate, LabelItemData, LabelShape } from '@/lib/labels/types'
import { renderLabelHtml } from '@/lib/labels/label-renderer'
import { sanitizeLabelHtml } from '@/lib/labels/sanitize-label-html'
import { elementAt } from '@/lib/labels/print-setup'
import { nativeFontFamily, nativeTextFit } from '@/lib/print/label/native-text'
import type { RawLabelLanguage } from '@/lib/print/label/common'

/**
 * How the preview is drawn:
 *  - html:   browser rendering (Chrome print path), barcodes on the printer's dot grid
 *  - raster: the exact 1-bit picture a raw printer gets in "exact" mode (what you see is what prints)
 *  - native: printer-font look of the "fast text" raw mode (same character cut as the printer)
 */
export type LabelPreviewRender =
  | { mode: 'html'; dpi?: number }
  | { mode: 'raster'; dpi: number }
  | { mode: 'native'; dpi: number; language: RawLabelLanguage }

interface LabelPreviewProps {
  template: Pick<LabelTemplate, 'widthMm' | 'heightMm' | 'elements'> & { labelShape?: LabelShape | string; cornerRadius?: number | null }
  item?: LabelItemData | null
  currencySymbol?: string
  tenantName?: string
  codeWord?: string
  maxWidth?: number
  render?: LabelPreviewRender
  /** Click on the label: the element under the pointer (null = empty area). */
  onElementClick?: (id: string | null) => void
  selectedId?: string | null
}

export function LabelPreview({ template, item, currencySymbol, tenantName, codeWord, maxWidth = 300, render, onElementClick, selectedId }: LabelPreviewProps) {
  const [html, setHtml] = useState('')
  const [raster, setRaster] = useState<string | null>(null)

  // Stabilize template reference to prevent infinite re-renders
  // when parent passes a new object literal each render
  const elementsJson = JSON.stringify(template.elements)
  const stableTemplate = useMemo(
    () => ({ widthMm: template.widthMm, heightMm: template.heightMm, elements: template.elements, labelShape: template.labelShape, cornerRadius: template.cornerRadius }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [template.widthMm, template.heightMm, elementsJson, template.labelShape, template.cornerRadius]
  )
  const renderKey = JSON.stringify(render || { mode: 'html' })

  // Track latest render to avoid stale async updates
  const renderIdRef = useRef(0)

  useEffect(() => {
    const renderId = ++renderIdRef.current
    const r: LabelPreviewRender = JSON.parse(renderKey)
    if (r.mode === 'raster') {
      import('@/lib/print/label/canvas-raster')
        .then(({ rasterLabelPreviewDataUrl }) => rasterLabelPreviewDataUrl(stableTemplate, item || null, { dpi: r.dpi, currencySymbol, tenantName, codeWord }))
        .then((res) => {
          if (renderId === renderIdRef.current) setRaster(res?.url ?? null)
        })
        .catch(() => {
          if (renderId === renderIdRef.current) setRaster(null)
        })
      return
    }
    const opts = r.mode === 'native' ? { fontFamily: nativeFontFamily(r.language), fitText: nativeTextFit(r.language, r.dpi) } : {}
    renderLabelHtml(stableTemplate, item || null, currencySymbol, tenantName, codeWord, r.dpi || 203, opts).then(result => {
      if (renderId === renderIdRef.current) {
        setRaster(null)
        setHtml(sanitizeLabelHtml(result))
      }
    })
  }, [stableTemplate, item, currencySymbol, tenantName, codeWord, renderKey])

  const widthMm = Number(template.widthMm)
  const heightMm = Number(template.heightMm)
  const widthPx = widthMm * (96 / 25.4)
  const scale = Math.min(1, maxWidth / widthPx)

  const shapeBorderRadius =
    template.labelShape === 'circle' || template.labelShape === 'oval' ? '50%' :
    template.labelShape === 'rounded-rectangle' ? `${(template.cornerRadius ?? 5) * (96 / 25.4)}px` :
    undefined

  const heightPx = heightMm * (96 / 25.4)
  const scaledWidth = widthPx * scale
  const scaledHeight = heightPx * scale
  const selected = selectedId ? (template.elements || []).find((e) => e.id === selectedId) : null
  const mmPx = (96 / 25.4) * scale

  const onClick = onElementClick
    ? (e: React.MouseEvent<HTMLDivElement>) => {
        const rect = e.currentTarget.getBoundingClientRect()
        const x = ((e.clientX - rect.left) / rect.width) * widthMm
        const y = ((e.clientY - rect.top) / rect.height) * heightMm
        onElementClick(elementAt(template.elements || [], x, y)?.id ?? null)
      }
    : undefined

  return (
    <div
      className={`inline-block relative ${onClick ? 'cursor-pointer' : ''}`}
      style={{ width: scaledWidth, height: scaledHeight, maxWidth }}
      onClick={onClick}
      title={onClick ? 'Click any part of the label to adjust it' : undefined}
    >
      {render?.mode === 'raster' ? (
        <div style={{ width: scaledWidth, height: scaledHeight, border: '1px solid #e5e7eb', background: 'white', borderRadius: shapeBorderRadius, overflow: 'hidden' }}>
          {raster ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={raster} alt="Label as the printer prints it" style={{ width: '100%', height: '100%', display: 'block', imageRendering: scale >= 1 ? 'pixelated' : 'auto' }} />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[10px] text-gray-400">Rendering…</div>
          )}
        </div>
      ) : (
        <div
          style={{
            width: widthPx,
            height: heightPx,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            overflow: 'hidden',
            borderRadius: shapeBorderRadius,
            border: '1px solid #e5e7eb',
            background: 'white',
          }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
      {selected && (
        <div
          className="absolute pointer-events-none border-2 border-blue-500 bg-blue-500/10 rounded-sm"
          style={{ left: selected.x * mmPx - 1, top: selected.y * mmPx - 1, width: selected.width * mmPx + 2, height: selected.height * mmPx + 2 }}
        />
      )}
    </div>
  )
}
