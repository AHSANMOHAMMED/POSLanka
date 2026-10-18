'use client'

import { useState } from 'react'
import { usePaginatedData } from '@/hooks'
import { Pagination } from '@/components/ui/pagination'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { formatDistanceToNow } from 'date-fns'

interface NotificationLog {
  id: string
  channel: 'sms' | 'email'
  status: 'pending' | 'sent' | 'delivered' | 'failed'
  recipientName?: string | null
  recipientContact: string
  subject?: string | null
  content: string
  entityType?: string | null
  entityReference?: string | null
  provider?: string | null
  errorMessage?: string | null
  segments?: number | null
  cost?: string | null
  sentAt?: string | null
  createdAt: string
  templateName?: string | null
  sentByName?: string | null
}

interface NotificationLogTableProps {
  channel?: 'sms' | 'email' | 'all'
}

export function NotificationLogTable({ channel = 'all' }: NotificationLogTableProps) {
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [resending, setResending] = useState<string | null>(null)

  const {
    data: logs,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<NotificationLog>({
    endpoint: '/api/notification-logs',
    entityType: 'notification-log' as const,
    storageKey: 'notification-logs-page-size',
    additionalParams: {
      channel: channel !== 'all' ? channel : '',
      status: statusFilter !== 'all' ? statusFilter : '',
    },
  })

  const getStatusBadge = (status: string) => {
    const styles = {
      pending: 'bg-yellow-100 text-yellow-800',
      sent: 'bg-blue-100 text-blue-800',
      delivered: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800',
    }
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status as keyof typeof styles] || 'bg-gray-100'}`}>
        {status}
      </span>
    )
  }

  const getChannelIcon = (ch: string) => {
    return ch === 'sms' ? (
      <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
    ) : (
      <svg className="w-4 h-4 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    )
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return formatDistanceToNow(date, { addSuffix: true })
  }

  const handleResend = async (log: NotificationLog) => {
    setResending(log.id)
    try {
      const res = await fetch('/api/send-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: log.channel,
          recipients: [{ contact: log.recipientContact, name: log.recipientName }],
          smsContent: log.channel === 'sms' ? log.content : undefined,
          emailSubject: log.channel === 'email' ? log.subject : undefined,
          emailBody: log.channel === 'email' ? log.content : undefined,
          entityType: log.entityType,
          entityReference: log.entityReference,
        }),
      })

      if (res.ok) {
        refresh()
      }
    } catch (error) {
      console.error('Failed to resend:', error)
    } finally {
      setResending(null)
    }
  }

  const handleExport = () => {
    // Export current logs as CSV
    const headers = ['Date', 'Channel', 'Recipient', 'Subject/Content', 'Status', 'Error']
    const rows = logs.map(log => [
      log.sentAt || log.createdAt,
      log.channel.toUpperCase(),
      log.recipientContact,
      log.subject || log.content.substring(0, 50),
      log.status,
      log.errorMessage || '',
    ])

    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `notification-logs-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex gap-4 items-center">
        <div className="flex-1">
          <Input
            placeholder="Search by recipient, content..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <select
          className="block rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm px-3 py-2 border"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">All Status</option>
          <option value="pending">Pending</option>
          <option value="sent">Sent</option>
          <option value="delivered">Delivered</option>
          <option value="failed">Failed</option>
        </select>

        <Button variant="outline" size="sm" onClick={handleExport}>
          Export CSV
        </Button>
      </div>

      {/* Table */}
      <div className="bg-white rounded border overflow-hidden">
        <div className="overflow-x-auto list-container-xl">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 table-sticky-header">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Channel</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Recipient</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Content</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Related</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Sent</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                    Loading...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                    No notifications found
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {getChannelIcon(log.channel)}
                        <span className="text-sm capitalize">{log.channel}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        {log.recipientName && (
                          <div className="text-sm font-medium text-gray-900">
                            {log.recipientName}
                          </div>
                        )}
                        <div className="text-sm text-gray-500">{log.recipientContact}</div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="max-w-xs">
                        {log.subject && (
                          <div className="text-sm font-medium text-gray-900 truncate">
                            {log.subject}
                          </div>
                        )}
                        <div className="text-sm text-gray-500 truncate">
                          {log.content.replace(/<[^>]+>/g, '').substring(0, 50)}...
                        </div>
                        {log.templateName && (
                          <div className="text-xs text-blue-600">
                            Template: {log.templateName}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div>
                        {getStatusBadge(log.status)}
                        {log.status === 'failed' && log.errorMessage && (
                          <div className="text-xs text-red-600 mt-1 max-w-[150px] truncate" title={log.errorMessage}>
                            {log.errorMessage}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {log.entityType && (
                        <div className="text-sm">
                          <span className="text-gray-500">{log.entityType}</span>
                          {log.entityReference && (
                            <span className="text-gray-900 ml-1">{log.entityReference}</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="text-sm text-gray-500">
                        {log.sentAt ? formatDate(log.sentAt) : formatDate(log.createdAt)}
                      </div>
                      {log.sentByName && (
                        <div className="text-xs text-gray-400">by {log.sentByName}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {log.status === 'failed' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleResend(log)}
                          disabled={resending === log.id}
                          className="text-xs"
                        >
                          {resending === log.id ? 'Resending...' : 'Resend'}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
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
