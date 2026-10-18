'use client'

import * as React from 'react'
import Link from 'next/link'
import { ChevronRight, ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { StatusBadge } from './badge'

// ============================================
// BREADCRUMB COMPONENT
// ============================================

export interface BreadcrumbItem {
  label: string
  href?: string
}

export interface BreadcrumbProps {
  items: BreadcrumbItem[]
  className?: string
}

export function Breadcrumb({ items, className }: BreadcrumbProps) {
  return (
    <nav className={cn('flex items-center gap-1 text-sm', className)} aria-label="Breadcrumb">
      {items.map((item, index) => (
        <React.Fragment key={index}>
          {index > 0 && (
            <ChevronRight size={14} className="text-gray-400" aria-hidden="true" />
          )}
          {item.href ? (
            <Link
              href={item.href}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              {item.label}
            </Link>
          ) : (
            <span className="text-gray-900 dark:text-white font-medium">
              {item.label}
            </span>
          )}
        </React.Fragment>
      ))}
    </nav>
  )
}

// ============================================
// PAGE HEADER COMPONENT
// ============================================

export interface PageHeaderProps {
  title: string
  subtitle?: string
  status?: string
  backHref?: string
  backLabel?: string
  breadcrumbs?: BreadcrumbItem[]
  actions?: React.ReactNode
  tabs?: React.ReactNode
  className?: string
  children?: React.ReactNode
}

export function PageHeader({
  title,
  subtitle,
  status,
  backHref,
  backLabel = 'Back',
  breadcrumbs,
  actions,
  tabs,
  className,
  children,
}: PageHeaderProps) {
  return (
    <div className={cn('mb-6', className)}>
      {/* Breadcrumbs */}
      {breadcrumbs && breadcrumbs.length > 0 && (
        <Breadcrumb items={breadcrumbs} className="mb-2" />
      )}

      {/* Back link */}
      {backHref && !breadcrumbs && (
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 mb-2"
        >
          <ArrowLeft size={16} />
          {backLabel}
        </Link>
      )}

      {/* Main header row */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white truncate">
              {title}
            </h1>
            {status && <StatusBadge status={status} />}
          </div>
          {subtitle && (
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {subtitle}
            </p>
          )}
        </div>

        {/* Actions */}
        {actions && (
          <div className="flex items-center gap-2 flex-shrink-0">
            {actions}
          </div>
        )}
      </div>

      {/* Tabs */}
      {tabs && <div className="mt-4">{tabs}</div>}

      {/* Additional content */}
      {children && <div className="mt-4">{children}</div>}
    </div>
  )
}

// ============================================
// PAGE TABS COMPONENT
// ============================================

export interface PageTab {
  id: string
  label: string
  count?: number
  icon?: React.ReactNode
}

export interface PageTabsProps {
  tabs: PageTab[]
  activeTab: string
  onTabChange: (tabId: string) => void
  className?: string
}

export function PageTabs({ tabs, activeTab, onTabChange, className }: PageTabsProps) {
  return (
    <div className={cn('border-b border-gray-200 dark:border-gray-700', className)}>
      <nav className="flex gap-4" aria-label="Tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={cn(
              'relative py-2 px-1 text-sm font-medium transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
              activeTab === tab.id
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            )}
          >
            <span className="flex items-center gap-2">
              {tab.icon}
              {tab.label}
              {tab.count !== undefined && (
                <span
                  className={cn(
                    'px-1.5 py-0.5 text-xs rounded-full',
                    activeTab === tab.id
                      ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                      : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                  )}
                >
                  {tab.count}
                </span>
              )}
            </span>
            {/* Active indicator */}
            {activeTab === tab.id && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 dark:bg-blue-400" />
            )}
          </button>
        ))}
      </nav>
    </div>
  )
}

// ============================================
// LIST PAGE HEADER COMPONENT
// ============================================

export interface ListPageHeaderProps {
  title: string
  subtitle?: string
  count?: number
  actions?: React.ReactNode
  className?: string
}

export function ListPageHeader({
  title,
  subtitle,
  count,
  actions,
  className,
}: ListPageHeaderProps) {
  return (
    <div className={cn('flex items-center justify-between mb-6', className)}>
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
            {title}
          </h1>
          {count !== undefined && (
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
              {count}
            </span>
          )}
        </div>
        {subtitle && (
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2">
          {actions}
        </div>
      )}
    </div>
  )
}

// ============================================
// DETAIL PAGE HEADER COMPONENT
// ============================================

export interface DetailPageHeaderProps {
  title: string
  subtitle?: string
  status?: string
  backHref: string
  backLabel?: string
  actions?: React.ReactNode
  metadata?: React.ReactNode
  className?: string
}

export function DetailPageHeader({
  title,
  subtitle,
  status,
  backHref,
  backLabel = 'Back to list',
  actions,
  metadata,
  className,
}: DetailPageHeaderProps) {
  return (
    <div className={cn('mb-6', className)}>
      {/* Back link */}
      <Link
        href={backHref}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 mb-3"
      >
        <ArrowLeft size={16} />
        {backLabel}
      </Link>

      {/* Main header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
              {title}
            </h1>
            {status && <StatusBadge status={status} />}
          </div>
          {subtitle && (
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {subtitle}
            </p>
          )}
          {metadata && (
            <div className="mt-2 flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
              {metadata}
            </div>
          )}
        </div>

        {/* Actions */}
        {actions && (
          <div className="flex items-center gap-2 flex-shrink-0">
            {actions}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================
// FILTER BAR COMPONENT
// ============================================

export interface FilterBarProps {
  children: React.ReactNode
  className?: string
}

export function FilterBar({ children, className }: FilterBarProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3 p-4 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 mb-4',
        className
      )}
    >
      {children}
    </div>
  )
}

// ============================================
// FILTER BUTTON GROUP COMPONENT
// ============================================

export interface FilterOption {
  id: string
  label: string
  count?: number
}

export interface FilterButtonGroupProps {
  options: FilterOption[]
  value: string
  onChange: (value: string) => void
  className?: string
}

export function FilterButtonGroup({
  options,
  value,
  onChange,
  className,
}: FilterButtonGroupProps) {
  return (
    <div className={cn('inline-flex rounded border border-gray-200 dark:border-gray-700 p-0.5', className)}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className={cn(
            'px-3 py-1 text-sm font-medium rounded-md transition-colors',
            value === option.id
              ? 'bg-blue-600 text-white'
              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
          )}
        >
          {option.label}
          {option.count !== undefined && (
            <span
              className={cn(
                'ml-1.5',
                value === option.id
                  ? 'text-blue-200'
                  : 'text-gray-400 dark:text-gray-500'
              )}
            >
              ({option.count})
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

// ============================================
// SEARCH INPUT COMPONENT
// ============================================

export interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search...',
  className,
}: SearchInputProps) {
  return (
    <div className={cn('relative', className)}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
      />
      <svg
        className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
        />
      </svg>
    </div>
  )
}
