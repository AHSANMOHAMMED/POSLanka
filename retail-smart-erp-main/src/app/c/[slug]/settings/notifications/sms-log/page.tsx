'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { X } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Pagination } from '@/components/ui/pagination'
import { ListPageLayout } from '@/components/layout/ListPageLayout'

interface SmsLog {
  id: string
  status: string
  recipientContact: string
  recipientName: string | null
  content: string
  segments: number | null
  providerMessageId: string | null
  errorMessage: string | null
  sentAt: string | null
  createdAt: string
  sentBy: string | null
  senderName: string | null
}

interface PaginationInfo {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

const statusLabels: Record<string, string> = {
  sent: 'Sent',
  delivered: 'Delivered',
  pending: 'Pending',
  failed: 'Failed',
}

export default function SmsLogPage() {
  const params = useParams()
  const basePath = params.slug ? `/c/${params.slug}` : ''
  const [logs, setLogs] = useState<SmsLog[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0,
  })
  const [selectedLog, setSelectedLog] = useState<SmsLog | null>(null)

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        pageSize: pagination.pageSize.toString(),
      })
      if (search) params.set('search', search)
      if (statusFilter) params.set('status', statusFilter)

      const res = await fetch(`/api/sms-log?${params}`)
      if (res.ok) {
        const data = await res.json()
        setLogs(data.data || [])
        setPagination(data.pagination)
      }
    } catch (error) {
      console.error('Failed to fetch SMS logs:', error)
    } finally {
      setLoading(false)
    }
  }, [pagination.page, pagination.pageSize, search, statusFilter])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  const handleSearch = (value: string) => {
    setSearch(value)
    setPagination(prev => ({ ...prev, page: 1 }))
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      sent: 'bg-green-100 text-green-800',
      delivered: 'bg-blue-100 text-blue-800',
      pending: 'bg-yellow-100 text-yellow-800',
      queued: 'bg-yellow-100 text-yellow-800',
      failed: 'bg-red-100 text-red-800',
    }
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status] || 'bg-gray-100 text-gray-800'}`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    )
  }

  return (
    <ListPageLayout
      module="Settings"
      moduleHref="/settings"
      title="SMS Log"
      actionContent={
        <div className="flex gap-2">
          <Link
            href={`${basePath}/settings/notifications/sms`}
            className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50 transition-colors"
          >
            SMS Settings
          </Link>
          <Link
            href={`${basePath}/settings/notifications/sms-center`}
            className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50 transition-colors"
          >
            SMS Center
          </Link>
        </div>
      }
      search={search}
      setSearch={handleSearch}
      onRefresh={fetchLogs}
      searchPlaceholder="Search by phone, name, or message..."
      filterContent={
        <>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          >
            <option value="">All Statuses</option>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          {statusFilter && (
            <button onClick={() => setStatusFilter('')} className="text-xs text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 px-2 py-1.5">
              <X size={14} />
            </button>
          )}
        </>
      }
    >
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">List of SMS logs</caption>
          <thead className="bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-600">
            <tr>
              <th scope="col" className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Status</th>
              <th scope="col" className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Sent On</th>
              <th scope="col" className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Sender</th>
              <th scope="col" className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Receiver</th>
              <th scope="col" className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Message</th>
              <th scope="col" className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">SMS</th>
              <th scope="col" className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Message ID</th>
            </tr>
          </thead>
          <tbody className="divide-y dark:divide-gray-700">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                  Loading...
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                  {search || statusFilter ? 'No SMS logs match your filters' : 'No SMS logs found'}
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr
                  key={log.id}
                  className="hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                  onClick={() => setSelectedLog(log)}
                >
                  <td className="px-4 py-3">{getStatusBadge(log.status)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatDate(log.sentAt || log.createdAt)}</td>
                  <td className="px-4 py-3">{log.senderName || '-'}</td>
                  <td className="px-4 py-3">
                    <div>{log.recipientContact}</div>
                    {log.recipientName && (
                      <div className="text-xs text-gray-500 dark:text-gray-400">{log.recipientName}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 max-w-[300px]">
                    <div className="truncate" title={log.content}>
                      {log.content}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">{log.segments || 1}</td>
                  <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">{log.providerMessageId || '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <Pagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          totalPages={pagination.totalPages}
          onPageChange={(page) => setPagination(prev => ({ ...prev, page }))}
          onPageSizeChange={(pageSize) => setPagination(prev => ({ ...prev, pageSize, page: 1 }))}
          className="border-t dark:border-gray-700 px-4"
        />
      </div>

      {/* Detail Modal */}
      {selectedLog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setSelectedLog(null)}>
          <Card className="w-full max-w-lg m-4 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">SMS Details</h2>
              <button onClick={() => setSelectedLog(null)} className="text-gray-500 hover:text-gray-700 text-xl">
                &times;
              </button>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between">
                <span className="text-gray-500">Status</span>
                {getStatusBadge(selectedLog.status)}
              </div>

              <div className="flex justify-between">
                <span className="text-gray-500">Sent On</span>
                <span>{formatDate(selectedLog.sentAt || selectedLog.createdAt)}</span>
              </div>

              <div className="flex justify-between">
                <span className="text-gray-500">Sender</span>
                <span>{selectedLog.senderName || '-'}</span>
              </div>

              <div className="flex justify-between">
                <span className="text-gray-500">Receiver</span>
                <span>
                  {selectedLog.recipientContact}
                  {selectedLog.recipientName && ` (${selectedLog.recipientName})`}
                </span>
              </div>

              <div className="flex justify-between">
                <span className="text-gray-500">SMS Segments</span>
                <span>{selectedLog.segments || 1}</span>
              </div>

              <div className="flex justify-between">
                <span className="text-gray-500">Message ID</span>
                <span className="text-xs">{selectedLog.providerMessageId || '-'}</span>
              </div>

              <div>
                <span className="text-gray-500 block mb-2">Message</span>
                <div className="bg-gray-50 p-3 rounded-md text-sm whitespace-pre-wrap">
                  {selectedLog.content}
                </div>
              </div>

              {selectedLog.errorMessage && (
                <div>
                  <span className="text-red-500 block mb-2">Error</span>
                  <div className="bg-red-50 p-3 rounded-md text-sm text-red-800">
                    {selectedLog.errorMessage}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end">
              <Button variant="outline" onClick={() => setSelectedLog(null)}>
                Close
              </Button>
            </div>
          </Card>
        </div>
      )}
    </ListPageLayout>
  )
}
