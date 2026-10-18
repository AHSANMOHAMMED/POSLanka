'use client'

import { useRef, useEffect } from 'react'
import { ChatMessage } from '@/lib/stores/chat-store'
import { Loader2 } from 'lucide-react'

function formatTime(date: string) {
  return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDateLabel(date: string) {
  const d = new Date(date)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 86400000 && d.getDate() === now.getDate()) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.getDate() === yesterday.getDate() && d.getMonth() === yesterday.getMonth()) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

function getInitials(name: string) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

function shouldShowDateLabel(messages: ChatMessage[], index: number) {
  if (index === 0) return true
  const current = new Date(messages[index].createdAt).toDateString()
  const previous = new Date(messages[index - 1].createdAt).toDateString()
  return current !== previous
}

interface MessageListProps {
  messages: ChatMessage[]
  currentUserId: string
  loading?: boolean
  hasMore?: boolean
  onLoadMore?: () => void
}

export function MessageList({
  messages,
  currentUserId,
  loading = false,
  hasMore = false,
  onLoadMore,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const prevMessageCountRef = useRef(messages.length)

  // Auto-scroll to bottom on new messages (but not when loading older ones)
  useEffect(() => {
    if (messages.length > prevMessageCountRef.current) {
      const lastMsg = messages[messages.length - 1]
      // Only auto-scroll if the new message is at the end (not prepended)
      if (lastMsg && new Date(lastMsg.createdAt).getTime() > Date.now() - 5000) {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
      }
    }
    prevMessageCountRef.current = messages.length
  }, [messages])

  // Scroll to bottom on initial load
  useEffect(() => {
    if (messages.length > 0 && !loading) {
      bottomRef.current?.scrollIntoView()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (messages.length === 0 && !loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 dark:text-gray-500 text-sm">
        No messages yet. Say hello!
      </div>
    )
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
      {/* Load more button */}
      {hasMore && (
        <div className="text-center py-2">
          <button
            onClick={onLoadMore}
            disabled={loading}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Load older messages'}
          </button>
        </div>
      )}

      {messages.map((msg, index) => {
        const isOwn = msg.senderId === currentUserId
        const isSystem = msg.messageType === 'system'
        const showDate = shouldShowDateLabel(messages, index)

        // Show sender name if different from previous message sender
        const showSender = !isOwn && !isSystem && (
          index === 0 ||
          messages[index - 1].senderId !== msg.senderId ||
          messages[index - 1].messageType === 'system' ||
          shouldShowDateLabel(messages, index)
        )

        return (
          <div key={msg.id}>
            {/* Date label */}
            {showDate && (
              <div className="flex items-center justify-center py-2">
                <span className="px-3 py-0.5 bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 text-[11px] font-medium rounded-full">
                  {formatDateLabel(msg.createdAt)}
                </span>
              </div>
            )}

            {/* System message */}
            {isSystem ? (
              <div className="text-center py-1">
                <span className="text-[11px] text-gray-400 dark:text-gray-500 italic">
                  {msg.content}
                </span>
              </div>
            ) : (
              <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'} ${showSender ? 'mt-3' : 'mt-0.5'}`}>
                <div className={`max-w-[75%] ${isOwn ? 'items-end' : 'items-start'}`}>
                  {/* Sender name */}
                  {showSender && (
                    <div className="flex items-center gap-1.5 mb-0.5 px-1">
                      <div className="w-5 h-5 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center">
                        <span className="text-[9px] font-medium text-gray-600 dark:text-gray-300">
                          {getInitials(msg.senderName)}
                        </span>
                      </div>
                      <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
                        {msg.senderName.split(' ')[0]}
                      </span>
                    </div>
                  )}

                  {/* Message bubble */}
                  <div className={`group relative rounded-2xl px-3 py-2 ${
                    isOwn
                      ? 'bg-blue-600 text-white rounded-br-md'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white rounded-bl-md'
                  }`}>
                    {msg.isDeleted ? (
                      <p className="text-xs italic opacity-60">Message deleted</p>
                    ) : (
                      <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                    )}
                    <span className={`text-[10px] float-right ml-2 mt-1 ${
                      isOwn ? 'text-blue-200' : 'text-gray-400 dark:text-gray-500'
                    }`}>
                      {msg.isEdited && <span className="mr-1">edited</span>}
                      {formatTime(msg.createdAt)}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      })}
      <div ref={bottomRef} />
    </div>
  )
}
