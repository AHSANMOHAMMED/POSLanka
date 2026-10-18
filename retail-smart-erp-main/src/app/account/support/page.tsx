'use client'

import { useState, useEffect } from 'react'
import {
  HelpCircle,
  MessageSquare,
  Book,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Mail,
  Phone,
  Search,
  FileText,
  Video,
  Zap,
  CheckCircle,
  Loader2,
  Send
} from 'lucide-react'

interface FAQItem {
  question: string
  answer: string
}

const faqs: FAQItem[] = [
  {
    question: 'How do I add a new site/company?',
    answer: 'Go to the Sites page and click "New Site". Fill in your business details, select a plan, and you\'re ready to go. You can add multiple sites under the same account.',
  },
  {
    question: 'How does billing work with multiple sites?',
    answer: 'Each site has its own subscription. We offer volume discounts: 15% off for 2-5 sites, 25% off for 6-10 sites, and 30% off for 11+ sites. All charges are consolidated into a single monthly invoice.',
  },
  {
    question: 'Can I invite team members to multiple sites?',
    answer: 'Yes! When inviting a team member, you can assign them to one or more sites with different roles (owner, manager, cashier, technician) for each site.',
  },
  {
    question: 'How do I upgrade or downgrade my plan?',
    answer: 'Go to the Billing page, find the site you want to change, and click "Manage Subscription". You can upgrade instantly or schedule a downgrade for the next billing cycle.',
  },
  {
    question: 'What payment methods do you accept?',
    answer: 'We accept all major credit cards (Visa, Mastercard, American Express) and PayPal. For enterprise customers, we also offer bank transfers and invoicing.',
  },
  {
    question: 'Is my data secure?',
    answer: 'Yes, we use industry-standard encryption (TLS 1.3) for all data in transit and AES-256 for data at rest. We also perform regular security audits and maintain SOC 2 compliance.',
  },
]

const resources = [
  {
    title: 'Documentation',
    description: 'Comprehensive guides and API reference',
    icon: Book,
    color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
  },
  {
    title: 'Video Tutorials',
    description: 'Step-by-step video guides',
    icon: Video,
    color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400',
  },
  {
    title: 'API Reference',
    description: 'Developer documentation',
    icon: FileText,
    color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
  },
  {
    title: 'Release Notes',
    description: 'Latest updates and features',
    icon: Zap,
    color: 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400',
  },
]

export default function SupportPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedFAQ, setExpandedFAQ] = useState<number | null>(null)
  const [ticketForm, setTicketForm] = useState({
    subject: '',
    category: 'general',
    priority: 'normal',
    message: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [contactEmail, setContactEmail] = useState('hello@retailsmarterp.com')
  const [contactPhone, setContactPhone] = useState('+94 77 840 7616')
  const [contactHours, setContactHours] = useState('Available 9am - 6pm IST')

  useEffect(() => {
    fetch('/api/public/settings')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.contactInfo) {
          if (data.contactInfo.email) setContactEmail(data.contactInfo.email)
          if (data.contactInfo.phone) setContactPhone(data.contactInfo.phone)
          if (data.contactInfo.businessHours) setContactHours(data.contactInfo.businessHours)
        }
      })
      .catch(() => {})
  }, [])

  const filteredFAQs = faqs.filter(
    (faq) =>
      faq.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
      faq.answer.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const handleSubmitTicket = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)

    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1500))

    setSubmitting(false)
    setSubmitted(true)
    setTicketForm({ subject: '', category: 'general', priority: 'normal', message: '' })

    setTimeout(() => setSubmitted(false), 5000)
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl mb-4">
          <HelpCircle className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Help & Support</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-2">Get help with your account and sites</p>
      </div>

      {/* Search */}
      <div className="relative max-w-xl mx-auto">
        <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 dark:text-gray-500" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search FAQs..."
          className="w-full pl-14 pr-5 py-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl text-lg dark:text-white focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-400 focus:border-transparent shadow-sm"
        />
      </div>

      {/* Quick Contact */}
      <div className="grid md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 hover:shadow-lg hover:border-gray-300 dark:hover:border-gray-600 transition-all">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-md flex items-center justify-center flex-shrink-0">
              <Mail className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">Email Support</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{contactEmail}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">Response within 24 hours</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 hover:shadow-lg hover:border-gray-300 dark:hover:border-gray-600 transition-all">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-md flex items-center justify-center flex-shrink-0">
              <MessageSquare className="w-6 h-6 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">Live Chat</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">Chat with our team</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">{contactHours}</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 hover:shadow-lg hover:border-gray-300 dark:hover:border-gray-600 transition-all">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/30 rounded-md flex items-center justify-center flex-shrink-0">
              <Phone className="w-6 h-6 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">Phone Support</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{contactPhone}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">Pro & Enterprise plans</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-8">
        {/* FAQs */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-100 dark:bg-amber-900/30 rounded-md flex items-center justify-center">
              <HelpCircle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Frequently Asked Questions</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">{filteredFAQs.length} results</p>
            </div>
          </div>
          {filteredFAQs.length === 0 ? (
            <div className="p-8 text-center text-gray-500 dark:text-gray-400">
              <HelpCircle className="w-12 h-12 text-gray-200 dark:text-gray-600 mx-auto mb-3" />
              <p>No FAQs match your search.</p>
              <p className="text-sm mt-1">Try a different query or contact support.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {filteredFAQs.map((faq, index) => (
                <div key={index}>
                  <button
                    onClick={() => setExpandedFAQ(expandedFAQ === index ? null : index)}
                    className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <span className="font-medium text-gray-900 dark:text-white pr-4">{faq.question}</span>
                    <div className={`w-8 h-8 rounded flex items-center justify-center transition-colors ${
                      expandedFAQ === index ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900' : 'bg-gray-100 dark:bg-gray-700 text-gray-400'
                    }`}>
                      {expandedFAQ === index ? (
                        <ChevronUp className="w-5 h-5" />
                      ) : (
                        <ChevronDown className="w-5 h-5" />
                      )}
                    </div>
                  </button>
                  {expandedFAQ === index && (
                    <div className="px-6 pb-4 text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700">
                      <p className="pt-2">{faq.answer}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Submit Ticket */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-md flex items-center justify-center">
              <MessageSquare className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Submit a Ticket</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">We&apos;ll respond within 24 hours</p>
            </div>
          </div>
          <div className="p-6">
            {submitted ? (
              <div className="text-center py-8">
                <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="w-8 h-8 text-green-600 dark:text-green-400" />
                </div>
                <h3 className="font-semibold text-gray-900 dark:text-white text-lg">Ticket Submitted!</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                  We&apos;ll get back to you within 24 hours.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmitTicket} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Subject
                  </label>
                  <input
                    type="text"
                    value={ticketForm.subject}
                    onChange={(e) => setTicketForm({ ...ticketForm, subject: e.target.value })}
                    required
                    placeholder="Brief description of your issue"
                    className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-400"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Category
                    </label>
                    <select
                      value={ticketForm.category}
                      onChange={(e) => setTicketForm({ ...ticketForm, category: e.target.value })}
                      className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-400 bg-white dark:bg-gray-700 dark:text-white"
                    >
                      <option value="general">General</option>
                      <option value="billing">Billing</option>
                      <option value="technical">Technical</option>
                      <option value="account">Account</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Priority
                    </label>
                    <select
                      value={ticketForm.priority}
                      onChange={(e) => setTicketForm({ ...ticketForm, priority: e.target.value })}
                      className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-400 bg-white dark:bg-gray-700 dark:text-white"
                    >
                      <option value="low">Low</option>
                      <option value="normal">Normal</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Message
                  </label>
                  <textarea
                    value={ticketForm.message}
                    onChange={(e) => setTicketForm({ ...ticketForm, message: e.target.value })}
                    required
                    rows={4}
                    placeholder="Describe your issue in detail..."
                    className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-400 resize-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-md hover:bg-gray-800 dark:hover:bg-gray-200 disabled:opacity-50 transition-colors font-medium"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      Submit Ticket
                    </>
                  )}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* Resources */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
          <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-md flex items-center justify-center">
            <Book className="w-5 h-5 text-purple-600 dark:text-purple-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Resources</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">Learn how to get the most out of our platform</p>
          </div>
        </div>
        <div className="p-6">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {resources.map((resource) => (
              <a
                key={resource.title}
                href="#"
                className="group p-5 rounded-md border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:shadow-lg transition-all"
              >
                <div className={`w-12 h-12 rounded-md flex items-center justify-center mb-4 ${resource.color}`}>
                  <resource.icon className="w-6 h-6" />
                </div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-gray-900 dark:text-white group-hover:text-gray-700 dark:group-hover:text-gray-300">{resource.title}</h3>
                  <ExternalLink className="w-4 h-4 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300" />
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{resource.description}</p>
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* Status Banner */}
      <div className="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/30 dark:to-emerald-900/30 border border-green-200 dark:border-green-800 rounded-2xl p-5 flex items-center gap-4">
        <div className="relative">
          <div className="w-4 h-4 bg-green-500 rounded-full"></div>
          <div className="absolute inset-0 w-4 h-4 bg-green-500 rounded-full animate-ping opacity-75"></div>
        </div>
        <div className="flex-1">
          <p className="font-semibold text-green-900 dark:text-green-300">All Systems Operational</p>
          <p className="text-sm text-green-700 dark:text-green-400">Last updated: Just now</p>
        </div>
        <a
          href="#"
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-green-700 dark:text-green-400 hover:text-green-900 dark:hover:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/40 rounded-md transition-colors"
        >
          Status Page
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>
    </div>
  )
}
