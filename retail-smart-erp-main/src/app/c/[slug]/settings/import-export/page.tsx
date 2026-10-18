'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  Home, ChevronRight, Download, Upload, FileSpreadsheet,
  ArrowDownToLine, ArrowUpFromLine, Clock, CheckCircle2, AlertTriangle,
} from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { ExportDialog } from '@/components/import-export/ExportDialog'
import { ImportWizard } from '@/components/import-export/ImportWizard'
import { useExport } from '@/hooks/useExport'
import { useImport } from '@/hooks/useImport'
import { getImportableEntities, getExportableEntities } from '@/lib/import-export/entity-config'
import { useRealtimeData } from '@/hooks'

interface ActivityLog {
  id: string
  action: string
  entityType: string
  description: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
  userName?: string
}

const entityIcons: Record<string, string> = {
  items: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
  customers: 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400',
  suppliers: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400',
  categories: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
  vehicles: 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-600 dark:text-cyan-400',
  'service-types': 'bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400',
  sales: 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400',
  purchases: 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400',
  'purchase-orders': 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400',
  'sales-orders': 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400',
  'work-orders': 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400',
  'stock-movements': 'bg-gray-100 dark:bg-gray-900/30 text-gray-600 dark:text-gray-400',
  appointments: 'bg-pink-100 dark:bg-pink-900/30 text-pink-600 dark:text-pink-400',
  'activity-logs': 'bg-slate-100 dark:bg-slate-900/30 text-slate-600 dark:text-slate-400',
  'restaurant-orders': 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
  'waste-log': 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400',
  refunds: 'bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400',
}

export default function ImportExportSettingsPage() {
  const { tenantSlug } = useCompany()
  const { showExportDialog, openExport, closeExport } = useExport()
  const { showImportWizard, openImport, closeImport } = useImport()
  const [exportEntity, setExportEntity] = useState('')
  const [recentActivity, setRecentActivity] = useState<ActivityLog[]>([])
  const [loadingActivity, setLoadingActivity] = useState(true)

  const importableEntities = getImportableEntities()
  const exportableEntities = getExportableEntities()

  const fetchActivity = useCallback(async () => {
    try {
      const res = await fetch('/api/activity-logs?action=import,export&limit=20')
      if (res.ok) {
        const data = await res.json()
        setRecentActivity(data.data || data || [])
      }
    } catch {
      // Silent fail
    } finally {
      setLoadingActivity(false)
    }
  }, [])

  useEffect(() => {
    fetchActivity()
  }, [fetchActivity])

  useRealtimeData(fetchActivity, { entityType: 'item' })

  function handleExport(entity: string) {
    setExportEntity(entity)
    openExport()
  }

  function handleTemplateDownload(entity: string, format: 'csv' | 'xlsx') {
    window.open(`/api/export/template?entity=${entity}&format=${format}`, '_blank')
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
        <Link href={`/c/${tenantSlug}`} className="hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
          <Home size={14} />
        </Link>
        <ChevronRight size={14} />
        <Link href={`/c/${tenantSlug}/settings`} className="hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
          Settings
        </Link>
        <ChevronRight size={14} />
        <span className="text-gray-900 dark:text-white font-medium">Import / Export</span>
      </nav>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Import / Export Data</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Bulk import data from CSV/Excel files or export your data for backup and analysis
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openImport}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            <Upload size={16} />
            Import Data
          </button>
          <button
            onClick={() => handleExport('')}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700 transition-colors"
          >
            <Download size={16} />
            Export Data
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Import Section */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded">
          <div className="p-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-green-100 dark:bg-green-900/30 rounded">
                <ArrowUpFromLine size={18} className="text-green-600 dark:text-green-400" />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900 dark:text-white">Import Data</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">Upload CSV or Excel files to create/update records</p>
              </div>
            </div>
          </div>
          <div className="p-4 space-y-3">
            {importableEntities.map((entity) => (
              <div
                key={entity.name}
                className="flex items-center justify-between p-3 rounded border border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className={`p-1.5 rounded ${entityIcons[entity.name] || 'bg-gray-100 text-gray-600'}`}>
                    <FileSpreadsheet size={16} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{entity.label}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {entity.fields.filter(f => !f.exportOnly).length} importable fields
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleTemplateDownload(entity.name, 'xlsx')}
                    className="px-2 py-1 text-xs text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                    title="Download Excel template"
                  >
                    XLSX
                  </button>
                  <button
                    onClick={() => handleTemplateDownload(entity.name, 'csv')}
                    className="px-2 py-1 text-xs text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                    title="Download CSV template"
                  >
                    CSV
                  </button>
                  <button
                    onClick={openImport}
                    className="px-2.5 py-1 text-xs font-medium text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors"
                  >
                    Import
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Export Section */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded">
          <div className="p-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-blue-100 dark:bg-blue-900/30 rounded">
                <ArrowDownToLine size={18} className="text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900 dark:text-white">Export Data</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">Download your data as CSV or Excel files</p>
              </div>
            </div>
          </div>
          <div className="p-4 space-y-3 list-container-lg overflow-y-auto">
            {exportableEntities.map((entity) => (
              <div
                key={entity.name}
                className="flex items-center justify-between p-3 rounded border border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className={`p-1.5 rounded ${entityIcons[entity.name] || 'bg-gray-100 text-gray-600'}`}>
                    <FileSpreadsheet size={16} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{entity.label}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {entity.fields.filter(f => !f.importOnly).length} fields
                      {entity.children && entity.children.length > 0 && (
                        <span className="ml-1 text-blue-500">+ line items</span>
                      )}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleExport(entity.name)}
                  className="px-2.5 py-1 text-xs font-medium text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
                >
                  Export
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-gray-100 dark:bg-gray-700 rounded">
              <Clock size={18} className="text-gray-600 dark:text-gray-400" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-white">Recent Activity</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">Last 20 import/export operations</p>
            </div>
          </div>
        </div>
        <div className="divide-y divide-gray-100 dark:divide-gray-700">
          {loadingActivity ? (
            <div className="p-8 text-center text-gray-500 dark:text-gray-400 text-sm">Loading activity...</div>
          ) : recentActivity.length === 0 ? (
            <div className="p-8 text-center">
              <FileSpreadsheet size={32} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
              <p className="text-sm text-gray-500 dark:text-gray-400">No import/export activity yet</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Activity will appear here after your first import or export</p>
            </div>
          ) : (
            recentActivity.map((log) => (
              <div key={log.id} className="px-4 py-3 flex items-center gap-3">
                <div className={`p-1.5 rounded ${
                  log.action === 'import'
                    ? 'bg-green-100 dark:bg-green-900/30'
                    : 'bg-blue-100 dark:bg-blue-900/30'
                }`}>
                  {log.action === 'import' ? (
                    <ArrowUpFromLine size={14} className="text-green-600 dark:text-green-400" />
                  ) : (
                    <ArrowDownToLine size={14} className="text-blue-600 dark:text-blue-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-900 dark:text-white truncate">
                    {log.description || `${log.action === 'import' ? 'Imported' : 'Exported'} ${log.entityType}`}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                    <span>{new Date(log.createdAt).toLocaleDateString()}</span>
                    <span>{new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    {log.metadata && (
                      <>
                        {(log.metadata as Record<string, unknown>).format && (
                          <span className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-[10px] uppercase">
                            {String((log.metadata as Record<string, unknown>).format)}
                          </span>
                        )}
                        {(log.metadata as Record<string, unknown>).imported !== undefined && (
                          <span className="flex items-center gap-0.5">
                            <CheckCircle2 size={10} className="text-green-500" />
                            {String((log.metadata as Record<string, unknown>).imported)}
                          </span>
                        )}
                        {(log.metadata as Record<string, unknown>).skipped !== undefined && Number((log.metadata as Record<string, unknown>).skipped) > 0 && (
                          <span className="flex items-center gap-0.5">
                            <AlertTriangle size={10} className="text-yellow-500" />
                            {String((log.metadata as Record<string, unknown>).skipped)} skipped
                          </span>
                        )}
                        {(log.metadata as Record<string, unknown>).rowCount !== undefined && (
                          <span>{String((log.metadata as Record<string, unknown>).rowCount)} rows</span>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Export Dialog */}
      <ExportDialog
        isOpen={showExportDialog}
        onClose={closeExport}
        entity={exportEntity || 'items'}
        currentFilters={{}}
      />

      {/* Import Wizard */}
      <ImportWizard
        isOpen={showImportWizard}
        onClose={closeImport}
        onComplete={fetchActivity}
      />
    </div>
  )
}
