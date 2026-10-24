'use client'

/**
 * True-scale preview of a label roll: the liner, every column with its gaps and
 * margins, and the label content shifted by the calibration offsets, laid out
 * exactly as the printer will place it (same packing as the raw encoders).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { LabelItemData, LabelTemplate } from '@/lib/labels/types'
import { renderLabelHtml } from '@/lib/labels/label-renderer'
import { packLabelRows } from '@/lib/print/label/common'
import { stickerRollWidthMm, type StickerSetup } from '@/lib/labels/sticker-stock'

const PX_PER_MM = 96 / 25.4

export interface StickerRollPreviewProps {
  setup: StickerSetup
  template: Pick<LabelTemplate, 'widthMm' | 'heightMm' | 'elements'>
  /** Items with quantities as they will print (empty = one sample label per column). */
  items: { item: LabelItemData | null; quantity: number }[]
  copies?: number
  currencySymbol?: string
  tenantName?: string
  codeWord?: string
  /** 'true' = 1 mm on screen per mm (96 dpi CSS); 'fit' = scale down to the container. */
  zoom?: 'true' | 'fit'
  /** Max rows drawn. */
  maxRows?: number
  /** Show the crosshair / border alignment overlay. */
  showGuides?: boolean
}

export function StickerRollPreview({
  setup,
  template,
  items,
  copies = 1,
  currencySymbol,
  tenantName,
  codeWord,
  zoom = 'fit',
  maxRows = 4,
  showGuides = false,
}: StickerRollPreviewProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [containerW, setContainerW] = useState(0)
  const [htmlByItem, setHtmlByItem] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setContainerW(el.clientWidth))
    ro.observe(el)
    setContainerW(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const rows = useMemo(() => {
    const list = items.length ? items : [{ item: null, quantity: setup.columns }]
    return packLabelRows(list, setup.columns, copies)
  }, [items, setup.columns, copies])

  // Expand merged rows (count) for drawing, capped
  const drawRows = useMemo(() => {
    const out: (typeof rows)[number]['cells'][] = []
    for (const r of rows) {
      for (let i = 0; i < r.count && out.length < maxRows; i++) out.push(r.cells)
      if (out.length >= maxRows) break
    }
    return out
  }, [rows, maxRows])
  const totalRows = rows.reduce((n, r) => n + r.count, 0)

  const uniqueItems = useMemo(() => {
    const m = new Map<string, LabelItemData | null>()
    for (const cells of drawRows) for (const c of cells) if (c) m.set(c.item?.id ?? '__sample', c.item)
    return m
  }, [drawRows])

  const elementsJson = JSON.stringify(template.elements)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const next = new Map<string, string>()
      for (const [key, item] of uniqueItems) {
        next.set(key, await renderLabelHtml({ widthMm: template.widthMm, heightMm: template.heightMm, elements: template.elements }, item, currencySymbol, tenantName, codeWord))
      }
      if (!cancelled) setHtmlByItem(next)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uniqueItems, elementsJson, template.widthMm, template.heightMm, currencySymbol, tenantName, codeWord])

  const rollW = stickerRollWidthMm(setup)
  const linerPadY = Math.max(1, setup.rowGapMm / 2)
  const pitchY = setup.labelHeightMm + setup.rowGapMm
  const linerH = drawRows.length * pitchY - setup.rowGapMm + linerPadY * 2
  const naturalW = rollW * PX_PER_MM
  const scale = zoom === 'true' || !containerW ? 1 : Math.min(1, (containerW - 8) / naturalW)
  const mm = (v: number) => v * PX_PER_MM * scale
  const tplW = Number(template.widthMm) || setup.labelWidthMm
  const tplH = Number(template.heightMm) || setup.labelHeightMm

  return (
    <div ref={wrapRef} className="w-full overflow-x-auto">
      <div className="text-[11px] text-gray-500 mb-1 flex flex-wrap gap-x-3">
        <span>Liner {rollW} mm</span>
        <span>
          {setup.columns} across · {setup.labelWidthMm} x {setup.labelHeightMm} mm
        </span>
        <span>gap {setup.columnGapMm} / {setup.rowGapMm} mm</span>
        {(setup.offsetXMm !== 0 || setup.offsetYMm !== 0) && (
          <span className="text-amber-600">
            offset {setup.offsetXMm > 0 ? '+' : ''}
            {setup.offsetXMm}, {setup.offsetYMm > 0 ? '+' : ''}
            {setup.offsetYMm} mm
          </span>
        )}
        {zoom === 'true' && <span>actual size</span>}
      </div>
      <div
        className="relative mx-auto"
        style={{
          width: mm(rollW),
          height: mm(linerH),
          background: 'repeating-linear-gradient(45deg,#f3efe3,#f3efe3 6px,#ebe5d3 6px,#ebe5d3 12px)',
          borderLeft: '1px solid #d6cfb8',
          borderRight: '1px solid #d6cfb8',
          overflow: 'hidden',
        }}
        aria-label={`Label roll preview, ${setup.columns} across`}
      >
        {drawRows.map((cells, r) =>
          cells.map((cell, k) => {
            const left = setup.marginLeftMm + k * (setup.labelWidthMm + setup.columnGapMm)
            const top = linerPadY + r * pitchY
            const html = cell ? htmlByItem.get(cell.item?.id ?? '__sample') || '' : ''
            return (
              <div
                key={`${r}-${k}`}
                className="absolute bg-white"
                style={{
                  left: mm(left),
                  top: mm(top),
                  width: mm(setup.labelWidthMm),
                  height: mm(setup.labelHeightMm),
                  borderRadius: mm(1.5),
                  boxShadow: '0 0 0 1px #d1d5db',
                }}
              >
                {cell && (
                  // Content is placed relative to the label origin plus the calibration offsets (not clipped:
                  // a mis-calibrated setup visibly spills over the label edge)
                  <div
                    style={{
                      position: 'absolute',
                      left: mm(setup.offsetXMm),
                      top: mm(setup.offsetYMm),
                      width: tplW * PX_PER_MM,
                      height: tplH * PX_PER_MM,
                      transform: `scale(${scale})`,
                      transformOrigin: 'top left',
                      pointerEvents: 'none',
                    }}
                    dangerouslySetInnerHTML={{ __html: html }}
                  />
                )}
                {showGuides && (
                  <>
                    <div className="absolute border border-red-500/70" style={{ inset: mm(0.5) }} />
                    <div className="absolute bg-red-500/70" style={{ left: '50%', top: '30%', bottom: '30%', width: 1 }} />
                    <div className="absolute bg-red-500/70" style={{ top: '50%', left: '30%', right: '30%', height: 1 }} />
                  </>
                )}
                {!cell && <div className="absolute inset-0 flex items-center justify-center text-[10px] text-gray-300">blank</div>}
              </div>
            )
          })
        )}
      </div>
      {totalRows > drawRows.length && (
        <p className="text-[11px] text-gray-400 mt-1 text-center">
          Showing {drawRows.length} of {totalRows} rows
        </p>
      )}
    </div>
  )
}
