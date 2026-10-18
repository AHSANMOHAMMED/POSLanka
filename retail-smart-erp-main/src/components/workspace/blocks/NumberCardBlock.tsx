'use client'

import Link from 'next/link'
import type { NumberCardBlock as NumberCardBlockType, MetricValues } from '@/lib/workspace/types'
import { getIcon } from '../icon-map'

const COLOR_CLASSES: Record<string, { bg: string; light: string }> = {
  blue: { bg: 'bg-gradient-to-br from-blue-500 to-blue-600', light: 'bg-blue-400/20' },
  green: { bg: 'bg-gradient-to-br from-green-500 to-green-600', light: 'bg-green-400/20' },
  red: { bg: 'bg-gradient-to-br from-red-500 to-red-600', light: 'bg-red-400/20' },
  purple: { bg: 'bg-gradient-to-br from-violet-500 to-purple-600', light: 'bg-violet-400/20' },
  amber: { bg: 'bg-gradient-to-br from-amber-500 to-amber-600', light: 'bg-amber-400/20' },
  orange: { bg: 'bg-gradient-to-br from-orange-500 to-orange-600', light: 'bg-orange-400/20' },
  violet: { bg: 'bg-gradient-to-br from-violet-500 to-violet-600', light: 'bg-violet-400/20' },
  emerald: { bg: 'bg-gradient-to-br from-emerald-500 to-emerald-600', light: 'bg-emerald-400/20' },
  slate: { bg: 'bg-gradient-to-br from-slate-500 to-slate-600', light: 'bg-slate-400/20' },
}

interface NumberCardBlockProps {
  block: NumberCardBlockType
  metrics: MetricValues
  loading: boolean
}

export function NumberCardBlock({ block, metrics, loading }: NumberCardBlockProps) {
  const { label, metricKey, color, href, icon, prefix } = block.data
  const Icon = getIcon(icon)
  const colors = COLOR_CLASSES[color] || COLOR_CLASSES.blue
  const rawValue = metrics[metricKey]?.value
  const value = typeof rawValue === 'number' ? rawValue : undefined

  return (
    <Link
      href={href}
      className={`flex items-center gap-3 px-4 py-3 ${colors.bg} rounded-md hover:opacity-90 transition-all hover:shadow-md text-white min-w-0 w-full`}
    >
      <div className={`w-10 h-10 ${colors.light} rounded flex items-center justify-center flex-shrink-0`}>
        {/* eslint-disable-next-line react-hooks/static-components */}
        <Icon className="w-5 h-5 text-white" strokeWidth={1.5} />
      </div>
      <div className="min-w-0">
        {loading ? (
          <div className="h-7 w-14 bg-white/20 rounded animate-pulse" />
        ) : (
          <p className="text-xl font-bold truncate">
            {prefix && <span className="text-base font-semibold mr-1">{prefix}</span>}
            {value !== undefined ? value.toLocaleString() : '-'}
          </p>
        )}
        <p className="text-[11px] text-white/80 font-medium truncate">{label}</p>
      </div>
    </Link>
  )
}
