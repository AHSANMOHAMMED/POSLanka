'use client'

import React, { useMemo } from 'react'
import { ScanBarcode, Copy, Check } from 'lucide-react'
import { useState } from 'react'

interface BarcodePreviewProps {
  barcode?: string | null
  className?: string
  height?: number
  showText?: boolean
  label?: string
}

/**
 * Generates deterministic bar widths (1, 2, 3 or 4 units) based on string characters
 * to render a realistic, crisp 1D barcode vector SVG without external heavy canvas dependencies.
 */
function generateBars(code: string): number[] {
  if (!code) return []
  const clean = code.trim()
  const bars: number[] = [2, 1, 2, 1] // Start guard pattern
  let sum = 0
  for (let i = 0; i < clean.length; i++) {
    const charCode = clean.charCodeAt(i)
    sum += charCode
    // 4 bars per character
    const b1 = (charCode % 3) + 1
    const b2 = ((charCode >> 1) % 3) + 1
    const b3 = ((charCode >> 2) % 3) + 1
    const b4 = ((charCode >> 3) % 2) + 1
    bars.push(b1, b2, b3, b4)
  }
  // Check digit bar + stop guard pattern
  bars.push((sum % 3) + 1, 2, 1, 2, 2, 2)
  return bars
}

export function BarcodePreview({
  barcode,
  className = '',
  height = 54,
  showText = true,
  label,
}: BarcodePreviewProps) {
  const [copied, setCopied] = useState(false)
  const code = (barcode || '').trim()

  const bars = useMemo(() => generateBars(code), [code])

  function handleCopy() {
    if (!code) return
    navigator.clipboard?.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!code) {
    return (
      <div className={`flex flex-col items-center justify-center p-3 rounded-xl border border-dashed border-slate-200 dark:border-gray-700 bg-slate-50/60 dark:bg-gray-800/40 text-slate-400 dark:text-gray-500 text-xs ${className}`}>
        <ScanBarcode size={22} className="opacity-40 mb-1" />
        <span>No barcode entered</span>
      </div>
    )
  }

  // Render SVG bars: alternating black / transparent rectangles
  let currentX = 10 // Left margin
  const svgElements: React.ReactNode[] = []

  bars.forEach((w, idx) => {
    const isBlack = idx % 2 === 0
    if (isBlack) {
      svgElements.push(
        <rect
          key={idx}
          x={currentX}
          y={4}
          width={w * 1.5}
          height={height - (showText ? 20 : 8)}
          fill="currentColor"
        />
      )
    }
    currentX += w * 1.5
  })

  const svgWidth = currentX + 10 // Total width + right margin

  return (
    <div
      className={`relative group bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded-xl p-3 flex flex-col items-center select-none shadow-xs transition-all hover:theme-border-primary ${className}`}
    >
      {label && (
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500 mb-1 self-start">
          {label}
        </span>
      )}

      {/* SVG Barcode Graphic */}
      <div className="w-full max-w-[260px] overflow-hidden flex items-center justify-center text-slate-900 dark:text-slate-100">
        <svg
          viewBox={`0 0 ${svgWidth} ${height}`}
          className="w-full h-auto max-h-[58px]"
          preserveAspectRatio="xMidYMid meet"
          shapeRendering="crispEdges"
        >
          {svgElements}
          {showText && (
            <text
              x={svgWidth / 2}
              y={height - 2}
              textAnchor="middle"
              className="font-mono text-[11px] font-bold fill-slate-700 dark:fill-slate-300 tracking-[0.2em]"
            >
              {code}
            </text>
          )}
        </svg>
      </div>

      {/* Hover action to copy barcode */}
      <button
        type="button"
        onClick={handleCopy}
        title="Copy barcode value"
        className="absolute top-2 right-2 p-1 rounded-md text-slate-400 hover:theme-text-primary hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors opacity-80 group-hover:opacity-100"
      >
        {copied ? <Check size={14} className="text-emerald-600 dark:text-emerald-400" /> : <Copy size={14} />}
      </button>
    </div>
  )
}

/**
 * Compact barcode badge with icon and full tooltip for cards, tables, and cart lines.
 */
export function BarcodeBadge({
  barcode,
  sku,
  className = '',
}: {
  barcode?: string | null
  sku?: string | null
  className?: string
}) {
  if (!barcode && !sku) return null
  // Prefer SKU when available, or barcode if explicitly provided without SKU
  const text = sku || barcode || ''
  const isSku = !!sku

  return (
    <span
      className={`inline-flex items-center gap-1 font-mono text-[11px] font-semibold px-2 py-0.5 rounded-md border border-slate-200/80 dark:border-gray-700 bg-slate-100/90 dark:bg-gray-800/90 text-slate-700 dark:text-gray-200 ${className}`}
      title={isSku ? `SKU: ${sku}` : `Barcode: ${barcode}`}
    >
      <ScanBarcode size={12} className="text-slate-500 dark:text-gray-400 shrink-0" />
      <span className="truncate max-w-[120px]">{isSku ? `SKU: ${sku}` : text}</span>
    </span>
  )
}

