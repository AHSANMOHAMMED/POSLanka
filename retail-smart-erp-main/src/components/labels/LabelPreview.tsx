'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import type { LabelTemplate, LabelItemData, LabelShape } from '@/lib/labels/types'
import { renderLabelHtml } from '@/lib/labels/label-renderer'

interface LabelPreviewProps {
  template: Pick<LabelTemplate, 'widthMm' | 'heightMm' | 'elements'> & { labelShape?: LabelShape | string; cornerRadius?: number | null }
  item?: LabelItemData | null
  currencySymbol?: string
  tenantName?: string
  codeWord?: string
  maxWidth?: number
}

export function LabelPreview({ template, item, currencySymbol, tenantName, codeWord, maxWidth = 300 }: LabelPreviewProps) {
  const [html, setHtml] = useState('')

  // Stabilize template reference to prevent infinite re-renders
  // when parent passes a new object literal each render
  const elementsJson = JSON.stringify(template.elements)
  const stableTemplate = useMemo(
    () => ({ widthMm: template.widthMm, heightMm: template.heightMm, elements: template.elements, labelShape: template.labelShape, cornerRadius: template.cornerRadius }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [template.widthMm, template.heightMm, elementsJson, template.labelShape, template.cornerRadius]
  )

  // Track latest render to avoid stale async updates
  const renderIdRef = useRef(0)

  useEffect(() => {
    const renderId = ++renderIdRef.current
    renderLabelHtml(stableTemplate, item || null, currencySymbol, tenantName, codeWord).then(result => {
      if (renderId === renderIdRef.current) setHtml(result)
    })
  }, [stableTemplate, item, currencySymbol, tenantName, codeWord])

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

  return (
    <div className="inline-block" style={{ width: scaledWidth, height: scaledHeight, maxWidth }}>
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
    </div>
  )
}
