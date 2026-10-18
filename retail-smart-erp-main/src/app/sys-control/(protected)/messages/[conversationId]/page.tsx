'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Send,
  Loader2,
  User,
  Headphones,
  Clock,
  CheckCircle,
  Lock,
  Unlock,
  Archive,
  Mail,
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

interface Account {
  id: string
  email: string
  fullName: string | null
}

function formatTime(date: string) {
  const d = new Date(date)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 86400000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function AdminConversationPage() {
  const params = useParams()
  const router = useRouter()
  const conversationId = params.conversationId as string
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [account, setAccount] = useState<Account | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [newMessage, setNewMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [priority, setPriority] = useState('normal')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const fetchConversation = useCallback(async () => {
    try {
      const res = await fetch(`/api/sys-control/messages/${conversationId}`)
      if (res.ok) {
        const data = await res.json()
        setConversation(data.conversation)
        setAccount(data.account)
        setMessages(data.messages)
        setPriority(data.conversation.priority)
      } else {
        router.push('/sys-control/messages')
      }
    } catch {
      router.push('/sys-control/messages')
    } finally {
      setLoading(false)
    }
  }, [conversationId, router])

  useEffect(() => {
    fetchConversation()
    const interval = setInterval(fetchConversation, 15000)
    return () => clearInterval(interval)
  }, [fetchConversation])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendReply = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMessage.trim() || sending) return

    setSending(true)
    try {
      const res = await fetch(`/api/sys-control/messages/${conversationId}`, {
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
      alert('Failed to send reply')
    } finally {
      setSending(false)
    }
  }

  const updateConversation = async (action: string) => {
    try {
      await fetch(`/api/sys-control/messages/${conversationId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      fetchConversation()
    } catch {
      alert('Failed to update conversation')
    }
  }

  const updatePriority = async (newPriority: string) => {
    setPriority(newPriority)
    try {
      await fetch(`/api/sys-control/messages/${conversationId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority: newPriority }),
      })
    } catch {
      alert('Failed to update priority')
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
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
      {/* Main Chat Area */}
      <div className="lg:col-span-3 flex flex-col h-[calc(100vh-12rem)]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white rounded-t-xl">
          <div className="flex items-center gap-3">
            <Link href="/sys-control/messages" className="p-2 hover:bg-gray-100 rounded">
              <ArrowLeft className="w-5 h-5 text-gray-500" />
            </Link>
            <div>
              <h2 className="font-semibold text-gray-900">{conversation.subject}</h2>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span className={`inline-flex items-center gap-1 ${conversation.status === 'open' ? 'text-green-600' : 'text-gray-500'}`}>
                  {conversation.status === 'open' ? <Clock className="w-3 h-3" /> : <CheckCircle className="w-3 h-3" />}
                  {conversation.status}
                </span>
                {conversation.category && <span className="capitalize">| {conversation.category}</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {conversation.status === 'open' && (
              <button
                onClick={() => updateConversation('close')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded"
              >
                <Lock className="w-3.5 h-3.5" /> Close
              </button>
            )}
            {conversation.status === 'closed' && (
              <>
                <button
                  onClick={() => updateConversation('reopen')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 rounded"
                >
                  <Unlock className="w-3.5 h-3.5" /> Reopen
                </button>
                <button
                  onClick={() => updateConversation('archive')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded"
                >
                  <Archive className="w-3.5 h-3.5" /> Archive
                </button>
              </>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
          {messages.map(msg => (
            <div
              key={msg.id}
              className={`flex ${msg.senderType === 'admin' ? 'justify-end' : 'justify-start'}`}
            >
              <div className="max-w-[75%]">
                <div className="flex items-center gap-2 mb-1">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
                    msg.senderType === 'admin' ? 'bg-purple-100' : 'bg-blue-100'
                  }`}>
                    {msg.senderType === 'admin'
                      ? <Headphones className="w-3.5 h-3.5 text-purple-600" />
                      : <User className="w-3.5 h-3.5 text-blue-600" />
                    }
                  </div>
                  <span className="text-xs text-gray-500">{msg.senderName || (msg.senderType === 'admin' ? 'Support' : 'User')}</span>
                  <span className="text-[11px] text-gray-400">{formatTime(msg.createdAt)}</span>
                </div>
                <div className={`rounded-md px-4 py-2.5 ${
                  msg.senderType === 'admin'
                    ? 'bg-purple-600 text-white'
                    : 'bg-white text-gray-900 border border-gray-200'
                }`}>
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Reply */}
        <form onSubmit={sendReply} className="p-4 border-t border-gray-200 bg-white rounded-b-xl">
          <div className="flex items-end gap-3">
            <textarea
              value={newMessage}
              onChange={e => setNewMessage(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  sendReply(e)
                }
              }}
              placeholder="Type your reply..."
              rows={1}
              className="flex-1 px-4 py-2.5 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
            />
            <button
              type="submit"
              disabled={sending || !newMessage.trim()}
              className="p-2.5 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50"
            >
              {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </button>
          </div>
        </form>
      </div>

      {/* Sidebar */}
      <div className="space-y-4">
        {/* Account Info */}
        {account && (
          <div className="bg-white rounded-md border border-gray-200 p-4">
            <h3 className="font-semibold text-gray-900 text-sm mb-3">Account</h3>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-gray-400" />
                <span className="text-sm text-gray-900">{account.fullName || 'User'}</span>
              </div>
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-gray-400" />
                <span className="text-sm text-gray-600">{account.email}</span>
              </div>
            </div>
          </div>
        )}

        {/* Conversation Details */}
        <div className="bg-white rounded-md border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Details</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Priority</label>
              <select
                value={priority}
                onChange={e => updatePriority(e.target.value)}
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Category</label>
              <p className="text-sm text-gray-900 capitalize">{conversation.category || 'General'}</p>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Created</label>
              <p className="text-sm text-gray-900">{new Date(conversation.createdAt).toLocaleString()}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
