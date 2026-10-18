import { create } from 'zustand'

export interface ChatConversation {
  id: string
  type: 'direct' | 'group'
  name: string
  description?: string | null
  avatarColor?: string | null
  lastMessageAt: string | null
  lastMessagePreview: string | null
  lastMessageSenderName: string | null
  unreadCount: number
  isMuted: boolean
  participants: ChatParticipant[]
  createdAt: string
}

export interface ChatParticipant {
  userId: string
  name: string | null
  email: string
  role: string
  chatRole: string
}

export interface ChatMessage {
  id: string
  conversationId: string
  senderId: string
  senderName: string
  content: string | null
  messageType: string
  metadata?: unknown
  isDeleted: boolean
  isEdited: boolean
  createdAt: string
}

interface ChatStore {
  // State
  conversations: ChatConversation[]
  activeConversationId: string | null
  messages: ChatMessage[]
  totalUnreadCount: number
  widgetOpen: boolean
  widgetView: 'list' | 'chat'
  loading: boolean
  messagesLoading: boolean

  // Actions
  setConversations: (conversations: ChatConversation[]) => void
  setActiveConversation: (id: string | null) => void
  setMessages: (messages: ChatMessage[]) => void
  addMessage: (message: ChatMessage) => void
  prependMessages: (messages: ChatMessage[]) => void
  setTotalUnreadCount: (count: number) => void
  toggleWidget: () => void
  setWidgetOpen: (open: boolean) => void
  setWidgetView: (view: 'list' | 'chat') => void
  setLoading: (loading: boolean) => void
  setMessagesLoading: (loading: boolean) => void

  // Conversation helpers
  updateConversationPreview: (conversationId: string, preview: string, senderName: string, timestamp: string) => void
  incrementUnread: (conversationId: string) => void
  markConversationRead: (conversationId: string) => void
  removeConversation: (conversationId: string) => void
}

export const useChatStore = create<ChatStore>((set, _get) => ({
  conversations: [],
  activeConversationId: null,
  messages: [],
  totalUnreadCount: 0,
  widgetOpen: false,
  widgetView: 'list',
  loading: false,
  messagesLoading: false,

  setConversations: (conversations) => set({ conversations }),

  setActiveConversation: (id) => set({ activeConversationId: id, messages: [] }),

  setMessages: (messages) => set({ messages }),

  addMessage: (message) => set((state) => ({
    messages: state.activeConversationId === message.conversationId
      ? [...state.messages, message]
      : state.messages,
  })),

  prependMessages: (messages) => set((state) => ({
    messages: [...messages, ...state.messages],
  })),

  setTotalUnreadCount: (count) => set({ totalUnreadCount: count }),

  toggleWidget: () => set((state) => ({
    widgetOpen: !state.widgetOpen,
    widgetView: state.widgetOpen ? state.widgetView : 'list',
  })),

  setWidgetOpen: (open) => set({ widgetOpen: open, widgetView: open ? 'list' : 'list' }),

  setWidgetView: (view) => set({ widgetView: view }),

  setLoading: (loading) => set({ loading }),

  setMessagesLoading: (loading) => set({ messagesLoading: loading }),

  updateConversationPreview: (conversationId, preview, senderName, timestamp) =>
    set((state) => ({
      conversations: state.conversations
        .map(c => c.id === conversationId ? {
          ...c,
          lastMessagePreview: preview,
          lastMessageSenderName: senderName,
          lastMessageAt: timestamp,
        } : c)
        .sort((a, b) => {
          const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0
          const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0
          return bTime - aTime
        }),
    })),

  incrementUnread: (conversationId) =>
    set((state) => ({
      conversations: state.conversations.map(c =>
        c.id === conversationId ? { ...c, unreadCount: c.unreadCount + 1 } : c
      ),
      totalUnreadCount: state.totalUnreadCount + 1,
    })),

  markConversationRead: (conversationId) =>
    set((state) => {
      const convo = state.conversations.find(c => c.id === conversationId)
      const unreadDelta = convo?.unreadCount || 0
      return {
        conversations: state.conversations.map(c =>
          c.id === conversationId ? { ...c, unreadCount: 0 } : c
        ),
        totalUnreadCount: Math.max(0, state.totalUnreadCount - unreadDelta),
      }
    }),

  removeConversation: (conversationId) =>
    set((state) => ({
      conversations: state.conversations.filter(c => c.id !== conversationId),
      activeConversationId: state.activeConversationId === conversationId ? null : state.activeConversationId,
      messages: state.activeConversationId === conversationId ? [] : state.messages,
    })),
}))
