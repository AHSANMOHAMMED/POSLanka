'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { usePaginatedData } from '@/hooks'
import { Pagination } from '@/components/ui/pagination'
import { toast } from '@/components/ui/toast'
import {
  AlertCircle, AlertTriangle, Info, CheckCircle, Clock,
  ChevronDown, ChevronUp, Bot, Sparkles, Filter,
  Monitor, User, Globe, Bug, Hash, MessageSquare, ExternalLink,
} from 'lucide-react'

interface ErrorLog {
  id: string
  tenantId: string | null
  level: 'error' | 'warning' | 'info'
  source: string
  message: string
  stack: string | null
  context: Record<string, unknown> | null
  aiAnalysis: string | null
  aiSuggestion: string | null
  groupHash: string | null
  resolvedAt: string | null
  createdAt: string
  errorSource: string | null
  resolutionStatus: string | null
  resolutionNotes: string | null
  occurrenceCount: number | null
  lastOccurredAt: string | null
  reportedUrl: string | null
  userDescription: string | null
  reportedByUserId: string | null
  reportedByName: string | null
}

interface Stats {
  total24h: number
  unresolvedCount: number
  userReportsCount: number
  frontendCount: number
  systemCount: number
}

const levelConfig = {
  error: { icon: AlertCircle, color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-900/20', label: 'Error' },
  warning: { icon: AlertTriangle, color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-900/20', label: 'Warning' },
  info: { icon: Info, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-900/20', label: 'Info' },
}

const sourceConfig: Record<string, { icon: typeof Monitor; color: string; bg: string; label: string }> = {
  system: { icon: Monitor, color: 'text-red-600 dark:text-red-400', bg: 'bg-red-100 dark:bg-red-900/30', label: 'System' },
  user_report: { icon: Bug, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-100 dark:bg-blue-900/30', label: 'User Report' },
  frontend: { icon: Globe, color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-100 dark:bg-orange-900/30', label: 'Frontend' },
}

const tabs = [
  { key: '', label: 'All Errors', icon: AlertCircle },
  { key: 'system', label: 'System', icon: Monitor },
  { key: 'user_report', label: 'User Reports', icon: Bug },
  { key: 'frontend', label: 'Frontend', icon: Globe },
]

const resolutionOptions = [
  { value: 'open', label: 'Open', color: 'text-red-600 bg-red-50 dark:bg-red-900/20' },
  { value: 'investigating', label: 'Investigating', color: 'text-amber-600 bg-amber-50 dark:bg-amber-900/20' },
  { value: 'resolved', label: 'Resolved', color: 'text-green-600 bg-green-50 dark:bg-green-900/20' },
  { value: 'wont_fix', label: "Won't Fix", color: 'text-gray-600 bg-gray-50 dark:bg-gray-900/20' },
]

export default function AILogsPage() {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [levelFilter, setLevelFilter] = useState<string>('')
  const [sourceTab, setSourceTab] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [stats, setStats] = useState<Stats | null>(null)
  const [editingNotes, setEditingNotes] = useState<string | null>(null)
  const [notesText, setNotesText] = useState('')
  const notesTextRef = useRef(notesText)

  const {
    data: logs,
    pagination,
    loading,
    error,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<ErrorLog>({
    endpoint: '/api/ai/error-logs',
    entityType: 'ai-error',
    storageKey: 'ai-logs-page-size',
    additionalParams: {
      ...(levelFilter ? { level: levelFilter } : {}),
      ...(sourceTab ? { source: sourceTab } : {}),
      ...(statusFilter ? { resolutionStatus: statusFilter } : {}),
      includeStats: 'true',
    },
  })

  // Fetch stats independently
  const refreshStats = useCallback(() => {
    fetch('/api/ai/error-logs?page=1&pageSize=1&includeStats=true')
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data?.stats) setStats(data.stats) })
      .catch(() => {})
  }, [])

  // Load stats on mount and when filters change
  useEffect(() => {
    refreshStats()
  }, [refreshStats, sourceTab, levelFilter, statusFilter])

  const handleStatusChange = useCallback(async (id: string, newStatus: string) => {
    try {
      const res = await fetch('/api/ai/error-logs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, resolutionStatus: newStatus }),
      })
      if (res.ok) {
        toast.success(`Status changed to ${newStatus}`)
        refresh()
        refreshStats()
      }
    } catch {
      toast.error('Failed to update status')
    }
  }, [refresh, refreshStats])

  // Keep ref in sync with state
  useEffect(() => { notesTextRef.current = notesText }, [notesText])

  const handleSaveNotes = useCallback(async (id: string) => {
    try {
      const res = await fetch('/api/ai/error-logs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, resolutionNotes: notesTextRef.current }),
      })
      if (res.ok) {
        toast.success('Notes saved')
        setEditingNotes(null)
        refresh()
        refreshStats()
      }
    } catch {
      toast.error('Failed to save notes')
    }
  }, [refresh, refreshStats])

  function formatRelative(dateStr: string): string {
    const d = new Date(dateStr)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  }

  function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleString()
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Bot size={22} className="text-purple-500" />
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Error Log & Bug Reports</h1>
      </div>

      {/* Stats Bar */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">Errors (24h)</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{stats.total24h}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">Unresolved</p>
            <p className="text-2xl font-bold text-red-600">{stats.unresolvedCount}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">User Reports</p>
            <p className="text-2xl font-bold text-blue-600">{stats.userReportsCount}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">Frontend (24h)</p>
            <p className="text-2xl font-bold text-orange-600">{stats.frontendCount}</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-700">
        {tabs.map(tab => {
          const TabIcon = tab.icon
          const isActive = sourceTab === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => { setSourceTab(tab.key); setPage(1); setExpandedId(null) }}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                isActive
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              <TabIcon size={14} />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Filter size={14} className="text-gray-400" />
          <span className="text-sm text-gray-500 dark:text-gray-400">Level:</span>
          <select
            value={levelFilter}
            onChange={e => { setLevelFilter(e.target.value); setPage(1); setExpandedId(null) }}
            className="text-sm border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          >
            <option value="">All</option>
            <option value="error">Errors</option>
            <option value="warning">Warnings</option>
            <option value="info">Info</option>
          </select>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-sm text-gray-500 dark:text-gray-400">Status:</span>
          <select
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value); setPage(1); setExpandedId(null) }}
            className="text-sm border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          >
            <option value="">All</option>
            <option value="open">Open</option>
            <option value="investigating">Investigating</option>
            <option value="resolved">Resolved</option>
            <option value="wont_fix">Won&apos;t Fix</option>
          </select>
        </div>
      </div>

      {/* Error List */}
      <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
        {error ? (
          <div className="p-8 text-center">
            <AlertCircle size={40} className="mx-auto text-red-400 mb-2" />
            <p className="text-gray-500 dark:text-gray-400">{error}</p>
          </div>
        ) : loading ? (
          <div className="p-8 text-center text-gray-400">Loading error logs...</div>
        ) : logs.length === 0 ? (
          <div className="p-8 text-center">
            <CheckCircle size={40} className="mx-auto text-green-400 mb-2" />
            <p className="text-gray-500 dark:text-gray-400">No errors found</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {logs.map(log => {
              const config = levelConfig[log.level]
              const LevelIcon = config.icon
              const isExpanded = expandedId === log.id
              const src = sourceConfig[log.errorSource || 'system'] || sourceConfig.system
              const SrcIcon = src.icon
              const status = log.resolutionStatus || 'open'
              const count = log.occurrenceCount || 1

              return (
                <div key={log.id} className={status === 'resolved' || status === 'wont_fix' ? 'opacity-60' : ''}>
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : log.id)}
                    className="w-full flex items-start gap-3 p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                  >
                    <LevelIcon size={18} className={`mt-0.5 flex-shrink-0 ${config.color}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {log.message.slice(0, 120)}{log.message.length > 120 ? '...' : ''}
                        </span>
                        {/* Source badge */}
                        <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded ${src.bg} ${src.color}`}>
                          <SrcIcon size={10} />
                          {src.label}
                        </span>
                        {/* Occurrence count */}
                        {count > 1 && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                            <Hash size={9} />
                            x{count}
                          </span>
                        )}
                        {/* Resolution status badge */}
                        {status !== 'open' && (
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                            resolutionOptions.find(o => o.value === status)?.color || ''
                          }`}>
                            {resolutionOptions.find(o => o.value === status)?.label || status}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 dark:text-gray-400">
                        <span className="font-mono">{log.source}</span>
                        <span className="flex items-center gap-1">
                          <Clock size={11} />
                          {formatRelative(log.createdAt)}
                        </span>
                        {log.reportedByName && (
                          <span className="flex items-center gap-1">
                            <User size={11} />
                            {log.reportedByName}
                          </span>
                        )}
                        {log.aiAnalysis && (
                          <span className="flex items-center gap-1 text-purple-500">
                            <Sparkles size={11} />
                            AI analyzed
                          </span>
                        )}
                      </div>
                    </div>
                    {isExpanded ? (
                      <ChevronUp size={16} className="text-gray-400 flex-shrink-0 mt-1" />
                    ) : (
                      <ChevronDown size={16} className="text-gray-400 flex-shrink-0 mt-1" />
                    )}
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 space-y-3 border-t border-gray-100 dark:border-gray-700 pt-3 ml-8">
                      {/* User report description */}
                      {log.userDescription && (
                        <div className="bg-blue-50 dark:bg-blue-900/20 rounded p-3 border border-blue-200 dark:border-blue-800">
                          <div className="flex items-center gap-1.5 mb-1">
                            <MessageSquare size={14} className="text-blue-500" />
                            <h4 className="text-xs font-semibold text-blue-700 dark:text-blue-300 uppercase">User Description</h4>
                            {log.reportedByName && (
                              <span className="text-xs text-blue-500 ml-2">by {log.reportedByName}</span>
                            )}
                          </div>
                          <p className="text-sm text-blue-900 dark:text-blue-200 whitespace-pre-wrap">{log.userDescription}</p>
                        </div>
                      )}

                      {/* Reported URL */}
                      {log.reportedUrl && (
                        <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                          <ExternalLink size={12} />
                          <span>Page: {log.reportedUrl}</span>
                        </div>
                      )}

                      {/* Full error message */}
                      <div>
                        <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Error Message</h4>
                        <p className="text-sm text-gray-700 dark:text-gray-300 font-mono bg-gray-50 dark:bg-gray-900 rounded p-2 break-all">
                          {log.message}
                        </p>
                      </div>

                      {/* Context */}
                      {log.context && (
                        <div>
                          <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Context</h4>
                          <pre className="text-xs text-gray-600 dark:text-gray-400 font-mono bg-gray-50 dark:bg-gray-900 rounded p-2 overflow-x-auto">
                            {JSON.stringify(log.context, null, 2)}
                          </pre>
                        </div>
                      )}

                      {/* Stack trace */}
                      {log.stack && (
                        <div>
                          <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Stack Trace</h4>
                          <pre className="text-xs text-gray-600 dark:text-gray-400 font-mono bg-gray-50 dark:bg-gray-900 rounded p-2 overflow-x-auto max-h-48 overflow-y-auto">
                            {log.stack}
                          </pre>
                        </div>
                      )}

                      {/* AI Analysis */}
                      {log.aiAnalysis && (
                        <div className="bg-purple-50 dark:bg-purple-900/20 rounded p-3 border border-purple-200 dark:border-purple-800">
                          <div className="flex items-center gap-1.5 mb-1">
                            <Sparkles size={14} className="text-purple-500" />
                            <h4 className="text-xs font-semibold text-purple-700 dark:text-purple-300 uppercase">AI Analysis</h4>
                          </div>
                          <p className="text-sm text-purple-900 dark:text-purple-200">{log.aiAnalysis}</p>
                          {log.aiSuggestion && (
                            <div className="mt-2 pt-2 border-t border-purple-200 dark:border-purple-700">
                              <h5 className="text-xs font-semibold text-purple-600 dark:text-purple-400 mb-1">Suggested Fix</h5>
                              <p className="text-sm text-purple-800 dark:text-purple-300">{log.aiSuggestion}</p>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Resolution workflow — disabled for user-reported logs (only sys-control can change) */}
                      <div className="bg-gray-50 dark:bg-gray-900 rounded p-3 space-y-2">
                        {log.errorSource === 'user_report' ? (
                          <p className="text-xs text-amber-600 dark:text-amber-400">
                            Status and notes for user-reported errors can only be changed from System Control.
                          </p>
                        ) : (
                          <>
                            <div className="flex items-center gap-3">
                              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Status:</span>
                              <div className="flex gap-1">
                                {resolutionOptions.map(opt => (
                                  <button
                                    key={opt.value}
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleStatusChange(log.id, opt.value)
                                    }}
                                    className={`px-2 py-0.5 text-xs rounded font-medium transition-colors ${
                                      status === opt.value
                                        ? opt.color + ' ring-1 ring-current'
                                        : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800'
                                    }`}
                                  >
                                    {opt.label}
                                  </button>
                                ))}
                              </div>
                            </div>

                            <div>
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Notes:</span>
                                {editingNotes !== log.id && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setEditingNotes(log.id)
                                      setNotesText(log.resolutionNotes || '')
                                    }}
                                    className="text-xs text-blue-500 hover:text-blue-700"
                                  >
                                    {log.resolutionNotes ? 'Edit' : 'Add notes'}
                                  </button>
                                )}
                              </div>
                              {editingNotes === log.id ? (
                                <div className="mt-1 space-y-1" onClick={e => e.stopPropagation()}>
                                  <textarea
                                    value={notesText}
                                    onChange={e => setNotesText(e.target.value)}
                                    className="w-full px-2 py-1 text-sm border rounded bg-white dark:bg-gray-800 dark:border-gray-600"
                                    rows={2}
                                    placeholder="Add resolution notes..."
                                  />
                                  <div className="flex gap-1">
                                    <button
                                      type="button"
                                      onClick={() => handleSaveNotes(log.id)}
                                      className="px-2 py-0.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                                    >
                                      Save
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditingNotes(null)}
                                      className="px-2 py-0.5 text-xs border rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : log.resolutionNotes ? (
                                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{log.resolutionNotes}</p>
                              ) : (
                                <p className="text-xs text-gray-400 mt-1 italic">No notes</p>
                              )}
                            </div>
                          </>
                        )}
                      </div>

                      {/* Timestamps */}
                      <div className="flex items-center gap-4 text-xs text-gray-400">
                        <span>Created: {formatDate(log.createdAt)}</span>
                        {log.lastOccurredAt && count > 1 && (
                          <span>Last seen: {formatDate(log.lastOccurredAt)}</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <Pagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          totalPages={pagination.totalPages}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          className="border-t px-4"
        />
      </div>
    </div>
  )
}
