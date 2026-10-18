'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { usePaginatedData, useRealtimeData } from '@/hooks'
import { Pagination } from '@/components/ui/pagination'
import { toast } from '@/components/ui/toast'
import {
  ShieldCheck, Play, Loader2, AlertTriangle, AlertCircle, Info,
  CheckCircle, ChevronRight, Home, X, RefreshCw, Trash2, Clock,
  ShoppingCart, Package, BookOpen, Truck, Users,
  Building2, Wrench, CreditCard, Gift, Monitor,
} from 'lucide-react'
import Link from 'next/link'
import { useCompany } from '@/components/providers/CompanyContextProvider'

interface AuditAlert {
  id: string
  type: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  title: string
  message: string
  entityType: string | null
  entityId: string | null
  metadata: { auditCategory?: string; auditId?: string } | null
  dismissedAt: string | null
  createdAt: string
}

interface AuditProgress {
  status: 'idle' | 'running' | 'completed' | 'error'
  currentCategory: string | null
  completedCategories: number
  totalCategories: number
  totalFindings: number
  startedAt: string | null
  completedAt: string | null
  error?: string
}

interface CategoryCount {
  category: string
  count: number
}

const CATEGORIES = [
  { key: 'sales', label: 'Sales', icon: ShoppingCart, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20' },
  { key: 'purchases', label: 'Purchases', icon: Truck, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
  { key: 'stock', label: 'Stock', icon: Package, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/20' },
  { key: 'accounting', label: 'Accounting', icon: BookOpen, color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-900/20' },
  { key: 'customers', label: 'Customers', icon: Users, color: 'text-pink-600', bg: 'bg-pink-50 dark:bg-pink-900/20' },
  { key: 'suppliers', label: 'Suppliers', icon: Building2, color: 'text-cyan-600', bg: 'bg-cyan-50 dark:bg-cyan-900/20' },
  { key: 'work-orders', label: 'Work Orders', icon: Wrench, color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20' },
  { key: 'layaways', label: 'Layaways', icon: CreditCard, color: 'text-rose-600', bg: 'bg-rose-50 dark:bg-rose-900/20' },
  { key: 'gift-cards', label: 'Gift Cards', icon: Gift, color: 'text-violet-600', bg: 'bg-violet-50 dark:bg-violet-900/20' },
  { key: 'pos-shifts', label: 'POS Shifts', icon: Monitor, color: 'text-teal-600', bg: 'bg-teal-50 dark:bg-teal-900/20' },
]

const severityConfig = {
  critical: { icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-900/20', border: 'border-l-red-500' },
  high: { icon: AlertTriangle, color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20', border: 'border-l-orange-500' },
  medium: { icon: Info, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/20', border: 'border-l-amber-400' },
  low: { icon: Info, color: 'text-gray-500', bg: 'bg-gray-50 dark:bg-gray-800', border: 'border-l-gray-300' },
}

export default function SystemAuditPage() {
  const { tenantSlug } = useCompany()
  const [progress, setProgress] = useState<AuditProgress | null>(null)
  const [categoryFilter, setCategoryFilter] = useState('')
  const [severityFilter, setSeverityFilter] = useState('')
  const [categoryCounts, setCategoryCounts] = useState<CategoryCount[]>([])
  const [starting, setStarting] = useState(false)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const {
    data: findings,
    pagination,
    loading,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<AuditAlert>({
    endpoint: '/api/audit',
    entityType: 'ai-alert',
    storageKey: 'audit-page-size',
    additionalParams: {
      ...(categoryFilter ? { category: categoryFilter } : {}),
      ...(severityFilter ? { severity: severityFilter } : {}),
    },
  })

  // Extract categoryCounts from the response - use a separate fetch
  const fetchCategoryCounts = useCallback(async () => {
    try {
      const res = await fetch('/api/audit?page=1&pageSize=1')
      if (res.ok) {
        const data = await res.json()
        if (data.categoryCounts) {
          setCategoryCounts(data.categoryCounts)
        }
      }
    } catch {
      // Silently fail
    }
  }, [])

  useRealtimeData(fetchCategoryCounts, { entityType: 'ai-alert' })

  // Poll progress while audit is running
  const fetchProgress = useCallback(async () => {
    try {
      const res = await fetch('/api/audit/progress')
      if (res.ok) {
        const data = await res.json()
        setProgress(data)
        return data
      }
    } catch {
      // Silently fail
    }
    return null
  }, [])

  useEffect(() => {
    fetchProgress()
  }, [fetchProgress])

  useEffect(() => {
    if (progress?.status === 'running') {
      if (!pollingRef.current) {
        pollingRef.current = setInterval(async () => {
          const p = await fetchProgress()
          if (p && p.status !== 'running') {
            if (pollingRef.current) {
              clearInterval(pollingRef.current)
              pollingRef.current = null
            }
            refresh()
            fetchCategoryCounts()
          }
        }, 1500)
      }
    } else {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [progress?.status, fetchProgress, refresh, fetchCategoryCounts])

  async function handleStartAudit() {
    setStarting(true)
    try {
      const res = await fetch('/api/audit', { method: 'POST' })
      if (res.ok) {
        toast.success('System audit started')
        setProgress({
          status: 'running',
          currentCategory: null,
          completedCategories: 0,
          totalCategories: 10,
          totalFindings: 0,
          startedAt: new Date().toISOString(),
          completedAt: null,
        })
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to start audit')
      }
    } catch {
      toast.error('Error starting audit')
    } finally {
      setStarting(false)
    }
  }

  async function handleDismiss(id: string) {
    try {
      await fetch('/api/ai/alerts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'dismiss' }),
      })
      refresh()
      fetchCategoryCounts()
    } catch {
      toast.error('Failed to dismiss')
    }
  }

  async function handleDismissAll() {
    if (findings.length === 0) return
    try {
      const ids = findings.map(f => f.id)
      await fetch('/api/ai/alerts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, action: 'dismiss' }),
      })
      toast.success(`Dismissed ${ids.length} findings`)
      refresh()
      fetchCategoryCounts()
    } catch {
      toast.error('Failed to dismiss all')
    }
  }

  function getEntityLink(entityType: string | null, entityId: string | null): string | null {
    if (!entityType || !entityId) return null
    const base = `/c/${tenantSlug}`
    switch (entityType) {
      case 'sale': return `${base}/sales/${entityId}`
      case 'purchase': return `${base}/purchases/${entityId}`
      case 'work_order': return `${base}/work-orders/${entityId}`
      case 'item': return `${base}/items`
      case 'customer': return `${base}/customers`
      case 'supplier': return `${base}/suppliers`
      case 'layaway': return `${base}/layaways/${entityId}`
      case 'stock_movement': return `${base}/stock-movements`
      case 'gift_card': return `${base}/settings/gift-cards`
      case 'pos_closing': return `${base}/pos/daily-summary`
      case 'account': return `${base}/accounting/chart-of-accounts`
      case 'gl_entry': return `${base}/accounting/general-ledger`
      default: return null
    }
  }

  function getCategoryCount(key: string): number {
    const found = categoryCounts.find(c => c.category === key)
    return found ? Number(found.count) : 0
  }

  const totalFindings = categoryCounts.reduce((sum, c) => sum + Number(c.count), 0)
  const isRunning = progress?.status === 'running'

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
        <span className="text-gray-900 dark:text-white font-medium">System Audit</span>
      </nav>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <ShieldCheck size={24} className="text-blue-600" />
            System Audit
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Comprehensive integrity checks across all workflows
          </p>
        </div>
        <button
          onClick={handleStartAudit}
          disabled={isRunning || starting}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
        >
          {isRunning || starting ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Play size={16} />
          )}
          {isRunning ? 'Audit Running...' : 'Run Full Audit'}
        </button>
      </div>

      {/* Progress Bar */}
      {isRunning && progress && (
        <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <Loader2 size={14} className="animate-spin text-blue-600" />
              {progress.currentCategory ? `Checking ${progress.currentCategory}...` : 'Initializing...'}
            </span>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {progress.completedCategories}/{progress.totalCategories} categories, {progress.totalFindings} issues found
            </span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${(progress.completedCategories / progress.totalCategories) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Completed Banner */}
      {progress?.status === 'completed' && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle size={16} className="text-green-600 dark:text-green-400" />
            <span className="text-sm font-medium text-green-800 dark:text-green-300">
              Audit completed — {totalFindings} {totalFindings === 1 ? 'issue' : 'issues'} found
            </span>
          </div>
          <span className="text-xs text-green-600 dark:text-green-400">
            {progress.completedAt ? new Date(progress.completedAt).toLocaleString() : ''}
          </span>
        </div>
      )}

      {/* Error Banner */}
      {progress?.status === 'error' && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-4 flex items-center gap-2">
          <AlertCircle size={16} className="text-red-600 dark:text-red-400" />
          <span className="text-sm font-medium text-red-800 dark:text-red-300">
            Audit failed: {progress.error || 'Unknown error'}
          </span>
        </div>
      )}

      {/* Category Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {CATEGORIES.map(cat => {
          const count = getCategoryCount(cat.key)
          const Icon = cat.icon
          const isActive = categoryFilter === cat.key
          return (
            <button
              key={cat.key}
              onClick={() => setCategoryFilter(isActive ? '' : cat.key)}
              className={`p-3 rounded border text-left transition-all ${
                isActive
                  ? 'border-blue-500 dark:border-blue-400 ring-1 ring-blue-500 dark:ring-blue-400'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
              } bg-white dark:bg-gray-800`}
            >
              <div className="flex items-center gap-2 mb-1">
                <div className={`p-1 rounded ${cat.bg}`}>
                  <Icon size={14} className={cat.color} />
                </div>
                <span className="text-xs font-medium text-gray-600 dark:text-gray-400">{cat.label}</span>
              </div>
              <p className={`text-lg font-bold ${count > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                {count}
              </p>
            </button>
          )
        })}
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-3">
        <select
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
          className="px-3 py-1.5 border border-gray-200 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
        >
          <option value="">All Categories</option>
          {CATEGORIES.map(c => (
            <option key={c.key} value={c.key}>{c.label}</option>
          ))}
        </select>
        <select
          value={severityFilter}
          onChange={e => setSeverityFilter(e.target.value)}
          className="px-3 py-1.5 border border-gray-200 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
        >
          <option value="">All Severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        {(categoryFilter || severityFilter) && (
          <button
            onClick={() => { setCategoryFilter(''); setSeverityFilter('') }}
            className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 flex items-center gap-1"
          >
            <X size={12} /> Clear filters
          </button>
        )}
        {progress?.completedAt && (
          <span className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1">
            <Clock size={12} />
            Last audit: {new Date(progress.completedAt).toLocaleString()}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {findings.length > 0 && (
            <button
              onClick={handleDismissAll}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors"
              title="Dismiss all visible findings"
            >
              <Trash2 size={13} />
              Dismiss page
            </button>
          )}
          <button
            onClick={() => { refresh(); fetchCategoryCounts() }}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title="Refresh"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* Results Table */}
      <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
        {loading ? (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">
            <Loader2 size={20} className="animate-spin mx-auto mb-2" />
            Loading audit results...
          </div>
        ) : findings.length === 0 ? (
          <div className="p-8 text-center">
            <CheckCircle size={32} className="mx-auto mb-2 text-green-500" />
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {totalFindings === 0 ? 'No issues found. Run an audit to check system integrity.' : 'No issues matching current filters.'}
            </p>
          </div>
        ) : (
          <>
            <div className="list-container-xl">
              <table className="w-full">
                <thead className="table-sticky-header">
                  <tr className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    <th className="px-4 py-3 text-left w-24">Severity</th>
                    <th className="px-4 py-3 text-left w-28">Category</th>
                    <th className="px-4 py-3 text-left">Issue</th>
                    <th className="px-4 py-3 text-left w-32">Date</th>
                    <th className="px-4 py-3 text-right w-20">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {findings.map(finding => {
                    const sev = severityConfig[finding.severity]
                    const SevIcon = sev.icon
                    const cat = CATEGORIES.find(c => c.key === finding.metadata?.auditCategory)
                    const CatIcon = cat?.icon || ShieldCheck
                    const link = getEntityLink(finding.entityType, finding.entityId)

                    return (
                      <tr key={finding.id} className={`border-l-2 ${sev.border} hover:bg-gray-50 dark:hover:bg-gray-700/50`}>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 text-xs font-medium ${sev.color}`}>
                            <SevIcon size={13} />
                            <span className="capitalize">{finding.severity}</span>
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400">
                            <CatIcon size={13} />
                            {cat?.label || finding.metadata?.auditCategory || '-'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-sm font-medium text-gray-900 dark:text-white">{finding.title}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{finding.message}</p>
                          {link && (
                            <Link href={link} className="text-xs text-blue-600 hover:underline mt-0.5 inline-block">
                              View entity
                            </Link>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                          {new Date(finding.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => handleDismiss(finding.id)}
                            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded"
                            title="Dismiss"
                          >
                            <X size={14} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              page={pagination.page}
              pageSize={pagination.pageSize}
              total={pagination.total}
              totalPages={pagination.totalPages}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              className="border-t px-4"
            />
          </>
        )}
      </div>
    </div>
  )
}
