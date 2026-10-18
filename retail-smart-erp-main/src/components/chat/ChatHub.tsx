'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import {
  MessageCircle, X, Plus, ArrowLeft, Maximize2,
  Bot, Send, Loader2, Sparkles, Trash2,
} from 'lucide-react'
import { useSession } from 'next-auth/react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { useStaffChat } from '@/hooks/useStaffChat'
import { useChatStore } from '@/lib/stores/chat-store'
import { ConversationList } from './ConversationList'
import { MessageList } from './MessageList'
import { MessageInput } from './MessageInput'
import { NewChatModal } from './NewChatModal'
import { cn } from '@/lib/utils'

// ─── AI Markdown Renderer ────────────────────────────────────────────

function renderAiMarkdown(text: string, slugPrefix: string): React.ReactNode[] {
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []

  lines.forEach((line, lineIdx) => {
    if (lineIdx > 0) elements.push(<br key={`br-${lineIdx}`} />)

    const parts: React.ReactNode[] = []
    let remaining = line
    let partIdx = 0

    while (remaining.length > 0) {
      const linkMatch = remaining.match(/\[([^\]]+)\]\(([^)]+)\)/)
      const boldMatch = remaining.match(/\*\*([^*]+)\*\*/)
      const codeMatch = remaining.match(/`([^`]+)`/)

      const matches = [
        linkMatch ? { type: 'link' as const, match: linkMatch, index: linkMatch.index! } : null,
        boldMatch ? { type: 'bold' as const, match: boldMatch, index: boldMatch.index! } : null,
        codeMatch ? { type: 'code' as const, match: codeMatch, index: codeMatch.index! } : null,
      ].filter(Boolean).sort((a, b) => a!.index - b!.index)

      if (matches.length === 0) {
        parts.push(<span key={`p-${lineIdx}-${partIdx++}`}>{remaining}</span>)
        break
      }

      const first = matches[0]!
      const beforeText = remaining.slice(0, first.index)
      if (beforeText) {
        parts.push(<span key={`p-${lineIdx}-${partIdx++}`}>{beforeText}</span>)
      }

      if (first.type === 'link') {
        const [fullMatch, linkText, url] = first.match!
        const href = url.startsWith('/') ? `${slugPrefix}${url}` : url
        parts.push(
          <a
            key={`p-${lineIdx}-${partIdx++}`}
            href={href}
            className="text-purple-400 hover:text-purple-300 underline underline-offset-2"
            target={url.startsWith('http') ? '_blank' : undefined}
            rel={url.startsWith('http') ? 'noopener noreferrer' : undefined}
          >
            {linkText}
          </a>
        )
        remaining = remaining.slice(first.index + fullMatch.length)
      } else if (first.type === 'bold') {
        const [fullMatch, boldText] = first.match!
        parts.push(
          <strong key={`p-${lineIdx}-${partIdx++}`} className="font-semibold">
            {boldText}
          </strong>
        )
        remaining = remaining.slice(first.index + fullMatch.length)
      } else if (first.type === 'code') {
        const [fullMatch, codeText] = first.match!
        parts.push(
          <code key={`p-${lineIdx}-${partIdx++}`} className="bg-black/30 px-1 py-0.5 rounded text-xs font-mono">
            {codeText}
          </code>
        )
        remaining = remaining.slice(first.index + fullMatch.length)
      }
    }

    elements.push(<span key={`line-${lineIdx}`}>{parts}</span>)
  })

  return elements
}

// ─── AI Suggested Questions ──────────────────────────────────────────

const AI_SUGGESTED_QUESTIONS: Record<string, string[]> = {
  retail: [
    "What were today's total sales?",
    "Which items are running low on stock?",
    "Show me top customers this month",
    "Where can I manage my inventory?",
  ],
  restaurant: [
    "What were today's total sales?",
    "How many orders today?",
    "Show table availability",
    "How do I manage reservations?",
  ],
  auto_service: [
    "How many work orders are pending?",
    "Show today's appointments",
    "What were this week's sales?",
    "Where do I create a work order?",
  ],
  supermarket: [
    "What were today's total sales?",
    "Which items are running low?",
    "Show top selling items",
    "Where is the reorder dashboard?",
  ],
  dealership: [
    "How many vehicles in inventory?",
    "Show pending test drives",
    "What were this month's sales?",
    "Where do I add a new vehicle?",
  ],
}

// ─── Types ───────────────────────────────────────────────────────────

type ChatHubView = 'closed' | 'menu' | 'staff' | 'ai'

interface AiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

// ─── ChatHub Component ──────────────────────────────────────────────

export function ChatHub() {
  // Session & routing
  const { data: session } = useSession()
  const pathname = usePathname()

  // Hub view state
  const [view, setView] = useState<ChatHubView>('closed')

  // Staff chat (existing hook + store)
  const staffChat = useStaffChat()
  const chatStore = useChatStore()
  const [staffView, setStaffView] = useState<'list' | 'chat'>('list')
  const [showNewChat, setShowNewChat] = useState(false)
  const [hasMore, setHasMore] = useState(false)

  // AI chat state
  const [aiMessages, setAiMessages] = useState<AiMessage[]>([])
  const [aiInput, setAiInput] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null)

  // Refs
  const hubRef = useRef<HTMLDivElement>(null)
  const aiMessagesEndRef = useRef<HTMLDivElement>(null)
  const aiInputRef = useRef<HTMLInputElement>(null)

  // Derived
  const userId = session?.user?.id || ''
  const tenantSlug = (session?.user as { tenantSlug?: string })?.tenantSlug || ''
  const businessType = (session?.user as { businessType?: string })?.businessType || 'retail'
  const slugPrefix = tenantSlug ? `/c/${tenantSlug}` : ''
  const totalUnreadCount = chatStore.totalUnreadCount
  const isChatPage = pathname?.includes('/chat')

  const suggestedQuestions = useMemo(() => {
    return AI_SUGGESTED_QUESTIONS[businessType] || AI_SUGGESTED_QUESTIONS.retail
  }, [businessType])

  // ─── Effects ─────────────────────────────────────────────────────

  // Check AI enabled
  useEffect(() => {
    fetch('/api/ai/status')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setAiEnabled(d.enabled))
      .catch(() => setAiEnabled(false))
  }, [])

  // Auto-scroll AI messages
  useEffect(() => {
    aiMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [aiMessages])

  // Focus AI input when AI panel opens
  useEffect(() => {
    if (view === 'ai') {
      setTimeout(() => aiInputRef.current?.focus(), 150)
    }
  }, [view])

  // Click outside to close
  useEffect(() => {
    if (view === 'closed') return
    function handleClickOutside(e: MouseEvent) {
      if (hubRef.current && !hubRef.current.contains(e.target as Node)) {
        setView('closed')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [view])

  // ESC to close
  useEffect(() => {
    if (view === 'closed') return
    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setView('closed')
    }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [view])

  // Sync: Navbar chatStore.widgetOpen → open staff panel
  useEffect(() => {
    if (chatStore.widgetOpen && view === 'closed') {
      setView('staff')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatStore.widgetOpen])

  // Sync: when ChatHub closes, reset store
  useEffect(() => {
    if (view === 'closed' && chatStore.widgetOpen) {
      chatStore.setWidgetOpen(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  // ─── FAB Handler ─────────────────────────────────────────────────

  const handleFabClick = useCallback(() => {
    if (view === 'closed') {
      // If AI is disabled, skip menu and go directly to staff chat
      if (!aiEnabled) {
        setView('staff')
      } else {
        setView('menu')
      }
    } else {
      setView('closed')
    }
  }, [view, aiEnabled])

  // ─── Staff Chat Handlers ─────────────────────────────────────────

  const handleSelectConversation = useCallback(async (id: string) => {
    staffChat.setActiveConversation(id)
    setStaffView('chat')
    const data = await staffChat.fetchMessages(id)
    if (data) setHasMore(data.hasMore)
    staffChat.markAsRead(id)
  }, [staffChat])

  const handleStaffSendMessage = useCallback(async (content: string) => {
    if (!staffChat.activeConversationId) return
    await staffChat.sendMessage(staffChat.activeConversationId, content)
  }, [staffChat])

  const handleStaffBack = useCallback(() => {
    setStaffView('list')
    staffChat.setActiveConversation(null)
    staffChat.fetchConversations()
  }, [staffChat])

  const handleNewChatCreated = useCallback(async (conversationId: string) => {
    await staffChat.fetchConversations()
    handleSelectConversation(conversationId)
  }, [staffChat, handleSelectConversation])

  const handleStaffLoadMore = useCallback(async () => {
    if (!staffChat.activeConversationId || staffChat.messages.length === 0) return
    const data = await staffChat.fetchMessages(staffChat.activeConversationId, staffChat.messages[0]?.id)
    if (data) setHasMore(data.hasMore)
  }, [staffChat])

  const activeConversation = staffChat.conversations.find(c => c.id === staffChat.activeConversationId)

  // ─── AI Chat Handlers ────────────────────────────────────────────

  const clearAiChat = useCallback(() => {
    setAiMessages([])
  }, [])

  const sendAiMessage = useCallback(async (directMessage?: string) => {
    const trimmed = (directMessage || aiInput).trim()
    if (!trimmed || aiLoading) return

    const userMsg: AiMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
      timestamp: new Date(),
    }

    setAiMessages(prev => [...prev, userMsg])
    setAiInput('')
    setAiLoading(true)

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          context: { page: pathname },
        }),
      })

      if (!res.ok) throw new Error('AI request failed')
      const data = await res.json()

      setAiMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.response || 'Sorry, I couldn\'t process that.',
        timestamp: new Date(),
      }])
    } catch {
      setAiMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'An error occurred. Please try again.',
        timestamp: new Date(),
      }])
    } finally {
      setAiLoading(false)
    }
  }, [aiInput, aiLoading, pathname])

  // ─── Render ──────────────────────────────────────────────────────

  if (isChatPage) return null

  return (
    <>
      <div ref={hubRef} className="fixed bottom-5 right-5 z-40">

        {/* ── Speed Dial Menu ────────────────────────────────── */}
        {view === 'menu' && (
          <div className="absolute bottom-14 right-0 flex flex-col gap-2 w-56">
            {/* AI Assistant (top, farther from FAB) */}
            <button
              type="button"
              onClick={() => setView('ai')}
              className="speed-dial-item animate-speed-dial-in flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:shadow-xl hover:scale-[1.02] transition-all text-left"
            >
              <div className="w-9 h-9 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center shrink-0">
                <Bot size={18} className="text-purple-600 dark:text-purple-400" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium text-gray-900 dark:text-white">AI Assistant</span>
                  <span className="text-[10px] bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 px-1.5 py-0.5 rounded-full font-medium">Beta</span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Ask about your data</p>
              </div>
            </button>
            {/* Team Chat (bottom, closer to FAB) */}
            <button
              type="button"
              onClick={() => setView('staff')}
              className="speed-dial-item animate-speed-dial-in flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:shadow-xl hover:scale-[1.02] transition-all text-left"
            >
              <div className="relative w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
                <MessageCircle size={18} className="text-blue-600 dark:text-blue-400" />
                {totalUnreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                    {totalUnreadCount > 9 ? '9+' : totalUnreadCount}
                  </span>
                )}
              </div>
              <div className="min-w-0">
                <span className="text-sm font-medium text-gray-900 dark:text-white">Team Chat</span>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {totalUnreadCount > 0
                    ? `${totalUnreadCount} unread message${totalUnreadCount > 1 ? 's' : ''}`
                    : 'Chat with your team'}
                </p>
              </div>
            </button>
          </div>
        )}

        {/* ── Staff Chat Panel ───────────────────────────────── */}
        {view === 'staff' && (
          <div className="absolute bottom-14 right-0 w-[380px] h-[550px] bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden animate-chat-panel">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
              {staffView === 'chat' && activeConversation ? (
                <>
                  <div className="flex items-center gap-2 min-w-0">
                    <button type="button" onClick={handleStaffBack} className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded shrink-0">
                      <ArrowLeft className="w-4 h-4 text-gray-500" />
                    </button>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                        {activeConversation.name}
                      </p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">
                        {activeConversation.type === 'group'
                          ? `${activeConversation.participants.filter(p => p.userId !== userId).length + 1} members`
                          : activeConversation.participants.find(p => p.userId !== userId)?.role || ''
                        }
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {aiEnabled && (
                      <button
                        type="button"
                        onClick={() => setView('ai')}
                        className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                        title="Switch to AI Assistant"
                      >
                        <Bot size={14} className="text-purple-500" />
                      </button>
                    )}
                    <Link
                      href={`/c/${tenantSlug}/chat`}
                      onClick={() => setView('closed')}
                      className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                      title="Open full view"
                    >
                      <Maximize2 className="w-3.5 h-3.5 text-gray-500" />
                    </Link>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <MessageCircle className="w-4 h-4 text-blue-600" />
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">Team Chat</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {aiEnabled && (
                      <button
                        type="button"
                        onClick={() => setView('ai')}
                        className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                        title="Switch to AI Assistant"
                      >
                        <Bot size={14} className="text-purple-500" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowNewChat(true)}
                      className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                      title="New chat"
                    >
                      <Plus className="w-4 h-4 text-gray-500" />
                    </button>
                    <Link
                      href={`/c/${tenantSlug}/chat`}
                      onClick={() => setView('closed')}
                      className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                      title="Open full view"
                    >
                      <Maximize2 className="w-3.5 h-3.5 text-gray-500" />
                    </Link>
                    <button
                      type="button"
                      onClick={() => setView('closed')}
                      className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                    >
                      <X className="w-4 h-4 text-gray-500" />
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Content */}
            {staffView === 'list' ? (
              <ConversationList
                conversations={staffChat.conversations}
                activeId={staffChat.activeConversationId}
                currentUserId={userId}
                onSelect={handleSelectConversation}
              />
            ) : (
              <div className="flex flex-col flex-1 min-h-0">
                <MessageList
                  messages={staffChat.messages}
                  currentUserId={userId}
                  loading={staffChat.messagesLoading}
                  hasMore={hasMore}
                  onLoadMore={handleStaffLoadMore}
                />
                <MessageInput onSend={handleStaffSendMessage} />
              </div>
            )}
          </div>
        )}

        {/* ── AI Chat Panel ──────────────────────────────────── */}
        {view === 'ai' && (
          <div className="absolute bottom-14 right-0 w-[380px] h-[550px] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-chat-panel">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-purple-600 text-white rounded-t-2xl">
              <div className="flex items-center gap-2">
                <Bot size={18} />
                <span className="font-medium text-sm">RetailSmart AI</span>
                <span className="text-[10px] bg-purple-500 px-1.5 py-0.5 rounded-full">Beta</span>
              </div>
              <div className="flex items-center gap-1">
                {/* Switch to Team Chat */}
                <button
                  type="button"
                  onClick={() => setView('staff')}
                  className="relative p-1 hover:bg-purple-500 rounded transition-colors"
                  title="Switch to Team Chat"
                >
                  <MessageCircle size={14} />
                  {totalUnreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-red-400 rounded-full border border-purple-600" />
                  )}
                </button>
                {aiMessages.length > 0 && (
                  <button
                    type="button"
                    onClick={clearAiChat}
                    className="p-1 hover:bg-purple-500 rounded transition-colors"
                    title="Clear chat"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setView('closed')}
                  className="p-1 hover:bg-purple-500 rounded transition-colors"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {aiMessages.length === 0 && (
                <div className="text-center py-8">
                  <Sparkles size={32} className="mx-auto text-purple-300 mb-3" />
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Hi! I&apos;m your AI assistant.
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Ask me about your data, find pages, or get help with tasks.
                  </p>
                  <div className="mt-4 space-y-1.5">
                    {suggestedQuestions.map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => sendAiMessage(q)}
                        className="block w-full text-left text-xs px-3 py-2 rounded bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-purple-50 dark:hover:bg-purple-900/20 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {aiMessages.map(msg => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded px-3 py-2 text-sm ${
                      msg.role === 'user'
                        ? 'bg-purple-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'
                    }`}
                  >
                    <div className="whitespace-pre-wrap break-words leading-relaxed">
                      {msg.role === 'assistant'
                        ? renderAiMarkdown(msg.content, slugPrefix)
                        : msg.content
                      }
                    </div>
                  </div>
                </div>
              ))}

              {aiLoading && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 dark:bg-gray-700 rounded px-3 py-2 flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin text-purple-500" />
                    <span className="text-xs text-gray-500 dark:text-gray-400">Thinking...</span>
                  </div>
                </div>
              )}

              <div ref={aiMessagesEndRef} />
            </div>

            {/* Input */}
            <div className="border-t border-gray-200 dark:border-gray-700 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <input
                  ref={aiInputRef}
                  type="text"
                  value={aiInput}
                  onChange={e => setAiInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAiMessage() } }}
                  placeholder="Ask anything..."
                  className="flex-1 text-sm px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  disabled={aiLoading}
                  maxLength={2000}
                />
                <button
                  type="button"
                  onClick={() => sendAiMessage()}
                  disabled={!aiInput.trim() || aiLoading}
                  className="p-2 rounded bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Send size={16} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── FAB Button ─────────────────────────────────────── */}
        {(view === 'closed' || view === 'menu') && (
          <button
            type="button"
            onClick={handleFabClick}
            className={cn(
              'relative w-11 h-11 rounded-full shadow-lg flex items-center justify-center transition-all duration-200 text-white',
              view === 'closed'
                ? 'bg-gradient-to-br from-blue-500 to-purple-600 hover:shadow-xl hover:scale-105 active:scale-95'
                : 'bg-gray-700 dark:bg-gray-600 hover:bg-gray-600 dark:hover:bg-gray-500'
            )}
            aria-label={view === 'closed' ? 'Open chat' : 'Close chat menu'}
          >
            <div className={cn('transition-transform duration-200', view === 'menu' && 'rotate-[135deg]')}>
              {view === 'closed' ? <MessageCircle size={20} /> : <Plus size={20} />}
            </div>

            {/* Unread badge */}
            {view === 'closed' && totalUnreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center animate-scale-in">
                {totalUnreadCount > 9 ? '9+' : totalUnreadCount}
              </span>
            )}
          </button>
        )}
      </div>

      {/* New Chat Modal (outside hub for z-index) */}
      <NewChatModal
        isOpen={showNewChat}
        onClose={() => setShowNewChat(false)}
        onCreated={handleNewChatCreated}
        currentUserId={userId}
      />
    </>
  )
}
