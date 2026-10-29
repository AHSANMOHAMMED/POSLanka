'use client'

import React, { useId, useMemo, useState } from 'react'
import { usePaletteColor } from './usePaletteColor'

const BASE_GRADIENTS: Record<string, [string, string]> = {
  blue: ['#60a5fa', '#2563eb'],
  green: ['#4ade80', '#16a34a'],
  emerald: ['#34d399', '#059669'],
  violet: ['#a78bfa', '#7c3aed'],
  purple: ['#c084fc', '#9333ea'],
  amber: ['#fbbf24', '#d97706'],
  orange: ['#fb923c', '#ea580c'],
  red: ['#f87171', '#dc2626'],
  cyan: ['#22d3ee', '#0891b2'],
  slate: ['#94a3b8', '#475569'],
}

const BASE_SERIES_GRADIENTS: Array<[string, string]> = [
  ['#60a5fa', '#2563eb'],
  ['#34d399', '#059669'],
  ['#fbbf24', '#d97706'],
  ['#a78bfa', '#7c3aed'],
  ['#f87171', '#dc2626'],
  ['#22d3ee', '#0891b2'],
  ['#fb923c', '#ea580c'],
  ['#f472b6', '#db2777'],
]

interface ChartProps {
  labels: string[]
  datasets: Array<{
    label: string
    data: number[]
    colors?: string[]
  }>
  height?: number
  color?: string
}

function buildSmoothPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`

  let path = `M ${points[0].x} ${points[0].y}`

  for (let i = 0; i < points.length - 1; i++) {
    const curr = points[i]
    const next = points[i + 1]
    const prev = points[i - 1] || curr
    const nextNext = points[i + 2] || next

    const tension = 0.28

    const cp1x = curr.x + (next.x - prev.x) * tension
    const cp1y = curr.y + (next.y - prev.y) * tension
    const cp2x = next.x - (nextNext.x - curr.x) * tension
    const cp2y = next.y - (nextNext.y - curr.y) * tension

    path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${next.x} ${next.y}`
  }

  return path
}

export default function LineChart({ labels, datasets, height = 300, color = 'blue' }: ChartProps) {
  // Series 1 / "blue" follow the palette (Settings → Appearance)
  const pal = usePaletteColor()
  const GRADIENTS: Record<string, [string, string]> = { ...BASE_GRADIENTS, blue: [pal.light, pal.primary] }
  const DEFAULT_SERIES_GRADIENTS: Array<[string, string]> = [[pal.light, pal.primary], ...BASE_SERIES_GRADIENTS.slice(1)]
  const chartId = useId().replace(/:/g, '')
  const [hoveredPoint, setHoveredPoint] = useState<{ datasetIndex: number; pointIndex: number } | null>(null)

  const defaultThemePair = GRADIENTS[color] || GRADIENTS.blue

  const { maxValue, yTicks, totalValue, hasData: _hasData } = useMemo(() => {
    const allValues = datasets.flatMap(d => d.data.map(v => Number(v) || 0))
    const isAllZero = allValues.length === 0 || allValues.every(v => v === 0)
    if (isAllZero) {
      const defaultMax = 1000
      const tickCount = 5
      const ticks: number[] = []
      for (let i = 0; i <= tickCount; i++) {
        ticks.push(Math.round((defaultMax / tickCount) * i))
      }
      return { maxValue: defaultMax, yTicks: ticks, totalValue: 0, hasData: false }
    }
    const rawMax = Math.max(...allValues)
    const sum = allValues.reduce((acc, curr) => acc + curr, 0)
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawMax || 1)))
    const niceMax = Math.ceil(rawMax / magnitude) * magnitude || 1
    const tickCount = 5
    const ticks: number[] = []
    for (let i = 0; i <= tickCount; i++) {
      ticks.push(Math.round((niceMax / tickCount) * i))
    }
    return { maxValue: niceMax, yTicks: ticks, totalValue: sum, hasData: true }
  }, [datasets])

  if (!labels.length || !datasets.length) {
    return (
      <div
        style={{ height }}
        className="flex flex-col items-center justify-center text-center p-6 text-gray-400 dark:text-gray-500"
      >
        <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-2">
          <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
          </svg>
        </div>
        <p className="text-sm font-medium">No trend data available</p>
        <p className="text-xs text-gray-400 mt-0.5">Historical data points will render here</p>
      </div>
    )
  }

  const svgWidth = 600
  const svgHeight = 300
  const paddingLeft = 56
  const paddingRight = 24
  const paddingTop = 28
  const paddingBottom = 54
  const chartWidth = svgWidth - paddingLeft - paddingRight
  const chartHeight = svgHeight - paddingTop - paddingBottom

  const pointCount = labels.length
  const xStep = pointCount > 1 ? chartWidth / (pointCount - 1) : chartWidth / 2

  const formatValue = (v: number | undefined | null) => {
    const n = Number(v) || 0
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
    return n.toLocaleString()
  }

  const formatFullValue = (v: number | undefined | null) => {
    const n = Number(v) || 0
    return n.toLocaleString()
  }

  const getPoints = (data: number[]) => {
    return data.map((rawValue, i) => {
      const value = Number(rawValue) || 0
      return {
        x: paddingLeft + (pointCount > 1 ? i * xStep : chartWidth / 2),
        y: paddingTop + chartHeight - (maxValue > 0 ? (value / maxValue) * chartHeight : 0),
        value,
      }
    })
  }

  const shouldRotateLabels = pointCount > 8

  return (
    <div className="relative w-full select-none" style={{ height }}>
      <svg
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid meet"
        className="overflow-visible font-sans"
      >
        <defs>
          <filter id={`line-shadow-${chartId}`} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="4" stdDeviation="4" floodOpacity="0.25" />
          </filter>

          {datasets.map((_, di) => {
            const pair = datasets.length > 1
              ? DEFAULT_SERIES_GRADIENTS[di % DEFAULT_SERIES_GRADIENTS.length]
              : defaultThemePair
            return (
              <linearGradient
                key={`line-area-${di}`}
                id={`area-gradient-${chartId}-${di}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={pair[0]} stopOpacity={0.38} />
                <stop offset="70%" stopColor={pair[1]} stopOpacity={0.08} />
                <stop offset="100%" stopColor={pair[1]} stopOpacity={0.0} />
              </linearGradient>
            )
          })}
        </defs>

        {/* Horizontal Gridlines & Y-axis labels */}
        {yTicks.map((tick, i) => {
          const y = paddingTop + chartHeight - (tick / maxValue) * chartHeight
          return (
            <g key={`grid-${i}`}>
              <line
                x1={paddingLeft}
                y1={y}
                x2={svgWidth - paddingRight}
                y2={y}
                className="stroke-gray-200/80 dark:stroke-gray-700/60"
                strokeWidth={1}
                strokeDasharray={tick === 0 ? undefined : '3 3'}
              />
              <text
                x={paddingLeft - 10}
                y={y + 3.5}
                textAnchor="end"
                className="fill-gray-400 dark:fill-gray-500 font-medium text-[10px]"
              >
                {formatValue(tick)}
              </text>
            </g>
          )
        })}

        {/* X-axis baseline */}
        <line
          x1={paddingLeft}
          y1={paddingTop + chartHeight}
          x2={svgWidth - paddingRight}
          y2={paddingTop + chartHeight}
          className="stroke-gray-300 dark:stroke-gray-700"
          strokeWidth={1.5}
        />

        {/* Active hover crosshair line */}
        {hoveredPoint && (() => {
          const crosshairX = paddingLeft + (pointCount > 1 ? hoveredPoint.pointIndex * xStep : chartWidth / 2)
          return (
            <line
              x1={crosshairX}
              y1={paddingTop}
              x2={crosshairX}
              y2={paddingTop + chartHeight}
              className="stroke-blue-500/40 dark:stroke-blue-400/50"
              strokeWidth={1.5}
              strokeDasharray="4 4"
            />
          )
        })()}

        {/* Lines, areas, and data points */}
        {datasets.map((dataset, di) => {
          const points = getPoints(dataset.data)
          const pair = datasets.length > 1
            ? DEFAULT_SERIES_GRADIENTS[di % DEFAULT_SERIES_GRADIENTS.length]
            : defaultThemePair

          const linePath = buildSmoothPath(points)
          const areaPath = points.length > 0
            ? `${linePath} L ${points[points.length - 1].x} ${paddingTop + chartHeight} L ${points[0].x} ${paddingTop + chartHeight} Z`
            : ''

          return (
            <g key={`line-group-${di}`}>
              {/* Gradient Area Fill */}
              {areaPath && (
                <path
                  d={areaPath}
                  fill={`url(#area-gradient-${chartId}-${di})`}
                  style={{ transition: 'opacity 0.3s ease' }}
                />
              )}

              {/* Glowing Line Stroke */}
              <path
                d={linePath}
                fill="none"
                stroke={pair[1]}
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ transition: 'stroke-width 0.2s ease' }}
              />

              {/* Data points */}
              {points.map((pt, pi) => {
                const isHovered = hoveredPoint?.datasetIndex === di && hoveredPoint?.pointIndex === pi
                return (
                  <g
                    key={`dot-${di}-${pi}`}
                    onMouseEnter={() => setHoveredPoint({ datasetIndex: di, pointIndex: pi })}
                    onMouseLeave={() => setHoveredPoint(null)}
                    className="cursor-pointer"
                  >
                    {/* Generous touch/mouse target */}
                    <circle cx={pt.x} cy={pt.y} r={16} fill="transparent" />

                    {/* Outer glow ring when hovered */}
                    {isHovered && (
                      <circle
                        cx={pt.x}
                        cy={pt.y}
                        r={9}
                        fill={pair[0]}
                        fillOpacity={0.35}
                        className="animate-pulse"
                      />
                    )}

                    {/* Center point dot */}
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={isHovered ? 5.5 : 3.5}
                      fill="white"
                      stroke={pair[1]}
                      strokeWidth={isHovered ? 3 : 2}
                      className="transition-all duration-150"
                    />
                  </g>
                )
              })}
            </g>
          )
        })}

        {/* Floating Tooltip Card */}
        {hoveredPoint && (() => {
          const { datasetIndex: di, pointIndex: pi } = hoveredPoint
          const dataset = datasets[di]
          if (!dataset) return null
          const rawValue = dataset.data[pi]
          const value = Number(rawValue) || 0
          const ptX = paddingLeft + (pointCount > 1 ? pi * xStep : chartWidth / 2)
          const ptY = paddingTop + chartHeight - (maxValue > 0 ? (value / maxValue) * chartHeight : 0)

          const labelText = labels[pi] || ''
          const valueText = formatFullValue(value)
          const percentText = totalValue > 0 ? `${((value / totalValue) * 100).toFixed(1)}% of total` : ''

          const tooltipWidth = Math.max(105, Math.min(140, labelText.length * 7 + 36))
          const tooltipHeight = percentText ? 52 : 40

          let tooltipX = ptX - tooltipWidth / 2
          if (tooltipX < paddingLeft) tooltipX = paddingLeft + 4
          if (tooltipX + tooltipWidth > svgWidth - paddingRight) {
            tooltipX = svgWidth - paddingRight - tooltipWidth - 4
          }

          let tooltipY = ptY - tooltipHeight - 12
          if (tooltipY < paddingTop) {
            tooltipY = ptY + 14
          }

          return (
            <g className="pointer-events-none transition-all duration-150">
              <rect
                x={tooltipX}
                y={tooltipY}
                width={tooltipWidth}
                height={tooltipHeight}
                rx={7}
                className="fill-gray-900/95 dark:fill-gray-950/95 stroke-white/10"
                strokeWidth={1}
                filter={`url(#line-shadow-${chartId})`}
              />
              <text
                x={tooltipX + tooltipWidth / 2}
                y={tooltipY + 14}
                textAnchor="middle"
                className="fill-gray-400 font-normal text-[9.5px] uppercase tracking-wider"
              >
                {labelText}
              </text>
              <text
                x={tooltipX + tooltipWidth / 2}
                y={tooltipY + 30}
                textAnchor="middle"
                className="fill-white font-bold text-[13px]"
              >
                {valueText}
              </text>
              {percentText && (
                <text
                  x={tooltipX + tooltipWidth / 2}
                  y={tooltipY + 44}
                  textAnchor="middle"
                  className="fill-emerald-400 font-medium text-[9px]"
                >
                  {percentText}
                </text>
              )}
            </g>
          )
        })()}

        {/* X-axis labels */}
        {labels.map((label, i) => {
          const x = paddingLeft + (pointCount > 1 ? i * xStep : chartWidth / 2)
          const y = paddingTop + chartHeight + 16
          const isSelected = hoveredPoint?.pointIndex === i
          const truncated = label.length > 13 ? label.slice(0, 12) + '…' : label

          return (
            <text
              key={`label-${i}`}
              x={x}
              y={y}
              textAnchor={shouldRotateLabels ? 'end' : 'middle'}
              className={`text-[10px] transition-colors duration-150 ${
                isSelected
                  ? 'fill-blue-600 dark:fill-blue-400 font-semibold'
                  : 'fill-gray-500 dark:fill-gray-400 font-medium'
              }`}
              transform={shouldRotateLabels ? `rotate(-32, ${x}, ${y})` : undefined}
            >
              {truncated}
            </text>
          )
        })}

        {/* Legend */}
        {datasets.length > 1 && (
          <g>
            {datasets.map((dataset, di) => {
              const legendX = paddingLeft + di * 120
              const legendY = svgHeight - 6
              const pair = DEFAULT_SERIES_GRADIENTS[di % DEFAULT_SERIES_GRADIENTS.length]
              return (
                <g key={`legend-${di}`} className="select-none">
                  <line
                    x1={legendX}
                    y1={legendY - 4}
                    x2={legendX + 16}
                    y2={legendY - 4}
                    stroke={pair[1]}
                    strokeWidth={2.5}
                    strokeLinecap="round"
                  />
                  <circle
                    cx={legendX + 8}
                    cy={legendY - 4}
                    r={3.5}
                    fill="white"
                    stroke={pair[1]}
                    strokeWidth={2}
                  />
                  <text
                    x={legendX + 22}
                    y={legendY}
                    className="fill-gray-600 dark:fill-gray-300 font-medium text-[11px]"
                  >
                    {dataset.label}
                  </text>
                </g>
              )
            })}
          </g>
        )}
      </svg>
    </div>
  )
}
