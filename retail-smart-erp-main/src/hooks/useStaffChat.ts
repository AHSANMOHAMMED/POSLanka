'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useChatStore, ChatMessage } from '@/lib/stores/chat-store'
import { useWebSocket, useDataChange } from './useWebSocket'
import { useSession } from 'next-auth/react'
import type { DataChangeEvent } from '@/lib/websocket/events'

export function useStaffChat() {
  const store = useChatStore()
  const { status } = useWebSocket()
  const { data: session } = useSession()
  const currentUserId = session?.user?.id || ''
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const failCountRef = useRef(0)
  const storeRef = useRef(store)
  storeRef.current = store

  // Fetch conversations list
  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/chat/conversations')
      if (res.ok) {
        const data = await res.json()
        store.setConversations(data.data || [])
      }
    } catch {
      // silent fail
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch messages for active conversation
  const fetchMessages = useCallback(async (conversationId: string, before?: string) => {
    try {
      store.setMessagesLoading(true)
      const params = new URLSearchParams({ limit: '50' })
      if (before) params.set('before', before)
      const res = await fetch(`/api/chat/conversations/${conversationId}/messages?${params}`)
      if (res.ok) {
        const data = await res.json()
        if (before) {
          store.prependMessages(data.messages || [])
        } else {
          store.setMessages(data.messages || [])
        }
        return data
      }
    } catch {
      // silent fail
    } finally {
      store.setMessagesLoading(false)
    }
    return null
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Send a message
  const sendMessage = useCallback(async (conversationId: string, content: string): Promise<ChatMessage | null> => {
    try {
      const res = await fetch(`/api/chat/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      if (res.ok) {
        const msg = await res.json()
        store.addMessage(msg)
        store.updateConversationPreview(
          conversationId,
          content.slice(0, 100),
          msg.senderName,
          msg.createdAt
        )
        return msg
      }
    } catch {
      // silent fail
    }
    return null
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Mark conversation as read
  const markAsRead = useCallback(async (conversationId: string) => {
    store.markConversationRead(conversationId)
    try {
      await fetch(`/api/chat/conversations/${conversationId}/read`, { method: 'POST' })
    } catch {
      // silent fail
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch unread count with backoff on failure
  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await fetch('/api/chat/unread')
      if (res.ok) {
        const data = await res.json()
        store.setTotalUnreadCount(data.unreadCount || 0)
        failCountRef.current = 0
      } else {
        failCountRef.current++
      }
    } catch {
      failCountRef.current++
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Create conversation
  const createConversation = useCallback(async (
    type: 'direct' | 'group',
    participantIds: string[],
    name?: string,
    description?: string,
    avatarColor?: string
  ) => {
    try {
      const res = await fetch('/api/chat/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, participantIds, name, description, avatarColor }),
      })
      if (res.ok) {
        const data = await res.json()
        await fetchConversations()
        return data
      }
    } catch {
      // silent fail
    }
    return null
  }, [fetchConversations])

  // Listen for real-time chat events via WebSocket
  const handleChatEvent = useCallback((event: DataChangeEvent) => {
    const s = storeRef.current
    const data = event.data as { conversationId?: string; senderId?: string; senderName?: string; preview?: string; type?: string } | undefined

    // Ignore events from self (we already update local state on send)
    if (data?.senderId === currentUserId) return

    if (event.action === 'created' && data?.conversationId) {
      // New message received - refresh messages if viewing this conversation
      if (s.activeConversationId === data.conversationId) {
        fetchMessages(data.conversationId)
      }

      // Update conversation preview and unread count
      if (data.preview && data.senderName) {
        s.updateConversationPreview(
          data.conversationId,
          data.preview,
          data.senderName,
          new Date().toISOString()
        )
      }

      // Increment unread if not viewing this conversation
      if (s.activeConversationId !== data.conversationId || !s.widgetOpen) {
        s.incrementUnread(data.conversationId)
      }

      // If it's a new conversation we don't have, refresh the list
      if (data.type === 'new-conversation') {
        fetchConversations()
      }
    } else if (event.action === 'updated') {
      // Conversation updated (participants changed, etc.)
      fetchConversations()
    }
  }, [currentUserId, fetchMessages, fetchConversations])

  useDataChange('staff-chat', handleChatEvent, [handleChatEvent])

  // Poll unread count with exponential backoff on failure
  useEffect(() => {
    let cancelled = false

    const schedulePoll = () => {
      if (cancelled) return
      // Back off: 30s, 60s, 120s, max 5min on consecutive failures
      const delay = Math.min(30000 * Math.pow(2, failCountRef.current), 300000)
      pollIntervalRef.current = setTimeout(() => {
        if (cancelled || document.hidden) {
          schedulePoll()
          return
        }
        fetchUnreadCount().then(schedulePoll)
      }, delay)
    }

    fetchUnreadCount().then(schedulePoll)

    // Resume polling when tab becomes visible again
    const handleVisibility = () => {
      if (!document.hidden && failCountRef.current === 0) {
        fetchUnreadCount()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      cancelled = true
      if (pollIntervalRef.current) clearTimeout(pollIntervalRef.current)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [fetchUnreadCount])

  // Initial fetch of conversations
  useEffect(() => {
    fetchConversations()
  }, [fetchConversations])

  return {
    ...store,
    fetchConversations,
    fetchMessages,
    sendMessage,
    markAsRead,
    fetchUnreadCount,
    createConversation,
    isConnected: status === 'connected',
  }
}
