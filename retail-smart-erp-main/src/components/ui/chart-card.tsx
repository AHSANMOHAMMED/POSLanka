'use client'

import React from 'react'
import { cn } from '@/lib/utils'

export interface ChartCardProps {
  title: string
  subtitle?: string
  badge?: string
  periods?: string[]
  selectedPeriod?: string
  onPeriodChange?: (period: string) => void
  actions?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  className?: string
  loading?: boolean
}

export function ChartCard({
  title,
  subtitle,
  badge,
  periods,
  selectedPeriod,
  onPeriodChange,
  actions,
  children,
  footer,
  className,
  loading = false,
}: ChartCardProps) {
  return (
    <div
      className={cn(
        'bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4',
        className
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-slate-900 dark:text-white text-base sm:text-lg tracking-tight">{title}</h3>
            {badge && (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full theme-badge-primary">
                {badge}
              </span>
            )}
          </div>
          {subtitle && <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          {periods && periods.length > 0 && (
            <div className="inline-flex p-1 bg-slate-100 dark:bg-slate-800/80 rounded-xl text-xs font-semibold">
              {periods.map((p) => {
                const active = selectedPeriod === p
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => onPeriodChange?.(p)}
                    className={cn(
                      'px-2.5 py-1 rounded-lg transition-all',
                      active
                        ? 'theme-btn-primary shadow-sm'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                    )}
                  >
                    {p}
                  </button>
                )
              })}
            </div>
          )}
          {actions}
        </div>
      </div>

      <div className="min-h-[220px] flex items-center justify-center">
        {loading ? (
          <div className="w-full h-56 bg-slate-100 dark:bg-slate-800/50 rounded-xl animate-pulse" />
        ) : (
          <div className="w-full">{children}</div>
        )}
      </div>

      {footer && <div className="pt-3 border-t border-slate-100 dark:border-slate-800 text-xs">{footer}</div>}
    </div>
  )
}

