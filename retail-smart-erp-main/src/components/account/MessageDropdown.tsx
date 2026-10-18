'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRealtimeData } from '@/hooks'
import { useRouter } from 'next/navigation'
import { MessageSquare, Plus, Loader2, ExternalLink } from 'lucide-react'

interface Conversation {
  id: string
  subject: string
  status: string
  lastMessageAt: string
  lastMessagePreview: string | null
  unreadByAccount: boolean
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

export function MessageDropdown() {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Poll unread count every 30s
  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await fetch('/api/account/messages/unread')
      if (res.ok) {
        const data = await res.json()
        setUnreadCount(data.unreadCount)
      }
    } catch {
      // Silently fail
    }
  }, [])

  // Real-time unread count via WebSocket
  useRealtimeData(fetchUnreadCount, { entityType: 'account-message' })

  // Fetch recent conversations when dropdown opens
  const fetchConversations = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/account/messages/recent')
      if (res.ok) {
        const data = await res.json()
        setConversations(data.conversations || [])
      }
    } catch {
      // Silently fail
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen) {
      fetchConversations()
    }
  }, [isOpen, fetchConversations])

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return

    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const handleConversationClick = (conversation: Conversation) => {
    setIsOpen(false)
    router.push(`/account/messages/${conversation.id}`)
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Message Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
      >
        <MessageSquare className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center px-1 text-[10px] font-bold text-white bg-blue-500 rounded-full">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-96 max-w-[calc(100vw-2rem)] bg-white dark:bg-gray-800 rounded-md shadow-xl border border-gray-200 dark:border-gray-700 z-50">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white">Messages</h3>
            <button
              onClick={() => {
                setIsOpen(false)
                router.push('/account/messages?new=true')
              }}
              className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              New Message
            </button>
          </div>

          {/* Conversation List */}
          <div className="max-h-[400px] overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-gray-400 dark:text-gray-500" />
              </div>
            ) : conversations.length === 0 ? (
              <div className="py-10 text-center">
                <MessageSquare className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                <p className="text-sm text-gray-500 dark:text-gray-400">No messages yet</p>
              </div>
            ) : (
              <div>
                {conversations.map(conversation => (
                  <button
                    key={conversation.id}
                    onClick={() => handleConversationClick(conversation)}
                    className={`w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
                      conversation.unreadByAccount ? 'bg-blue-50/50 dark:bg-blue-950/20' : ''
                    }`}
                  >
                    <div className={`w-8 h-8 rounded flex items-center justify-center flex-shrink-0 ${
                      conversation.unreadByAccount
                        ? 'bg-blue-100 dark:bg-blue-900/30'
                        : 'bg-gray-100 dark:bg-gray-700'
                    }`}>
                      <MessageSquare className={`w-4 h-4 ${
                        conversation.unreadByAccount
                          ? 'text-blue-600 dark:text-blue-400'
                          : 'text-gray-600 dark:text-gray-400'
                      }`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className={`text-sm truncate ${
                          conversation.unreadByAccount
                            ? 'font-semibold text-gray-900 dark:text-white'
                            : 'font-medium text-gray-700 dark:text-gray-300'
                        }`}>
                          {conversation.subject}
                        </p>
                        {conversation.unreadByAccount && (
                          <span className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0" />
                        )}
                      </div>
                      {conversation.lastMessagePreview && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">
                          {conversation.lastMessagePreview}
                        </p>
                      )}
                      <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                        {formatRelativeTime(conversation.lastMessageAt)}
                      </p>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600 flex-shrink-0 mt-1" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-2.5">
            <button
              onClick={() => {
                setIsOpen(false)
                router.push('/account/messages')
              }}
              className="w-full text-center text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium"
            >
              View all messages
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
