'use client'

import { useState } from 'react'
import { Send, Loader2, CheckCircle } from 'lucide-react'

export default function ContactForm() {
  const [formData, setFormData] = useState({ name: '', email: '', company: '', businessType: '', message: '' })
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })
      if (!res.ok) throw new Error('Failed to send')
      setSent(true)
    } catch {
      setError('Failed to send message. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <div className="text-center py-12">
        <div className="w-14 h-14 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center mx-auto mb-4">
          <CheckCircle className="w-7 h-7 text-white" />
        </div>
        <h3 className="text-xl font-bold text-white mb-2">Message Sent!</h3>
        <p className="text-zinc-400">Thanks for reaching out! We&apos;ll get back to you as soon as possible.</p>
      </div>
    )
  }

  const inputClass = 'w-full px-4 py-2.5 rounded-md border border-white/10 bg-white/5 text-white text-sm placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 transition-all'

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="contact-name" className="block text-sm font-medium text-zinc-300 mb-1.5">Name *</label>
          <input
            id="contact-name"
            type="text"
            required
            value={formData.name}
            onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
            className={inputClass}
            placeholder="Your name"
          />
        </div>
        <div>
          <label htmlFor="contact-email" className="block text-sm font-medium text-zinc-300 mb-1.5">Email *</label>
          <input
            id="contact-email"
            type="email"
            required
            value={formData.email}
            onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
            className={inputClass}
            placeholder="you@example.com"
          />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="contact-company" className="block text-sm font-medium text-zinc-300 mb-1.5">Company</label>
          <input
            id="contact-company"
            type="text"
            value={formData.company}
            onChange={(e) => setFormData(prev => ({ ...prev, company: e.target.value }))}
            className={inputClass}
            placeholder="Your company"
          />
        </div>
        <div>
          <label htmlFor="contact-business" className="block text-sm font-medium text-zinc-300 mb-1.5">Business Type</label>
          <select
            id="contact-business"
            value={formData.businessType}
            onChange={(e) => setFormData(prev => ({ ...prev, businessType: e.target.value }))}
            className={inputClass}
          >
            <option value="">Select...</option>
            <option value="retail">Retail</option>
            <option value="restaurant">Restaurant</option>
            <option value="supermarket">Supermarket</option>
            <option value="auto_service">Auto Service</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>
      <div>
        <label htmlFor="contact-message" className="block text-sm font-medium text-zinc-300 mb-1.5">Message *</label>
        <textarea
          id="contact-message"
          required
          rows={5}
          value={formData.message}
          onChange={(e) => setFormData(prev => ({ ...prev, message: e.target.value }))}
          className={`${inputClass} resize-none`}
          placeholder="Tell us about your needs..."
        />
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 rounded-md transition-all shadow-lg shadow-emerald-600/25 hover:shadow-emerald-600/40 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        {loading ? 'Sending...' : 'Send Message'}
      </button>
    </form>
  )
}
