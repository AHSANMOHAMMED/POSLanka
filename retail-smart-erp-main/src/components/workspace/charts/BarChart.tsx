'use client'

import React, { useId, useMemo, useState } from 'react'

const GRADIENTS: Record<string, [string, string]> = {
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

const DEFAULT_SERIES_GRADIENTS: Array<[string, string]> = [
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

export default function BarChart({ labels, datasets, height = 300, color = 'blue' }: ChartProps) {
  const chartId = useId().replace(/:/g, '')
  const [hoveredBar, setHoveredBar] = useState<{ datasetIndex: number; barIndex: number } | null>(null)

  const defaultThemePair = GRADIENTS[color] || GRADIENTS.blue

  const { maxValue, yTicks, totalValue, hasData } = useMemo(() => {
    const allValues = datasets.flatMap(d => d.data.map(v => Number(v) || 0))
    if (allValues.length === 0 || allValues.every(v => v === 0)) {
      return { maxValue: 0, yTicks: [0], totalValue: 0, hasData: false }
    }
    const rawMax = Math.max(...allValues)
    const sum = allValues.reduce((acc, curr) => acc + curr, 0)
    // Round up to a pleasant readable number
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawMax || 1)))
    const niceMax = Math.ceil(rawMax / magnitude) * magnitude || 1
    const tickCount = 5
    const ticks: number[] = []
    for (let i = 0; i <= tickCount; i++) {
      ticks.push(Math.round((niceMax / tickCount) * i))
    }
    return { maxValue: niceMax, yTicks: ticks, totalValue: sum, hasData: true }
  }, [datasets])

  if (!labels.length || !datasets.length || !hasData) {
    return (
      <div
        style={{ height }}
        className="flex flex-col items-center justify-center text-center p-6 text-gray-400 dark:text-gray-500"
      >
        <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-2">
          <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        </div>
        <p className="text-sm font-medium">No activity recorded yet</p>
        <p className="text-xs text-gray-400 mt-0.5">Transactions will appear here dynamically</p>
      </div>
    )
  }

  // Layout constants
  const svgWidth = 600
  const svgHeight = 300
  const paddingLeft = 56
  const paddingRight = 24
  const paddingTop = 28
  const paddingBottom = 54
  const chartWidth = svgWidth - paddingLeft - paddingRight
  const chartHeight = svgHeight - paddingTop - paddingBottom

  const datasetCount = datasets.length
  const groupCount = labels.length
  const groupWidth = chartWidth / groupCount
  const groupPadding = Math.max(groupWidth * 0.24, 6)
  const barAreaWidth = groupWidth - groupPadding
  const barWidth = Math.max(Math.min(barAreaWidth / datasetCount, 48), 6)
  const barGap = datasetCount > 1 ? Math.max((barAreaWidth - barWidth * datasetCount) / (datasetCount - 1), 2) : 0
  const totalBarsWidth = barWidth * datasetCount + barGap * (datasetCount - 1)
  const barGroupOffset = (groupWidth - totalBarsWidth) / 2

  const shouldRotateLabels = groupCount > 7

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
          {/* Subtle drop shadow filter for hovered bar */}
          <filter id={`bar-shadow-${chartId}`} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="4" stdDeviation="4" floodOpacity="0.25" />
          </filter>

          {/* Gradients */}
          {datasets.map((_, di) => {
            const pair = datasetCount > 1
              ? DEFAULT_SERIES_GRADIENTS[di % DEFAULT_SERIES_GRADIENTS.length]
              : defaultThemePair
            return (
              <linearGradient
                key={`grad-${di}`}
                id={`bar-grad-${chartId}-${di}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={pair[0]} stopOpacity={1} />
                <stop offset="100%" stopColor={pair[1]} stopOpacity={0.92} />
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

        {/* Hover column backdrop bands */}
        {labels.map((_, bi) => {
          const isCurrentColHovered = hoveredBar?.barIndex === bi
          if (!isCurrentColHovered) return null
          const colX = paddingLeft + bi * groupWidth
          return (
            <rect
              key={`hover-col-${bi}`}
              x={colX}
              y={paddingTop}
              width={groupWidth}
              height={chartHeight}
              className="fill-blue-500/[0.04] dark:fill-white/[0.03]"
              rx={6}
            />
          )
        })}

        {/* Bars */}
        {datasets.map((dataset, di) =>
          dataset.data.map((rawValue, bi) => {
            const value = Number(rawValue) || 0
            const barHeight = maxValue > 0 ? (value / maxValue) * chartHeight : 0
            const x = paddingLeft + bi * groupWidth + barGroupOffset + di * (barWidth + barGap)
            const y = paddingTop + chartHeight - barHeight
            const isHovered = hoveredBar?.datasetIndex === di && hoveredBar?.barIndex === bi
            const isAnyHovered = hoveredBar !== null
            const opacity = !isAnyHovered ? 1 : isHovered ? 1 : 0.45
            const pillRadius = Math.min(6, barWidth / 2)

            return (
              <g
                key={`bar-${di}-${bi}`}
                onMouseEnter={() => setHoveredBar({ datasetIndex: di, barIndex: bi })}
                onMouseLeave={() => setHoveredBar(null)}
                className="cursor-pointer transition-transform duration-200"
              >
                {/* Main rounded bar */}
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={Math.max(barHeight, 0)}
                  fill={`url(#bar-grad-${chartId}-${di})`}
                  rx={pillRadius}
                  ry={pillRadius}
                  opacity={opacity}
                  filter={isHovered ? `url(#bar-shadow-${chartId})` : undefined}
                  style={{
                    transition: 'opacity 0.2s ease, filter 0.2s ease',
                  }}
                />

                {/* Subtle top gloss cap line */}
                {barHeight > 6 && (
                  <rect
                    x={x + 1}
                    y={y + 1}
                    width={Math.max(barWidth - 2, 0)}
                    height={2}
                    fill="white"
                    fillOpacity={0.4}
                    rx={1}
                  />
                )}
              </g>
            )
          })
        )}

        {/* Active Tooltip Card (Rendered on top of all bars) */}
        {hoveredBar && (() => {
          const { datasetIndex: di, barIndex: bi } = hoveredBar
          const dataset = datasets[di]
          if (!dataset) return null
          const rawValue = dataset.data[bi]
          const value = Number(rawValue) || 0
          const barHeight = maxValue > 0 ? (value / maxValue) * chartHeight : 0
          const barCenterX = paddingLeft + bi * groupWidth + barGroupOffset + di * (barWidth + barGap) + barWidth / 2
          const barTopY = paddingTop + chartHeight - barHeight

          const labelText = labels[bi] || ''
          const valueText = formatFullValue(value)
          const percentText = totalValue > 0 ? `${((value / totalValue) * 100).toFixed(1)}% of total` : ''

          const tooltipWidth = Math.max(105, Math.min(140, labelText.length * 7 + 36))
          const tooltipHeight = percentText ? 52 : 40

          // Smart clamp X position to chart bounds
          let tooltipX = barCenterX - tooltipWidth / 2
          if (tooltipX < paddingLeft) tooltipX = paddingLeft + 4
          if (tooltipX + tooltipWidth > svgWidth - paddingRight) {
            tooltipX = svgWidth - paddingRight - tooltipWidth - 4
          }

          // Smart Y position: above bar if space allows, otherwise below bar top
          let tooltipY = barTopY - tooltipHeight - 8
          if (tooltipY < paddingTop) {
            tooltipY = barTopY + 12
          }

          return (
            <g className="pointer-events-none transition-all duration-150">
              {/* Glassmorphic card body */}
              <rect
                x={tooltipX}
                y={tooltipY}
                width={tooltipWidth}
                height={tooltipHeight}
                rx={7}
                className="fill-gray-900/95 dark:fill-gray-950/95 stroke-white/10"
                strokeWidth={1}
                filter={`url(#bar-shadow-${chartId})`}
              />

              {/* Tooltip Content */}
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
          const x = paddingLeft + i * groupWidth + groupWidth / 2
          const y = paddingTop + chartHeight + 16
          const isSelected = hoveredBar?.barIndex === i
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

        {/* Legend for multiple datasets */}
        {datasetCount > 1 && (
          <g>
            {datasets.map((dataset, di) => {
              const legendX = paddingLeft + di * 120
              const legendY = svgHeight - 6
              const pair = DEFAULT_SERIES_GRADIENTS[di % DEFAULT_SERIES_GRADIENTS.length]
              return (
                <g key={`legend-${di}`} className="select-none">
                  <rect
                    x={legendX}
                    y={legendY - 8}
                    width={12}
                    height={10}
                    fill={pair[0]}
                    rx={3}
                  />
                  <text
                    x={legendX + 16}
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
