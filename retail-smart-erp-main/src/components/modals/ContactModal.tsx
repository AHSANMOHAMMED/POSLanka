'use client'

import { useState, useRef } from 'react'
import { Modal } from '@/components/ui/modal'
import { Phone, MessageSquare, Send, Loader2 } from 'lucide-react'

interface ContactModalProps {
  isOpen: boolean
  onClose: () => void
}

const PHONE_NUMBER = '+94778407616'
const WHATSAPP_NUMBER = '94778407616'

export function ContactModal({ isOpen, onClose }: ContactModalProps) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', message: '' })
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSending(true)

    // MVP: open mailto link
    const subject = encodeURIComponent('Enterprise Plan Inquiry')
    const body = encodeURIComponent(
      `Name: ${form.name}\nEmail: ${form.email}\nPhone: ${form.phone}\n\n${form.message}`
    )
    window.open(`mailto:hello@retailsmarterp.com?subject=${subject}&body=${body}`, '_blank')

    setSending(false)
    setSent(true)
    timeoutRef.current = setTimeout(() => {
      setSent(false)
      setForm({ name: '', email: '', phone: '', message: '' })
      onClose()
    }, 2000)
  }

  function handleClose() {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    setForm({ name: '', email: '', phone: '', message: '' })
    setSent(false)
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Let's Talk" size="md" closeOnBackdrop>
      <div className="space-y-6">
        {/* Subtitle */}
        <p className="text-gray-500 dark:text-gray-400">
          Get in touch to discuss Enterprise solutions tailored for your business.
        </p>

        {/* Contact Options */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <a
            href={`tel:${PHONE_NUMBER}`}
            className="flex items-center gap-3 p-4 rounded-md border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            <div className="w-10 h-10 rounded bg-blue-100 dark:bg-blue-500/20 flex items-center justify-center flex-shrink-0">
              <Phone className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">Call Us</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">077 840 7616</p>
            </div>
          </a>

          <a
            href={`https://wa.me/${WHATSAPP_NUMBER}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-4 rounded-md border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            <div className="w-10 h-10 rounded bg-green-100 dark:bg-green-500/20 flex items-center justify-center flex-shrink-0">
              <MessageSquare className="w-5 h-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">WhatsApp</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Chat with us</p>
            </div>
          </a>
        </div>

        {/* Divider */}
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200 dark:border-gray-600" />
          </div>
          <div className="relative flex justify-center">
            <span className="bg-white dark:bg-gray-800 px-3 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Or send us a message
            </span>
          </div>
        </div>

        {/* Contact Form */}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <input
              type="text"
              name="name"
              placeholder="Your name"
              required
              value={form.name}
              onChange={handleChange}
              className="w-full px-3 py-2 text-sm rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <input
              type="email"
              name="email"
              placeholder="Email address"
              required
              value={form.email}
              onChange={handleChange}
              className="w-full px-3 py-2 text-sm rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <input
              type="tel"
              name="phone"
              placeholder="Phone number"
              value={form.phone}
              onChange={handleChange}
              className="w-full px-3 py-2 text-sm rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <textarea
              name="message"
              placeholder="Tell us about your business needs..."
              rows={3}
              required
              value={form.message}
              onChange={handleChange}
              className="w-full px-3 py-2 text-sm rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            />
          </div>
          <button
            type="submit"
            disabled={sending || sent}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {sent ? (
              'Message sent!'
            ) : sending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                Send Message
              </>
            )}
          </button>
        </form>
      </div>
    </Modal>
  )
}
