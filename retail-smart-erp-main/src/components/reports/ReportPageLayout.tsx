'use client'

import { ReactNode } from 'react'
import Link from 'next/link'
import { Home, ChevronRight, Loader2 } from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { ReportExportButton } from './ReportExportButton'
import { SaveReportButton } from './SaveReportButton'
import type { ExportColumn } from '@/lib/reports/export'

interface ReportPageLayoutProps {
  title: string
  breadcrumbs?: { label: string; href?: string }[]
  // Filter bar
  filterBar: ReactNode
  // Optional summary cards row
  summaryCards?: ReactNode
  // Optional chart area
  chart?: ReactNode
  // Main table/content area
  children: ReactNode
  // Export config
  exportData?: Record<string, unknown>[]
  exportColumns?: ExportColumn[]
  exportName?: string
  // Save report config
  reportType?: string
  currentFilters?: Record<string, unknown>
  // State
  loading?: boolean
  hasData?: boolean
  emptyIcon?: ReactNode
  emptyMessage?: string
  // Generate button handler
  onGenerate?: () => void
  generateLabel?: string
  generateIcon?: ReactNode
}

export function ReportPageLayout({
  title,
  breadcrumbs,
  filterBar,
  summaryCards,
  chart,
  children,
  exportData,
  exportColumns,
  exportName,
  reportType,
  currentFilters,
  loading,
  hasData,
  emptyIcon,
  emptyMessage = 'Select filters and click Generate to view the report.',
}: ReportPageLayoutProps) {
  const { tenantSlug } = useCompany()

  const defaultBreadcrumbs = [
    { label: 'Accounting', href: `/c/${tenantSlug}/accounting` },
    { label: 'Reports' },
  ]

  const crumbs = breadcrumbs || defaultBreadcrumbs

  return (
    <div className="space-y-4 p-4 max-w-7xl mx-auto">
      {/* Breadcrumb */}
      <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
        <Link href={`/c/${tenantSlug}/dashboard`} className="hover:text-blue-600 dark:hover:text-blue-400">
          <Home size={14} />
        </Link>
        {crumbs.map((crumb, i) => (
          <span key={i} className="flex items-center gap-2">
            <ChevronRight size={14} />
            {crumb.href ? (
              <Link href={crumb.href} className="hover:text-blue-600 dark:hover:text-blue-400">
                {crumb.label}
              </Link>
            ) : (
              <span className="text-gray-900 dark:text-white font-medium">{crumb.label}</span>
            )}
          </span>
        ))}
        <ChevronRight size={14} />
        <span className="text-gray-900 dark:text-white font-medium">{title}</span>
      </div>

      {/* Title + Export + Save */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">{title}</h1>
        <div className="flex items-center gap-2">
          {reportType && currentFilters && hasData && (
            <SaveReportButton reportType={reportType} currentFilters={currentFilters} />
          )}
          {exportData && exportColumns && exportName && (
            <ReportExportButton
              data={exportData}
              columns={exportColumns}
              reportName={exportName}
              printElementId="report-content"
            />
          )}
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4">
        {filterBar}
      </div>

      {/* Loading */}
      {loading && (
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-12 text-center">
          <Loader2 size={32} className="mx-auto mb-3 text-blue-500 animate-spin" />
          <p className="text-gray-500 dark:text-gray-400">Generating report...</p>
        </div>
      )}

      {/* Report Content */}
      {!loading && hasData && (
        <div id="report-content" className="space-y-4">
          {/* Summary Cards */}
          {summaryCards && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {summaryCards}
            </div>
          )}

          {/* Chart */}
          {chart && (
            <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4">
              {chart}
            </div>
          )}

          {/* Main Table Content */}
          {children}
        </div>
      )}

      {/* Empty state */}
      {!loading && !hasData && (
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-12 text-center">
          {emptyIcon && <div className="mx-auto mb-3 text-gray-300 dark:text-gray-600">{emptyIcon}</div>}
          <p className="text-gray-500 dark:text-gray-400">{emptyMessage}</p>
        </div>
      )}
    </div>
  )
}

export function SummaryCard({
  label,
  value,
  color = 'blue',
}: {
  label: string
  value: string | number
  color?: 'blue' | 'green' | 'red' | 'amber' | 'purple'
}) {
  const colorMap = {
    blue: 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300',
    green: 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300',
    red: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300',
    amber: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300',
    purple: 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300',
  }

  return (
    <div className={`rounded border dark:border-gray-700 p-4 ${colorMap[color]}`}>
      <p className="text-sm font-medium opacity-80">{label}</p>
      <p className="text-xl font-bold font-mono tabular-nums mt-1">{value}</p>
    </div>
  )
}
