'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRealtimeData } from '@/hooks'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Send,
  Loader2,
  Clock,
  CheckCircle,
  Lock,
  Unlock,
  User,
  Headphones,
} from 'lucide-react'

interface Message {
  id: string
  senderType: string
  senderName: string | null
  content: string
  isSystemMessage: boolean
  createdAt: string
}

interface Conversation {
  id: string
  subject: string
  status: string
  priority: string
  category: string | null
  createdAt: string
}

function formatTime(date: string) {
  const d = new Date(date)
  const now = new Date()
  const diff = now.getTime() - d.getTime()

  if (diff < 86400000) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  if (diff < 604800000) {
    return d.toLocaleDateString([], { weekday: 'short' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function ConversationPage() {
  const params = useParams()
  const router = useRouter()
  const conversationId = params.conversationId as string
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [newMessage, setNewMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [toggling, setToggling] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const fetchConversation = useCallback(async () => {
    try {
      const res = await fetch(`/api/account/messages/${conversationId}`)
      if (res.ok) {
        const data = await res.json()
        setConversation(data.conversation)
        setMessages(data.messages)
      } else {
        router.push('/account/messages')
      }
    } catch {
      router.push('/account/messages')
    } finally {
      setLoading(false)
    }
  }, [conversationId, router])

  // Real-time updates via WebSocket
  useRealtimeData(fetchConversation, { entityType: 'account-message' })

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMessage.trim() || sending) return

    setSending(true)
    try {
      const res = await fetch(`/api/account/messages/${conversationId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newMessage }),
      })

      if (res.ok) {
        const msg = await res.json()
        setMessages(prev => [...prev, msg])
        setNewMessage('')
      }
    } catch {
      alert('Failed to send message')
    } finally {
      setSending(false)
    }
  }

  const toggleConversation = async () => {
    if (!conversation) return
    setToggling(true)
    try {
      const action = conversation.status === 'closed' ? 'reopen' : 'close'
      const res = await fetch(`/api/account/messages/${conversationId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (res.ok) {
        setConversation(prev => prev ? { ...prev, status: action === 'close' ? 'closed' : 'open' } : prev)
      }
    } catch {
      alert('Failed to update conversation')
    } finally {
      setToggling(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    )
  }

  if (!conversation) return null

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-t-xl">
        <div className="flex items-center gap-3">
          <Link
            href="/account/messages"
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          >
            <ArrowLeft className="w-5 h-5 text-gray-500" />
          </Link>
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-white">{conversation.subject}</h2>
            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <span className={`inline-flex items-center gap-1 ${conversation.status === 'open' ? 'text-green-600' : 'text-gray-500'}`}>
                {conversation.status === 'open' ? <Clock className="w-3 h-3" /> : <CheckCircle className="w-3 h-3" />}
                {conversation.status}
              </span>
              {conversation.category && <span className="capitalize">| {conversation.category}</span>}
            </div>
          </div>
        </div>
        <button
          onClick={toggleConversation}
          disabled={toggling}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors ${
            conversation.status === 'closed'
              ? 'text-green-700 bg-green-50 hover:bg-green-100 dark:bg-green-900/20 dark:text-green-400'
              : 'text-gray-700 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300'
          }`}
        >
          {toggling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : conversation.status === 'closed' ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
          {conversation.status === 'closed' ? 'Reopen' : 'Close'}
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50 dark:bg-gray-900">
        {messages.map(msg => (
          <div
            key={msg.id}
            className={`flex ${msg.senderType === 'account' ? 'justify-end' : 'justify-start'}`}
          >
            <div className={`max-w-[75%] ${msg.senderType === 'account' ? 'order-2' : ''}`}>
              <div className="flex items-center gap-2 mb-1">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
                  msg.senderType === 'account'
                    ? 'bg-blue-100 dark:bg-blue-900/30'
                    : 'bg-purple-100 dark:bg-purple-900/30'
                }`}>
                  {msg.senderType === 'account'
                    ? <User className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    : <Headphones className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                  }
                </div>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {msg.senderName || (msg.senderType === 'admin' ? 'Support' : 'You')}
                </span>
                <span className="text-[11px] text-gray-400 dark:text-gray-500">
                  {formatTime(msg.createdAt)}
                </span>
              </div>
              <div className={`rounded-md px-4 py-2.5 ${
                msg.senderType === 'account'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-700'
              }`}>
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
              </div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Message Input */}
      {conversation.status !== 'closed' ? (
        <form onSubmit={sendMessage} className="p-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-b-xl">
          <div className="flex items-end gap-3">
            <textarea
              value={newMessage}
              onChange={e => setNewMessage(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  sendMessage(e)
                }
              }}
              placeholder="Type your message..."
              rows={1}
              className="flex-1 px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            />
            <button
              type="submit"
              disabled={sending || !newMessage.trim()}
              className="p-2.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </button>
          </div>
        </form>
      ) : (
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 rounded-b-xl text-center text-sm text-gray-500 dark:text-gray-400">
          This conversation is closed. Reopen to send a message.
        </div>
      )}
    </div>
  )
}
