'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  MessageSquare,
  Plus,
  Loader2,
  Clock,
  CheckCircle,
  Archive,
  AlertCircle,
} from 'lucide-react'
import { NewConversationModal } from '@/components/account/NewConversationModal'

interface Conversation {
  id: string
  subject: string
  status: string
  priority: string
  category: string | null
  lastMessageAt: string | null
  lastMessagePreview: string | null
  unreadByAccount: boolean
  createdAt: string
}

const statusIcons: Record<string, typeof Clock> = {
  open: Clock,
  closed: CheckCircle,
  archived: Archive,
}

const priorityColors: Record<string, string> = {
  low: 'text-gray-500',
  normal: 'text-blue-600',
  high: 'text-orange-600',
  urgent: 'text-red-600',
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

export default function MessagesPage() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'open' | 'closed'>('all')
  const [showNewModal, setShowNewModal] = useState(false)

  const fetchConversations = useCallback(async () => {
    try {
      const params = new URLSearchParams({ pageSize: '50' })
      if (filter !== 'all') params.set('status', filter)
      const res = await fetch(`/api/account/messages?${params}`)
      if (res.ok) {
        const data = await res.json()
        setConversations(data.data || [])
      }
    } catch (error) {
      console.error('Failed to fetch conversations:', error)
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    fetchConversations()
  }, [fetchConversations])

  const unreadCount = conversations.filter(c => c.unreadByAccount).length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Messages</h1>
            {unreadCount > 0 && (
              <span className="inline-flex items-center justify-center w-6 h-6 text-xs font-bold text-white bg-blue-500 rounded-full">
                {unreadCount}
              </span>
            )}
          </div>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Contact our support team
          </p>
        </div>
        <button
          onClick={() => setShowNewModal(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded hover:bg-gray-800 dark:hover:bg-gray-100 font-medium text-sm"
        >
          <Plus className="w-4 h-4" />
          New Message
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        {(['all', 'open', 'closed'] as const).map((status) => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
              filter === status
                ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900'
                : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700'
            }`}
          >
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </button>
        ))}
      </div>

      {/* Conversations List */}
      <div className="bg-white dark:bg-gray-800 rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          </div>
        ) : conversations.length === 0 ? (
          <div className="py-12 text-center">
            <MessageSquare className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-gray-500 dark:text-gray-400 font-medium">No conversations yet</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Start a new message to contact support</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {conversations.map(conv => {
              const StatusIcon = statusIcons[conv.status] || AlertCircle
              return (
                <Link
                  key={conv.id}
                  href={`/account/messages/${conv.id}`}
                  className={`block px-6 py-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
                    conv.unreadByAccount ? 'bg-blue-50/50 dark:bg-blue-950/20' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className={`text-sm truncate ${conv.unreadByAccount ? 'font-bold text-gray-900 dark:text-white' : 'font-medium text-gray-700 dark:text-gray-300'}`}>
                          {conv.subject}
                        </p>
                        {conv.unreadByAccount && (
                          <span className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0" />
                        )}
                      </div>
                      {conv.lastMessagePreview && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">
                          {conv.lastMessagePreview}
                        </p>
                      )}
                      <div className="flex items-center gap-3 mt-2">
                        <span className={`inline-flex items-center gap-1 text-xs ${conv.status === 'open' ? 'text-green-600' : 'text-gray-500'}`}>
                          <StatusIcon className="w-3 h-3" />
                          {conv.status}
                        </span>
                        {conv.category && (
                          <span className="text-xs text-gray-400 capitalize">{conv.category}</span>
                        )}
                        {conv.priority !== 'normal' && (
                          <span className={`text-xs font-medium capitalize ${priorityColors[conv.priority] || ''}`}>
                            {conv.priority}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">
                      {conv.lastMessageAt ? formatRelativeTime(conv.lastMessageAt) : formatRelativeTime(conv.createdAt)}
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>

      <NewConversationModal
        isOpen={showNewModal}
        onClose={() => setShowNewModal(false)}
        onCreated={() => {
          setShowNewModal(false)
          fetchConversations()
        }}
      />
    </div>
  )
}
