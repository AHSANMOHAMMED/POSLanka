'use client'

import React, { useMemo, useState } from 'react'

const DEFAULT_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ef4444', '#06b6d4', '#f97316', '#ec4899']

const THEME_COLORS: Record<string, string> = {
  blue: '#3b82f6',
  green: '#22c55e',
  violet: '#8b5cf6',
  amber: '#f59e0b',
  emerald: '#10b981',
  red: '#ef4444',
  purple: '#a855f7',
  slate: '#64748b',
}

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
  const [hoveredBar, setHoveredBar] = useState<{ datasetIndex: number; barIndex: number } | null>(null)

  const themeColor = THEME_COLORS[color] || THEME_COLORS.blue

  const { maxValue, yTicks, hasData } = useMemo(() => {
    const allValues = datasets.flatMap(d => d.data.map(v => Number(v) || 0))
    if (allValues.length === 0 || allValues.every(v => v === 0)) {
      return { maxValue: 0, yTicks: [0], hasData: false }
    }
    const rawMax = Math.max(...allValues)
    // Round up to a nice number
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawMax || 1)))
    const niceMax = Math.ceil(rawMax / magnitude) * magnitude || 1
    const tickCount = 5
    const ticks: number[] = []
    for (let i = 0; i <= tickCount; i++) {
      ticks.push(Math.round((niceMax / tickCount) * i))
    }
    return { maxValue: niceMax, yTicks: ticks, hasData: true }
  }, [datasets])

  if (!labels.length || !datasets.length || !hasData) {
    return (
      <div
        style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        className="text-sm text-gray-400"
      >
        No data available
      </div>
    )
  }

  // Layout constants
  const svgWidth = 600
  const svgHeight = 300
  const paddingLeft = 60
  const paddingRight = 20
  const paddingTop = 20
  const paddingBottom = 60
  const chartWidth = svgWidth - paddingLeft - paddingRight
  const chartHeight = svgHeight - paddingTop - paddingBottom

  const datasetCount = datasets.length
  const groupCount = labels.length
  const groupWidth = chartWidth / groupCount
  const groupPadding = groupWidth * 0.2
  const barAreaWidth = groupWidth - groupPadding
  const barWidth = Math.min(barAreaWidth / datasetCount, 60)
  const barGap = datasetCount > 1 ? Math.max((barAreaWidth - barWidth * datasetCount) / (datasetCount - 1), 2) : 0
  const totalBarsWidth = barWidth * datasetCount + barGap * (datasetCount - 1)
  const barGroupOffset = (groupWidth - totalBarsWidth) / 2

  const shouldRotateLabels = groupCount > 6

  const formatValue = (v: number | undefined | null) => {
    const n = Number(v) || 0
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
    return n.toLocaleString()
  }

  return (
    <div style={{ width: '100%', height }}>
      <svg
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid meet"
        style={{ overflow: 'visible' }}
      >
        {/* Gridlines */}
        {yTicks.map((tick) => {
          const y = paddingTop + chartHeight - (tick / maxValue) * chartHeight
          return (
            <g key={`grid-${tick}`}>
              <line
                x1={paddingLeft}
                y1={y}
                x2={svgWidth - paddingRight}
                y2={y}
                stroke="#e5e7eb"
                strokeWidth={1}
                strokeDasharray={tick === 0 ? undefined : '4,4'}
              />
              <text
                x={paddingLeft - 8}
                y={y + 4}
                textAnchor="end"
                fill="#9ca3af"
                fontSize={11}
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
          stroke="#d1d5db"
          strokeWidth={1}
        />

        {/* Bars */}
        {datasets.map((dataset, di) =>
          dataset.data.map((rawValue, bi) => {
            const value = Number(rawValue) || 0
            const barHeight = maxValue > 0 ? (value / maxValue) * chartHeight : 0
            const x = paddingLeft + bi * groupWidth + barGroupOffset + di * (barWidth + barGap)
            const y = paddingTop + chartHeight - barHeight
            const barColor = dataset.colors?.[bi]
              || (datasetCount > 1 ? DEFAULT_COLORS[di % DEFAULT_COLORS.length] : themeColor)
            const isHovered = hoveredBar?.datasetIndex === di && hoveredBar?.barIndex === bi
            const opacity = hoveredBar === null ? 1 : isHovered ? 1 : 0.5

            return (
              <g
                key={`bar-${di}-${bi}`}
                onMouseEnter={() => setHoveredBar({ datasetIndex: di, barIndex: bi })}
                onMouseLeave={() => setHoveredBar(null)}
                style={{ cursor: 'pointer' }}
              >
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={Math.max(barHeight, 0)}
                  fill={barColor}
                  rx={2}
                  ry={2}
                  opacity={opacity}
                  style={{
                    transition: 'height 0.4s ease, y 0.4s ease, opacity 0.2s ease',
                  }}
                />
                {isHovered && (
                  <g>
                    <rect
                      x={x + barWidth / 2 - 30}
                      y={y - 28}
                      width={60}
                      height={22}
                      rx={4}
                      fill="#1f2937"
                    />
                    <text
                      x={x + barWidth / 2}
                      y={y - 13}
                      textAnchor="middle"
                      fill="white"
                      fontSize={11}
                      fontWeight={500}
                    >
                      {formatValue(value)}
                    </text>
                  </g>
                )}
              </g>
            )
          })
        )}

        {/* X-axis labels */}
        {labels.map((label, i) => {
          const x = paddingLeft + i * groupWidth + groupWidth / 2
          const y = paddingTop + chartHeight + 16
          const truncated = label.length > 12 ? label.slice(0, 11) + '...' : label

          return (
            <text
              key={`label-${i}`}
              x={shouldRotateLabels ? x : x}
              y={shouldRotateLabels ? y : y}
              textAnchor={shouldRotateLabels ? 'end' : 'middle'}
              fill="#6b7280"
              fontSize={11}
              transform={shouldRotateLabels ? `rotate(-35, ${x}, ${y})` : undefined}
            >
              {truncated}
            </text>
          )
        })}

        {/* Legend (for multiple datasets) */}
        {datasetCount > 1 && (
          <g>
            {datasets.map((dataset, di) => {
              const legendX = paddingLeft + di * 120
              const legendY = svgHeight - 5
              const legendColor = DEFAULT_COLORS[di % DEFAULT_COLORS.length]
              return (
                <g key={`legend-${di}`}>
                  <rect x={legendX} y={legendY - 8} width={10} height={10} fill={legendColor} rx={2} />
                  <text x={legendX + 14} y={legendY} fill="#6b7280" fontSize={11}>
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
