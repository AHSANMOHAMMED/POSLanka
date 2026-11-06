'use client'

import React from 'react'
import Link from 'next/link'
import { ArrowUpRight, ArrowDownRight, Minus, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface MetricCardProps {
  label: string
  value: string | number
  icon?: LucideIcon
  prefix?: string
  suffix?: string
  trend?: {
    value: string | number
    label?: string
    direction?: 'up' | 'down' | 'neutral'
  }
  sparkline?: number[]
  variant?: 'default' | 'pastel' | 'outline'
  href?: string
  loading?: boolean
  className?: string
  iconColor?: string
}

function MiniSparkline({ data, positive }: { data: number[]; positive?: boolean }) {
  if (!data || data.length < 2) return null
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const points = data
    .map((val, idx) => {
      const x = (idx / (data.length - 1)) * 64
      const y = 24 - ((val - min) / range) * 20 - 2
      return `${x},${y}`
    })
    .join(' ')

  const strokeColor = positive ? '#10b981' : '#f43f5e'

  return (
    <svg className="w-16 h-6 overflow-visible shrink-0" viewBox="0 0 64 24" fill="none">
      <polyline points={points} fill="none" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function MetricCard({
  label,
  value,
  icon: Icon,
  prefix,
  suffix,
  trend,
  sparkline,
  variant = 'default',
  href,
  loading = false,
  className,
  iconColor,
}: MetricCardProps) {
  const content = (
    <div
      className={cn(
        'group relative overflow-hidden p-4 sm:p-5 rounded-2xl transition-all duration-200',
        variant === 'pastel'
          ? 'theme-card-pastel'
          : 'bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm hover:shadow-md hover:border-slate-300 dark:hover:border-slate-700',
        href && 'cursor-pointer hover:-translate-y-0.5',
        className
      )}
    >
      <div className="flex items-start justify-between gap-3 mb-2 sm:mb-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 truncate">
            {label}
          </p>
        </div>
        {Icon && (
          <div
            className={cn(
              'w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-105',
              'theme-icon-container'
            )}
            style={iconColor ? { color: iconColor } : undefined}
          >
            <Icon size={20} strokeWidth={1.8} />
          </div>
        )}
      </div>

      <div className="flex items-baseline justify-between gap-2">
        {loading ? (
          <div className="h-8 w-28 bg-slate-200 dark:bg-slate-800 rounded-lg animate-pulse my-1" />
        ) : (
          <div className="flex items-baseline gap-1">
            {prefix && <span className="text-base sm:text-lg font-semibold text-slate-500 dark:text-slate-400">{prefix}</span>}
            <span className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
              {typeof value === 'number' ? value.toLocaleString() : value}
            </span>
            {suffix && <span className="text-sm font-medium text-slate-500 dark:text-slate-400 ml-0.5">{suffix}</span>}
          </div>
        )}

        {sparkline && !loading && (
          <MiniSparkline data={sparkline} positive={trend ? trend.direction !== 'down' : true} />
        )}
      </div>

      {(trend || loading) && (
        <div className="mt-2.5 sm:mt-3 flex items-center gap-1.5 pt-2 border-t border-slate-100 dark:border-slate-800/80 text-xs">
          {loading ? (
            <div className="h-4 w-20 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
          ) : trend ? (
            <>
              <span
                className={cn(
                  'inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full font-bold text-[11px]',
                  trend.direction === 'up' && 'theme-kpi-up',
                  trend.direction === 'down' && 'theme-kpi-down',
                  (!trend.direction || trend.direction === 'neutral') &&
                    'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                )}
              >
                {trend.direction === 'up' && <ArrowUpRight size={13} strokeWidth={2.5} />}
                {trend.direction === 'down' && <ArrowDownRight size={13} strokeWidth={2.5} />}
                {trend.direction === 'neutral' && <Minus size={13} strokeWidth={2.5} />}
                {trend.value}
              </span>
              {trend.label && <span className="text-slate-500 dark:text-slate-400 truncate">{trend.label}</span>}
            </>
          ) : null}
        </div>
      )}
    </div>
  )

  if (href) {
    return <Link href={href}>{content}</Link>
  }

  return content
}

