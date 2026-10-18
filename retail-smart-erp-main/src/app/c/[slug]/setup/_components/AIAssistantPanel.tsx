'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Sparkles, X, Send, Loader2, Bot, User } from 'lucide-react'

interface AIAssistantPanelProps {
  companySlug: string
  currentStep: string
  context: {
    businessType?: string
    country?: string
    countryName?: string
    currency?: string
    companyName?: string
  }
}

interface Message {
  role: 'user' | 'assistant'
  text: string
}

const stepSuggestions: Record<string, string[]> = {
  Profile: [
    'What tax rate should I use?',
    'When does my fiscal year start?',
  ],
  Configure: [
    'Suggest categories for my business',
  ],
  Warehouses: [
    'How should I name my warehouses?',
  ],
  Accounting: [
    'What cost centers do I need?',
  ],
  Employees: [
    'What employee roles do I need?',
    'What payroll cycle should I use?',
  ],
  Commissions: [
    'What commission rate is standard?',
    'Should I enable commissions for all sales?',
  ],
  Loyalty: [
    'What loyalty program features should I include?',
  ],
  Notifications: [
    'Which notification providers should I use?',
  ],
  Documents: [
    'What should my invoice prefix be?',
  ],
  POS: [
    'Which payment methods should I enable?',
  ],
  Team: [
    'What roles should I assign to my team?',
  ],
}

export function AIAssistantPanel({ companySlug, currentStep, context }: AIAssistantPanelProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      text: "Hi! I'm your setup assistant. Ask me anything about configuring your business.",
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus()
    }
  }, [isOpen])

  const suggestions = stepSuggestions[currentStep] || []

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return

    const userMessage: Message = { role: 'user', text: text.trim() }
    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setLoading(true)

    try {
      const res = await fetch(`/api/c/${companySlug}/setup/ai-suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: text.trim(),
          context,
        }),
      })

      if (!res.ok) {
        throw new Error('Request failed')
      }

      const data = await res.json()
      const assistantMessage: Message = {
        role: 'assistant',
        text: data.response || data.answer || data.suggestion || 'I could not generate a response. Please try again.',
      }
      setMessages((prev) => [...prev, assistantMessage])
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: 'AI not available right now. Please try again later or continue with the setup.',
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    sendMessage(input)
  }

  const handleSuggestionClick = (suggestion: string) => {
    sendMessage(suggestion)
  }

  return (
    <>
      {/* Toggle Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 transition-all"
        >
          <Sparkles size={18} />
          <span className="text-sm font-medium">AI</span>
        </button>
      )}

      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/20 z-40"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Panel */}
      {isOpen && (
        <div className="fixed right-0 top-0 bottom-0 w-[360px] bg-white dark:bg-slate-800 border-l border-gray-200 dark:border-gray-700 shadow-xl z-50 flex flex-col">
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles size={18} className="text-blue-600" />
              <h3 className="font-semibold text-gray-900 dark:text-white text-sm">
                AI Setup Assistant
              </h3>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((msg, index) => (
              <div
                key={index}
                className={`flex items-start gap-2 ${
                  msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'
                }`}
              >
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                    msg.role === 'user'
                      ? 'bg-blue-100 dark:bg-blue-900/30'
                      : 'bg-gray-100 dark:bg-slate-700'
                  }`}
                >
                  {msg.role === 'user' ? (
                    <User size={14} className="text-blue-600 dark:text-blue-400" />
                  ) : (
                    <Bot size={14} className="text-gray-500 dark:text-gray-400" />
                  )}
                </div>
                <div
                  className={
                    msg.role === 'user'
                      ? 'ml-auto max-w-[80%] px-3 py-2 bg-blue-600 text-white rounded rounded-br-none text-sm'
                      : 'mr-auto max-w-[80%] px-3 py-2 bg-gray-100 dark:bg-slate-700 text-gray-900 dark:text-white rounded rounded-bl-none text-sm'
                  }
                >
                  <p className="whitespace-pre-wrap">{msg.text}</p>
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex items-start gap-2">
                <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 bg-gray-100 dark:bg-slate-700">
                  <Bot size={14} className="text-gray-500 dark:text-gray-400" />
                </div>
                <div className="mr-auto max-w-[80%] px-3 py-2 bg-gray-100 dark:bg-slate-700 rounded rounded-bl-none text-sm">
                  <div className="flex items-center gap-1">
                    <Loader2 size={14} className="animate-spin text-gray-400" />
                    <span className="text-gray-500 dark:text-gray-400 text-xs">Thinking...</span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Quick Suggestions */}
          {suggestions.length > 0 && messages.length <= 2 && (
            <div className="flex flex-wrap gap-2 px-4 py-2 border-t border-gray-100 dark:border-gray-700/50">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => handleSuggestionClick(suggestion)}
                  disabled={loading}
                  className="px-3 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded-full hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors disabled:opacity-50"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}

          {/* Input Area */}
          <form
            onSubmit={handleSubmit}
            className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex gap-2"
          >
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question..."
              disabled={loading}
              className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-700 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!input.trim() || loading}
              className="p-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send size={18} />
            </button>
          </form>
        </div>
      )}
    </>
  )
}
