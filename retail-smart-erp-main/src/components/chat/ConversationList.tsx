'use client'

import { ChatConversation } from '@/lib/stores/chat-store'
import { Users, Search } from 'lucide-react'
import { useState, useMemo } from 'react'

function formatRelativeTime(date: string | null) {
  if (!date) return ''
  const d = new Date(date)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 60000) return 'now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d`
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function getInitials(name: string | null) {
  if (!name) return '?'
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

const GROUP_COLORS: Record<string, string> = {
  blue: 'bg-blue-500',
  green: 'bg-green-500',
  purple: 'bg-purple-500',
  orange: 'bg-orange-500',
  pink: 'bg-pink-500',
  teal: 'bg-teal-500',
  red: 'bg-red-500',
  indigo: 'bg-indigo-500',
}

interface ConversationListProps {
  conversations: ChatConversation[]
  activeId: string | null
  currentUserId: string
  onSelect: (id: string) => void
  compact?: boolean
  showSearch?: boolean
}

export function ConversationList({
  conversations,
  activeId,
  currentUserId,
  onSelect,
  compact = false,
  showSearch = true,
}: ConversationListProps) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!search.trim()) return conversations
    const q = search.toLowerCase()
    return conversations.filter(c =>
      c.name?.toLowerCase().includes(q) ||
      c.lastMessagePreview?.toLowerCase().includes(q) ||
      c.participants.some(p => p.name?.toLowerCase().includes(q))
    )
  }, [conversations, search])

  return (
    <div className="flex flex-col h-full">
      {showSearch && (
        <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search chats..."
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white focus:ring-1 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400 text-sm">
            {search ? 'No chats found' : 'No conversations yet'}
          </div>
        ) : (
          filtered.map(convo => {
            const isActive = convo.id === activeId
            const otherParticipant = convo.type === 'direct'
              ? convo.participants.find(p => p.userId !== currentUserId)
              : null

            return (
              <button
                key={convo.id}
                onClick={() => onSelect(convo.id)}
                className={`w-full flex items-start gap-3 px-3 py-2.5 text-left transition-colors ${
                  isActive
                    ? 'bg-blue-50 dark:bg-blue-900/20'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
              >
                {/* Avatar */}
                <div className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-medium ${
                  convo.type === 'group'
                    ? (GROUP_COLORS[convo.avatarColor || 'blue'] || 'bg-blue-500')
                    : 'bg-gray-400 dark:bg-gray-500'
                }`}>
                  {convo.type === 'group'
                    ? <Users className="w-5 h-5" />
                    : getInitials(otherParticipant?.name || convo.name)
                  }
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className={`text-sm truncate ${
                      convo.unreadCount > 0
                        ? 'font-semibold text-gray-900 dark:text-white'
                        : 'font-medium text-gray-700 dark:text-gray-300'
                    }`}>
                      {convo.name}
                    </span>
                    <span className="text-[11px] text-gray-400 dark:text-gray-500 shrink-0 ml-2">
                      {formatRelativeTime(convo.lastMessageAt)}
                    </span>
                  </div>
                  {!compact && (
                    <div className="flex items-center justify-between mt-0.5">
                      <p className={`text-xs truncate ${
                        convo.unreadCount > 0
                          ? 'text-gray-700 dark:text-gray-300'
                          : 'text-gray-500 dark:text-gray-400'
                      }`}>
                        {convo.lastMessagePreview
                          ? `${convo.lastMessageSenderName ? convo.lastMessageSenderName.split(' ')[0] + ': ' : ''}${convo.lastMessagePreview}`
                          : 'No messages yet'
                        }
                      </p>
                      {convo.unreadCount > 0 && (
                        <span className="ml-2 shrink-0 inline-flex items-center justify-center w-5 h-5 text-[10px] font-bold text-white bg-blue-600 rounded-full">
                          {convo.unreadCount > 9 ? '9+' : convo.unreadCount}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
