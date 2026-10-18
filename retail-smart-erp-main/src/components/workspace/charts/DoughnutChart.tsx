'use client'

import React, { useMemo, useState } from 'react'

const DEFAULT_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ef4444', '#06b6d4', '#f97316', '#ec4899']

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

interface Segment {
  startAngle: number
  endAngle: number
  percentage: number
  value: number
  label: string
  color: string
  index: number
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180
  return {
    x: cx + r * Math.cos(angleRad),
    y: cy + r * Math.sin(angleRad),
  }
}

function describeArc(
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  startAngle: number,
  endAngle: number
): string {
  const outerStart = polarToCartesian(cx, cy, outerR, endAngle)
  const outerEnd = polarToCartesian(cx, cy, outerR, startAngle)
  const innerStart = polarToCartesian(cx, cy, innerR, startAngle)
  const innerEnd = polarToCartesian(cx, cy, innerR, endAngle)
  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerR} ${outerR} 0 ${largeArcFlag} 0 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerStart.x} ${innerStart.y}`,
    `A ${innerR} ${innerR} 0 ${largeArcFlag} 1 ${innerEnd.x} ${innerEnd.y}`,
    'Z',
  ].join(' ')
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function DoughnutChart({ labels, datasets, height = 300, color = 'blue' }: ChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  const dataset = datasets[0]

  const { segments, total } = useMemo(() => {
    if (!dataset || !dataset.data.length) return { segments: [], total: 0 }

    const total = dataset.data.reduce((sum, v) => sum + Math.max(v, 0), 0)
    if (total === 0) return { segments: [], total: 0 }

    const result: Segment[] = []
    let currentAngle = 0

    dataset.data.forEach((value, i) => {
      if (value <= 0) return
      const percentage = (value / total) * 100
      const sliceAngle = (value / total) * 360

      result.push({
        startAngle: currentAngle,
        endAngle: currentAngle + sliceAngle,
        percentage,
        value,
        label: labels[i] || `Item ${i + 1}`,
        color: dataset.colors?.[i] || DEFAULT_COLORS[i % DEFAULT_COLORS.length],
        index: i,
      })

      currentAngle += sliceAngle
    })

    return { segments: result, total }
  }, [dataset, labels])

  if (!labels.length || !datasets.length || segments.length === 0) {
    return (
      <div
        style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        className="text-sm text-gray-400"
      >
        No data available
      </div>
    )
  }

  const svgSize = 300
  const cx = svgSize / 2
  const cy = svgSize / 2
  const outerRadius = 120
  const innerRadius = 72 // ~60% cutout

  const isSingleSegment = segments.length === 1

  const formatTotal = (v: number | undefined | null) => {
    const n = Number(v) || 0
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
    return n.toLocaleString()
  }

  return (
    <div style={{ height, display: 'flex', alignItems: 'center', gap: '16px', justifyContent: 'center' }}>
      {/* Chart */}
      <div style={{ flex: '0 0 auto', width: svgSize, height: svgSize }}>
        <svg
          viewBox={`0 0 ${svgSize} ${svgSize}`}
          width="100%"
          height="100%"
          preserveAspectRatio="xMidYMid meet"
        >
          {isSingleSegment ? (
            <g
              onMouseEnter={() => setHoveredIndex(0)}
              onMouseLeave={() => setHoveredIndex(null)}
              style={{ cursor: 'pointer' }}
            >
              <circle
                cx={cx}
                cy={cy}
                r={(outerRadius + innerRadius) / 2}
                fill="none"
                stroke={segments[0].color}
                strokeWidth={outerRadius - innerRadius}
                style={{
                  transform: hoveredIndex === 0 ? 'scale(1.03)' : 'scale(1)',
                  transformOrigin: `${cx}px ${cy}px`,
                  transition: 'transform 0.2s ease',
                }}
              />
            </g>
          ) : (
            segments.map((seg) => {
              const isHovered = hoveredIndex === seg.index
              const midAngle = (seg.startAngle + seg.endAngle) / 2
              const offset = isHovered ? 5 : 0
              const rad = ((midAngle - 90) * Math.PI) / 180
              const tx = offset * Math.cos(rad)
              const ty = offset * Math.sin(rad)

              return (
                <path
                  key={`segment-${seg.index}`}
                  d={describeArc(cx, cy, outerRadius, innerRadius, seg.startAngle, seg.endAngle)}
                  fill={seg.color}
                  stroke="white"
                  strokeWidth={2}
                  onMouseEnter={() => setHoveredIndex(seg.index)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  style={{
                    cursor: 'pointer',
                    transform: `translate(${tx}px, ${ty}px)`,
                    transition: 'transform 0.2s ease',
                    filter: isHovered ? 'brightness(1.1)' : undefined,
                  }}
                />
              )
            })
          )}

          {/* Center total */}
          <text
            x={cx}
            y={cy - 6}
            textAnchor="middle"
            fill="#6b7280"
            fontSize={11}
            fontWeight={400}
          >
            Total
          </text>
          <text
            x={cx}
            y={cy + 14}
            textAnchor="middle"
            fill="#111827"
            fontSize={18}
            fontWeight={600}
          >
            {formatTotal(total)}
          </text>

          {/* Hovered segment info in center */}
          {hoveredIndex !== null && segments[hoveredIndex] && (
            <>
              <rect
                x={cx - 45}
                y={cy + 24}
                width={90}
                height={18}
                rx={3}
                fill="white"
                opacity={0.9}
              />
              <text
                x={cx}
                y={cy + 37}
                textAnchor="middle"
                fill={segments[hoveredIndex].color}
                fontSize={10}
                fontWeight={500}
              >
                {segments[hoveredIndex].label}: {segments[hoveredIndex].percentage.toFixed(1)}%
              </text>
            </>
          )}
        </svg>
      </div>

      {/* Legend */}
      <div style={{ flex: '0 1 auto', maxHeight: svgSize, overflow: 'auto' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {segments.map((seg) => (
            <div
              key={`legend-${seg.index}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '4px 8px',
                borderRadius: '4px',
                backgroundColor: hoveredIndex === seg.index ? '#f3f4f6' : 'transparent',
                cursor: 'pointer',
                transition: 'background-color 0.15s ease',
              }}
              onMouseEnter={() => setHoveredIndex(seg.index)}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  backgroundColor: seg.color,
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: 12, color: '#374151', whiteSpace: 'nowrap' }}>
                {seg.label}
              </span>
              <span style={{ fontSize: 11, color: '#9ca3af', whiteSpace: 'nowrap' }}>
                {seg.percentage.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
