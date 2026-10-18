'use client'

import { useState, useCallback, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { MessageCircle, Plus, Users } from 'lucide-react'
import { useStaffChat } from '@/hooks/useStaffChat'
import { ConversationList } from '@/components/chat/ConversationList'
import { MessageList } from '@/components/chat/MessageList'
import { MessageInput } from '@/components/chat/MessageInput'
import { NewChatModal } from '@/components/chat/NewChatModal'

export default function ChatPage() {
  const { data: session } = useSession()
  const [showNewChat, setShowNewChat] = useState(false)
  const [hasMore, setHasMore] = useState(false)

  const {
    conversations,
    activeConversationId,
    messages,
    messagesLoading,
    setActiveConversation,
    setWidgetOpen,
    fetchConversations,
    fetchMessages,
    sendMessage,
    markAsRead,
  } = useStaffChat()

  const userId = session?.user?.id || ''

  // Close widget when on full page
  useEffect(() => {
    setWidgetOpen(false)
  }, [setWidgetOpen])

  const handleSelectConversation = useCallback(async (id: string) => {
    setActiveConversation(id)
    const data = await fetchMessages(id)
    if (data) setHasMore(data.hasMore)
    markAsRead(id)
  }, [setActiveConversation, fetchMessages, markAsRead])

  const handleSendMessage = useCallback(async (content: string) => {
    if (!activeConversationId) return
    await sendMessage(activeConversationId, content)
  }, [activeConversationId, sendMessage])

  const handleNewChatCreated = useCallback(async (conversationId: string) => {
    await fetchConversations()
    handleSelectConversation(conversationId)
  }, [fetchConversations, handleSelectConversation])

  const handleLoadMore = useCallback(async () => {
    if (!activeConversationId || messages.length === 0) return
    const data = await fetchMessages(activeConversationId, messages[0]?.id)
    if (data) setHasMore(data.hasMore)
  }, [activeConversationId, messages, fetchMessages])

  const activeConversation = conversations.find(c => c.id === activeConversationId)

  return (
    <div className="h-[calc(100vh-5rem)] flex rounded-md overflow-hidden border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      {/* Left panel - Conversation list */}
      <div className="w-80 border-r border-gray-200 dark:border-gray-700 flex flex-col bg-gray-50 dark:bg-gray-800">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-blue-600" />
            <h1 className="font-semibold text-gray-900 dark:text-white">Chat</h1>
          </div>
          <button
            onClick={() => setShowNewChat(true)}
            className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
            title="New chat"
          >
            <Plus className="w-4 h-4 text-gray-600 dark:text-gray-400" />
          </button>
        </div>

        {/* Conversation list */}
        <ConversationList
          conversations={conversations}
          activeId={activeConversationId}
          currentUserId={userId}
          onSelect={handleSelectConversation}
        />
      </div>

      {/* Right panel - Active chat */}
      <div className="flex-1 flex flex-col min-w-0">
        {activeConversation ? (
          <>
            {/* Chat header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-3 min-w-0">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-medium shrink-0 ${
                  activeConversation.type === 'group' ? 'bg-blue-500' : 'bg-gray-400'
                }`}>
                  {activeConversation.type === 'group'
                    ? <Users className="w-5 h-5" />
                    : (activeConversation.name?.[0] || '?').toUpperCase()
                  }
                </div>
                <div className="min-w-0">
                  <h2 className="font-semibold text-gray-900 dark:text-white truncate">
                    {activeConversation.name}
                  </h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {activeConversation.type === 'group'
                      ? `${activeConversation.participants.length} members`
                      : activeConversation.participants.find(p => p.userId !== userId)?.role || ''
                    }
                  </p>
                </div>
              </div>
            </div>

            {/* Messages */}
            <MessageList
              messages={messages}
              currentUserId={userId}
              loading={messagesLoading}
              hasMore={hasMore}
              onLoadMore={handleLoadMore}
            />

            {/* Input */}
            <MessageInput onSend={handleSendMessage} />
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 dark:text-gray-500">
            <MessageCircle className="w-12 h-12 mb-3 opacity-50" />
            <p className="text-sm font-medium">Select a conversation</p>
            <p className="text-xs mt-1">or start a new chat</p>
            <button
              onClick={() => setShowNewChat(true)}
              className="mt-4 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors flex items-center gap-2"
            >
              <Plus className="w-4 h-4" /> New Chat
            </button>
          </div>
        )}
      </div>

      <NewChatModal
        isOpen={showNewChat}
        onClose={() => setShowNewChat(false)}
        onCreated={handleNewChatCreated}
        currentUserId={userId}
      />
    </div>
  )
}
