'use client'

import * as React from 'react'
import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

// ============================================
// SECTION CARD COMPONENT
// ============================================

export interface SectionCardProps {
  title: string
  icon?: React.ReactNode
  children: React.ReactNode
  collapsible?: boolean
  defaultCollapsed?: boolean
  actions?: React.ReactNode
  className?: string
  contentClassName?: string
  headerClassName?: string
  noPadding?: boolean
}

export function SectionCard({
  title,
  icon,
  children,
  collapsible = false,
  defaultCollapsed = false,
  actions,
  className,
  contentClassName,
  headerClassName,
  noPadding = false,
}: SectionCardProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed)

  return (
    <div
      className={cn(
        'bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 shadow-sm',
        className
      )}
    >
      {/* Header */}
      <div
        className={cn(
          'flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-700',
          collapsible && 'cursor-pointer select-none hover:bg-gray-50 dark:hover:bg-gray-700/50',
          headerClassName
        )}
        onClick={collapsible ? () => setIsCollapsed(!isCollapsed) : undefined}
      >
        <div className="flex items-center gap-2">
          {collapsible && (
            <span className="text-gray-400">
              {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
            </span>
          )}
          {icon && <span className="text-gray-500 dark:text-gray-400">{icon}</span>}
          <h3 className="font-medium text-gray-900 dark:text-white">{title}</h3>
        </div>
        {actions && (
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            {actions}
          </div>
        )}
      </div>

      {/* Content */}
      {!isCollapsed && (
        <div className={cn(!noPadding && 'p-3', contentClassName)}>
          {children}
        </div>
      )}
    </div>
  )
}

// ============================================
// FIELD DISPLAY COMPONENT
// ============================================

export interface FieldProps {
  label: string
  value?: React.ReactNode
  className?: string
  labelClassName?: string
  valueClassName?: string
  icon?: React.ReactNode
  href?: string
  onClick?: () => void
  copyable?: boolean
}

export function Field({
  label,
  value,
  className,
  labelClassName,
  valueClassName,
  icon,
  href,
  onClick,
  copyable,
}: FieldProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    if (value && typeof value === 'string') {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const renderValue = () => {
    if (!value && value !== 0) {
      return <span className="text-gray-400 dark:text-gray-500">-</span>
    }

    if (href) {
      return (
        <a
          href={href}
          className="text-[var(--primary)] hover:opacity-80 hover:underline"
        >
          {value}
        </a>
      )
    }

    if (onClick) {
      return (
        <button
          type="button"
          onClick={onClick}
          className="text-[var(--primary)] hover:opacity-80 hover:underline text-left"
        >
          {value}
        </button>
      )
    }

    return <>{value}</>
  }

  return (
    <div className={cn('space-y-0.5', className)}>
      <dt
        className={cn(
          'text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide',
          labelClassName
        )}
      >
        {label}
      </dt>
      <dd
        className={cn(
          'text-sm text-gray-900 dark:text-white flex items-center gap-2',
          valueClassName
        )}
      >
        {icon && <span className="text-gray-400">{icon}</span>}
        {renderValue()}
        {copyable && value && typeof value === 'string' && (
          <button
            type="button"
            onClick={handleCopy}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-0.5"
            title="Copy to clipboard"
          >
            {copied ? (
              <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            )}
          </button>
        )}
      </dd>
    </div>
  )
}

// ============================================
// FIELD GRID COMPONENT
// ============================================

export interface FieldGridProps {
  children: React.ReactNode
  columns?: 1 | 2 | 3 | 4
  className?: string
}

export function FieldGrid({ children, columns = 2, className }: FieldGridProps) {
  const columnClasses = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
  }

  return (
    <dl className={cn('grid gap-3', columnClasses[columns], className)}>
      {children}
    </dl>
  )
}

// ============================================
// INFO CARD COMPONENT
// ============================================

export interface InfoCardProps {
  title: string
  value: React.ReactNode
  subtitle?: string
  icon?: React.ReactNode
  trend?: {
    value: number
    label?: string
  }
  className?: string
}

export function InfoCard({
  title,
  value,
  subtitle,
  icon,
  trend,
  className,
}: InfoCardProps) {
  return (
    <div
      className={cn(
        'bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4',
        className
      )}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
            {title}
          </p>
          <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">
            {value}
          </p>
          {subtitle && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {subtitle}
            </p>
          )}
          {trend && (
            <p
              className={cn(
                'mt-1 text-xs font-medium flex items-center gap-1',
                trend.value >= 0
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-red-600 dark:text-red-400'
              )}
            >
              {trend.value >= 0 ? (
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
              ) : (
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
              )}
              {Math.abs(trend.value)}%{trend.label && ` ${trend.label}`}
            </p>
          )}
        </div>
        {icon && (
          <div className="p-2 bg-gray-100 dark:bg-gray-700 rounded text-gray-600 dark:text-gray-400">
            {icon}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================
// EMPTY STATE COMPONENT
// ============================================

export interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center py-12 px-4 text-center',
        className
      )}
    >
      {icon && (
        <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4 text-gray-400">
          {icon}
        </div>
      )}
      <h3 className="text-sm font-medium text-gray-900 dark:text-white">
        {title}
      </h3>
      {description && (
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 max-w-sm">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

// ============================================
// STAT CARD COMPONENT (Dashboard)
// ============================================

export interface StatCardProps {
  label: string
  value: string | number
  icon?: React.ReactNode
  change?: {
    value: number
    type: 'increase' | 'decrease'
  }
  className?: string
}

export function StatCard({ label, value, icon, change, className }: StatCardProps) {
  return (
    <div
      className={cn(
        'bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4',
        className
      )}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{label}</p>
        {icon && (
          <span className="text-gray-400 dark:text-gray-500">{icon}</span>
        )}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <p className="text-2xl font-semibold text-gray-900 dark:text-white">{value}</p>
        {change && (
          <span
            className={cn(
              'text-xs font-medium',
              change.type === 'increase'
                ? 'text-green-600 dark:text-green-400'
                : 'text-red-600 dark:text-red-400'
            )}
          >
            {change.type === 'increase' ? '+' : '-'}
            {Math.abs(change.value)}%
          </span>
        )}
      </div>
    </div>
  )
}
