'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { Home, ChevronRight, Shield, CheckCircle2, AlertTriangle, XCircle, RefreshCw, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { toast } from '@/components/ui/toast'

interface AuditCheck {
  name: string
  status: 'pass' | 'warn' | 'fail'
  message: string
  details?: unknown
}

interface AuditResult {
  checks: AuditCheck[]
  summary: {
    total: number
    pass: number
    warn: number
    fail: number
    overallStatus: 'pass' | 'warn' | 'fail'
  }
  auditedAt: string
}

const STATUS_STYLES = {
  pass: {
    icon: CheckCircle2,
    bg: 'bg-green-50 dark:bg-green-950/20',
    border: 'border-green-200 dark:border-green-800',
    text: 'text-green-700 dark:text-green-400',
    iconColor: 'text-green-600 dark:text-green-400',
  },
  warn: {
    icon: AlertTriangle,
    bg: 'bg-amber-50 dark:bg-amber-950/20',
    border: 'border-amber-200 dark:border-amber-800',
    text: 'text-amber-700 dark:text-amber-400',
    iconColor: 'text-amber-600 dark:text-amber-400',
  },
  fail: {
    icon: XCircle,
    bg: 'bg-red-50 dark:bg-red-950/20',
    border: 'border-red-200 dark:border-red-800',
    text: 'text-red-700 dark:text-red-400',
    iconColor: 'text-red-600 dark:text-red-400',
  },
}

export default function AccountingAuditPage() {
  const { tenantSlug } = useCompany()
  const [result, setResult] = useState<AuditResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [expandedChecks, setExpandedChecks] = useState<Set<string>>(new Set())

  const runAudit = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/accounting/audit')
      if (!res.ok) throw new Error('Failed to run audit')
      const data = await res.json()
      setResult(data)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Audit failed')
    } finally {
      setLoading(false)
    }
  }, [])

  const toggleExpand = (name: string) => {
    setExpandedChecks(prev => {
      const next = new Set(prev)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
      }
      return next
    })
  }

  const overallStyle = result ? STATUS_STYLES[result.summary.overallStatus] : null

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 mb-6">
        <Link href={`/c/${tenantSlug}/dashboard`} className="hover:text-blue-600 dark:hover:text-blue-400">
          <Home size={14} />
        </Link>
        <ChevronRight size={14} />
        <Link href={`/c/${tenantSlug}/accounting`} className="hover:text-blue-600 dark:hover:text-blue-400">Accounting</Link>
        <ChevronRight size={14} />
        <span className="text-gray-900 dark:text-white font-medium">System Audit</span>
      </nav>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Shield size={24} className="text-blue-600" />
            Accounting System Audit
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Verify GL integrity, check for unposted transactions, and validate system configuration.
          </p>
        </div>
        <button
          onClick={runAudit}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          {loading ? 'Running Audit...' : 'Run Audit'}
        </button>
      </div>

      {/* No result yet */}
      {!result && !loading && (
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-12 text-center">
          <Shield size={48} className="mx-auto text-gray-300 dark:text-gray-600 mb-4" />
          <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2">Run an Audit</h2>
          <p className="text-gray-500 dark:text-gray-400 max-w-md mx-auto mb-4">
            Click &quot;Run Audit&quot; to check your accounting system for balance inconsistencies, unposted transactions, and configuration issues.
          </p>
        </div>
      )}

      {/* Loading */}
      {loading && !result && (
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-12 text-center">
          <Loader2 size={32} className="animate-spin mx-auto text-blue-600 mb-4" />
          <p className="text-gray-500 dark:text-gray-400">Running audit checks...</p>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {/* Summary Card */}
          <div className={`p-4 rounded border ${overallStyle?.bg} ${overallStyle?.border}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {overallStyle && (
                  <overallStyle.icon size={28} className={overallStyle.iconColor} />
                )}
                <div>
                  <h2 className={`text-lg font-bold ${overallStyle?.text}`}>
                    {result.summary.overallStatus === 'pass' ? 'All Checks Passed' :
                     result.summary.overallStatus === 'warn' ? 'Warnings Found' : 'Issues Detected'}
                  </h2>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {result.summary.pass} passed, {result.summary.warn} warnings, {result.summary.fail} failed
                  </p>
                </div>
              </div>
              <p className="text-xs text-gray-400">
                Audited: {new Date(result.auditedAt).toLocaleString()}
              </p>
            </div>
          </div>

          {/* Individual Checks */}
          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 dark:bg-gray-750 border-b dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Audit Checks ({result.checks.length})</h3>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {result.checks.map((check) => {
                const style = STATUS_STYLES[check.status]
                const Icon = style.icon
                const isExpanded = expandedChecks.has(check.name)
                const hasDetails = check.details != null

                return (
                  <div key={check.name}>
                    <button
                      type="button"
                      onClick={() => hasDetails && toggleExpand(check.name)}
                      className={`w-full px-4 py-3 flex items-center gap-3 text-left ${hasDetails ? 'hover:bg-gray-50 dark:hover:bg-gray-750 cursor-pointer' : ''}`}
                    >
                      <Icon size={18} className={style.iconColor} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{check.name}</p>
                        <p className={`text-xs ${style.text}`}>{check.message}</p>
                      </div>
                      <span className={`text-xs font-semibold uppercase px-2 py-0.5 rounded ${style.bg} ${style.text}`}>
                        {check.status}
                      </span>
                      {hasDetails && (
                        isExpanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />
                      )}
                    </button>
                    {isExpanded && hasDetails && (
                      <div className="px-4 pb-3 pt-1">
                        <pre className="text-xs bg-gray-50 dark:bg-gray-900 p-3 rounded overflow-x-auto text-gray-600 dark:text-gray-400">
                          {JSON.stringify(check.details, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
