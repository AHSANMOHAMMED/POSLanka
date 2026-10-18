'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/modal'
import { Bug, Send, Sparkles, Loader2 } from 'lucide-react'
import { toast } from '@/components/ui/toast'

interface BugReportModalProps {
  isOpen: boolean
  onClose: () => void
}

const severityOptions = [
  { value: 'info', label: 'Low', description: 'Minor issue, not blocking' },
  { value: 'warning', label: 'Medium', description: 'Noticeable but has workaround' },
  { value: 'error', label: 'High', description: 'Blocks a feature or workflow' },
  { value: 'critical', label: 'Critical', description: 'System unusable or data loss' },
]

export function BugReportModal({ isOpen, onClose }: BugReportModalProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [severity, setSeverity] = useState('warning')
  const [submitting, setSubmitting] = useState(false)
  const [currentUrl, setCurrentUrl] = useState('')
  const [aiRewriting, setAiRewriting] = useState(false)
  const [aiAnalysis, setAiAnalysis] = useState('')

  useEffect(() => {
    if (isOpen) {
      setTitle('')
      setDescription('')
      setSeverity('warning')
      setCurrentUrl(window.location.href)
      setAiAnalysis('')
    }
  }, [isOpen])

  async function handleAIRewrite() {
    if (!title.trim()) {
      toast.error('Please enter a title first')
      return
    }

    setAiRewriting(true)
    setAiAnalysis('')
    try {
      const res = await fetch('/api/ai/rewrite-bug-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          severity,
          url: currentUrl,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'AI rewrite failed')
      }

      const data = await res.json()
      if (data.improvedTitle) setTitle(data.improvedTitle)
      if (data.improvedDescription) setDescription(data.improvedDescription)
      if (data.analysis) setAiAnalysis(data.analysis)

      toast.success('Bug report improved by AI')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'AI rewrite failed')
    } finally {
      setAiRewriting(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return

    setSubmitting(true)
    try {
      const res = await fetch('/api/bug-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          severity,
          url: currentUrl,
          userAgent: navigator.userAgent,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to submit bug report')
      }

      toast.success('Bug report submitted successfully')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit bug report')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Report a Bug" size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex items-start gap-3 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded">
          <Bug className="text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" size={20} />
          <p className="text-sm text-blue-700 dark:text-blue-300">
            Help us improve by reporting bugs you encounter. Your report will be reviewed by the system administrator.
          </p>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium">Title *</label>
            <button
              type="button"
              onClick={handleAIRewrite}
              disabled={aiRewriting || !title.trim()}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md bg-purple-50 text-purple-700 hover:bg-purple-100 dark:bg-purple-900/30 dark:text-purple-300 dark:hover:bg-purple-900/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {aiRewriting ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Sparkles size={12} />
              )}
              {aiRewriting ? 'Improving...' : 'Improve with AI'}
            </button>
          </div>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-600"
            placeholder="Brief summary of the issue..."
            required
            autoFocus
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-600"
            placeholder="What happened? What were you trying to do? Steps to reproduce..."
            rows={5}
          />
        </div>

        {/* AI Analysis */}
        {aiAnalysis && (
          <div className="p-3 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded">
            <div className="flex items-center gap-1.5 mb-1">
              <Sparkles size={14} className="text-purple-600 dark:text-purple-400" />
              <span className="text-xs font-semibold text-purple-700 dark:text-purple-300">AI Analysis</span>
            </div>
            <p className="text-sm text-purple-700 dark:text-purple-300">{aiAnalysis}</p>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-2">Severity</label>
          <div className="grid grid-cols-2 gap-2">
            {severityOptions.map((opt) => (
              <button
                key={opt.label}
                type="button"
                onClick={() => setSeverity(opt.value)}
                className={`px-3 py-2 text-sm rounded border text-left transition-colors ${
                  severity === opt.value
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                    : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                <span className="font-medium">{opt.label}</span>
                <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">{opt.description}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="text-xs text-gray-500 dark:text-gray-400">
          Page: {currentUrl}
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t dark:border-gray-700">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 border rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!title.trim() || submitting}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
          >
            <Send size={14} />
            {submitting ? 'Submitting...' : 'Submit Report'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
