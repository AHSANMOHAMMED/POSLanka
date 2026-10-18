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

function buildSmoothPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`

  let path = `M ${points[0].x} ${points[0].y}`

  for (let i = 0; i < points.length - 1; i++) {
    const curr = points[i]
    const next = points[i + 1]
    const prev = points[i - 1] || curr
    const nextNext = points[i + 2] || next

    // Control point tension
    const tension = 0.3

    const cp1x = curr.x + (next.x - prev.x) * tension
    const cp1y = curr.y + (next.y - prev.y) * tension
    const cp2x = next.x - (nextNext.x - curr.x) * tension
    const cp2y = next.y - (nextNext.y - curr.y) * tension

    path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${next.x} ${next.y}`
  }

  return path
}

export default function LineChart({ labels, datasets, height = 300, color = 'blue' }: ChartProps) {
  const [hoveredPoint, setHoveredPoint] = useState<{ datasetIndex: number; pointIndex: number } | null>(null)

  const themeColor = THEME_COLORS[color] || THEME_COLORS.blue

  const { maxValue, yTicks, hasData } = useMemo(() => {
    const allValues = datasets.flatMap(d => d.data)
    if (allValues.length === 0 || allValues.every(v => v === 0)) {
      return { maxValue: 0, yTicks: [0], hasData: false }
    }
    const rawMax = Math.max(...allValues)
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

  const svgWidth = 600
  const svgHeight = 300
  const paddingLeft = 60
  const paddingRight = 20
  const paddingTop = 20
  const paddingBottom = 60
  const chartWidth = svgWidth - paddingLeft - paddingRight
  const chartHeight = svgHeight - paddingTop - paddingBottom

  const pointCount = labels.length
  const xStep = pointCount > 1 ? chartWidth / (pointCount - 1) : chartWidth / 2

  const formatValue = (v: number | undefined | null) => {
    const n = Number(v) || 0
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
    return n.toLocaleString()
  }

  const getPoints = (data: number[]) => {
    return data.map((value, i) => ({
      x: paddingLeft + (pointCount > 1 ? i * xStep : chartWidth / 2),
      y: paddingTop + chartHeight - (maxValue > 0 ? (value / maxValue) * chartHeight : 0),
      value,
    }))
  }

  const shouldRotateLabels = pointCount > 8

  return (
    <div style={{ width: '100%', height }}>
      <svg
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid meet"
        style={{ overflow: 'visible' }}
      >
        <defs>
          {datasets.map((_, di) => {
            const lineColor = datasets.length > 1
              ? DEFAULT_COLORS[di % DEFAULT_COLORS.length]
              : themeColor
            return (
              <linearGradient key={`grad-${di}`} id={`area-gradient-${di}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={lineColor} stopOpacity={0.25} />
                <stop offset="100%" stopColor={lineColor} stopOpacity={0.02} />
              </linearGradient>
            )
          })}
        </defs>

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

        {/* Lines, areas, and dots */}
        {datasets.map((dataset, di) => {
          const points = getPoints(dataset.data)
          const lineColor = datasets.length > 1
            ? DEFAULT_COLORS[di % DEFAULT_COLORS.length]
            : themeColor

          const linePath = buildSmoothPath(points)

          // Build area path: line path + close to bottom
          const areaPath = points.length > 0
            ? `${linePath} L ${points[points.length - 1].x} ${paddingTop + chartHeight} L ${points[0].x} ${paddingTop + chartHeight} Z`
            : ''

          return (
            <g key={`line-${di}`}>
              {/* Area fill */}
              {areaPath && (
                <path
                  d={areaPath}
                  fill={`url(#area-gradient-${di})`}
                  style={{ transition: 'opacity 0.3s ease' }}
                />
              )}

              {/* Line */}
              <path
                d={linePath}
                fill="none"
                stroke={lineColor}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ transition: 'opacity 0.3s ease' }}
              />

              {/* Data points */}
              {points.map((pt, pi) => {
                const isHovered = hoveredPoint?.datasetIndex === di && hoveredPoint?.pointIndex === pi
                return (
                  <g
                    key={`dot-${di}-${pi}`}
                    onMouseEnter={() => setHoveredPoint({ datasetIndex: di, pointIndex: pi })}
                    onMouseLeave={() => setHoveredPoint(null)}
                    style={{ cursor: 'pointer' }}
                  >
                    {/* Invisible larger hit area */}
                    <circle cx={pt.x} cy={pt.y} r={12} fill="transparent" />

                    {/* Visible dot */}
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={isHovered ? 5 : 3.5}
                      fill="white"
                      stroke={lineColor}
                      strokeWidth={2}
                      style={{ transition: 'r 0.15s ease' }}
                    />

                    {/* Tooltip */}
                    {isHovered && (
                      <g>
                        <rect
                          x={pt.x - 35}
                          y={pt.y - 32}
                          width={70}
                          height={22}
                          rx={4}
                          fill="#1f2937"
                        />
                        <text
                          x={pt.x}
                          y={pt.y - 17}
                          textAnchor="middle"
                          fill="white"
                          fontSize={11}
                          fontWeight={500}
                        >
                          {formatValue(pt.value)}
                        </text>
                      </g>
                    )}
                  </g>
                )
              })}
            </g>
          )
        })}

        {/* X-axis labels */}
        {labels.map((label, i) => {
          const x = paddingLeft + (pointCount > 1 ? i * xStep : chartWidth / 2)
          const y = paddingTop + chartHeight + 16
          const truncated = label.length > 12 ? label.slice(0, 11) + '...' : label

          return (
            <text
              key={`label-${i}`}
              x={x}
              y={y}
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
        {datasets.length > 1 && (
          <g>
            {datasets.map((dataset, di) => {
              const legendX = paddingLeft + di * 120
              const legendY = svgHeight - 5
              const legendColor = DEFAULT_COLORS[di % DEFAULT_COLORS.length]
              return (
                <g key={`legend-${di}`}>
                  <line x1={legendX} y1={legendY - 4} x2={legendX + 14} y2={legendY - 4} stroke={legendColor} strokeWidth={2.5} strokeLinecap="round" />
                  <circle cx={legendX + 7} cy={legendY - 4} r={3} fill="white" stroke={legendColor} strokeWidth={2} />
                  <text x={legendX + 20} y={legendY} fill="#6b7280" fontSize={11}>
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
