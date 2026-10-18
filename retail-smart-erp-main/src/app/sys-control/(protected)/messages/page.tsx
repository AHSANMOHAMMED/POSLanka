'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  MessageSquare,
  Loader2,
  Search,
  Clock,
  CheckCircle,
  Archive,
  AlertTriangle,
  User,
} from 'lucide-react'

interface Conversation {
  id: string
  subject: string
  status: string
  priority: string
  category: string | null
  lastMessageAt: string | null
  lastMessagePreview: string | null
  unreadByAdmin: boolean
  createdAt: string
  account: {
    id: string
    email: string
    fullName: string | null
  }
}

const statusColors: Record<string, string> = {
  open: 'bg-green-100 text-green-700',
  closed: 'bg-gray-100 text-gray-600',
  archived: 'bg-gray-100 text-gray-500',
}

const priorityColors: Record<string, string> = {
  low: 'bg-gray-100 text-gray-600',
  normal: 'bg-blue-100 text-blue-700',
  high: 'bg-orange-100 text-orange-700',
  urgent: 'bg-red-100 text-red-700',
}

function formatRelativeTime(date: string) {
  const d = new Date(date)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 60000) return 'Just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`
  return d.toLocaleDateString()
}

export default function AdminMessagesPage() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => setSearchDebounced(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  const fetchConversations = useCallback(async () => {
    try {
      const params = new URLSearchParams({ pageSize: '50' })
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (priorityFilter !== 'all') params.set('priority', priorityFilter)
      if (searchDebounced) params.set('search', searchDebounced)

      const res = await fetch(`/api/sys-control/messages?${params}`)
      if (res.ok) {
        const data = await res.json()
        setConversations(data.data || [])
      }
    } catch (error) {
      console.error('Failed to fetch conversations:', error)
    } finally {
      setLoading(false)
    }
  }, [statusFilter, priorityFilter, searchDebounced])

  useEffect(() => {
    fetchConversations()
    const interval = setInterval(fetchConversations, 30000)
    return () => clearInterval(interval)
  }, [fetchConversations])

  const unreadCount = conversations.filter(c => c.unreadByAdmin).length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <MessageSquare className="w-6 h-6" />
            Messages
            {unreadCount > 0 && (
              <span className="ml-2 inline-flex items-center justify-center w-6 h-6 text-xs font-bold text-white bg-red-500 rounded-full">
                {unreadCount}
              </span>
            )}
          </h1>
          <p className="text-gray-500 mt-1">Manage user support conversations</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search conversations..."
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded"
        >
          <option value="all">All Status</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="archived">Archived</option>
        </select>
        <select
          value={priorityFilter}
          onChange={e => setPriorityFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded"
        >
          <option value="all">All Priority</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-md shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          </div>
        ) : conversations.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            No conversations found
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">Conversation</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">Account</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">Status</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">Priority</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">Last Message</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {conversations.map(conv => (
                <tr key={conv.id} className={`hover:bg-gray-50 ${conv.unreadByAdmin ? 'bg-blue-50/50' : ''}`}>
                  <td className="px-6 py-4">
                    <Link href={`/sys-control/messages/${conv.id}`} className="block">
                      <div className="flex items-center gap-2">
                        <p className={`text-sm ${conv.unreadByAdmin ? 'font-bold text-gray-900' : 'font-medium text-gray-700'}`}>
                          {conv.subject}
                        </p>
                        {conv.unreadByAdmin && <span className="w-2 h-2 bg-blue-500 rounded-full" />}
                      </div>
                      {conv.lastMessagePreview && (
                        <p className="text-xs text-gray-500 mt-1 truncate max-w-[300px]">{conv.lastMessagePreview}</p>
                      )}
                    </Link>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center">
                        <User className="w-4 h-4 text-gray-500" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{conv.account.fullName || 'User'}</p>
                        <p className="text-xs text-gray-500">{conv.account.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full ${statusColors[conv.status] || ''}`}>
                      {conv.status === 'open' ? <Clock className="w-3 h-3" /> : conv.status === 'closed' ? <CheckCircle className="w-3 h-3" /> : <Archive className="w-3 h-3" />}
                      {conv.status}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full ${priorityColors[conv.priority] || ''}`}>
                      {conv.priority === 'urgent' && <AlertTriangle className="w-3 h-3" />}
                      {conv.priority}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-gray-500">
                      {conv.lastMessageAt ? formatRelativeTime(conv.lastMessageAt) : formatRelativeTime(conv.createdAt)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
