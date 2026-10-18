'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/modal'
import { Sparkles, ExternalLink, Shield, Eye, ToggleRight } from 'lucide-react'
import Link from 'next/link'

interface AIConsentModalProps {
  isOpen: boolean
  onClose: () => void
  onAgree: () => void | Promise<void>
  processing?: boolean
}

export function AIConsentModal({
  isOpen,
  onClose,
  onAgree,
  processing = false,
}: AIConsentModalProps) {
  const [agreed, setAgreed] = useState(false)

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Enable AI Features" size="lg">
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-start gap-3 p-4 rounded-md bg-violet-50 dark:bg-violet-500/10 border border-violet-200 dark:border-violet-500/20">
          <Sparkles className="w-5 h-5 text-violet-600 dark:text-violet-400 mt-0.5 shrink-0" />
          <div className="text-sm text-violet-800 dark:text-violet-300">
            AI features include a chat assistant, business insights, smart suggestions during setup, letterhead generation, and error analysis.
          </div>
        </div>

        {/* Key points */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white">How your data is used</h4>

          <div className="space-y-2.5">
            <div className="flex items-start gap-3">
              <Shield className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
              <p className="text-sm text-gray-600 dark:text-gray-400">
                AI features are powered by <strong>Google Gemini</strong> and <strong>DeepSeek</strong>. When you use AI features, relevant business data (e.g. sales summaries, error details) is sent to these providers for processing.
              </p>
            </div>

            <div className="flex items-start gap-3">
              <Eye className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
              <p className="text-sm text-gray-600 dark:text-gray-400">
                These AI providers have their own data handling policies. We do not use your business data to train AI models, but the providers may process data according to their terms.
              </p>
            </div>

            <div className="flex items-start gap-3">
              <ToggleRight className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
              <p className="text-sm text-gray-600 dark:text-gray-400">
                You can disable AI features at any time from your company settings. No data will be sent to AI providers while disabled.
              </p>
            </div>
          </div>
        </div>

        {/* Privacy link */}
        <div className="text-sm text-gray-500 dark:text-gray-400">
          For full details, see our{' '}
          <Link href="/privacy" target="_blank" className="text-violet-600 dark:text-violet-400 hover:underline inline-flex items-center gap-1">
            Privacy Policy <ExternalLink className="w-3 h-3" />
          </Link>
        </div>

        {/* Checkbox */}
        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-violet-600 focus:ring-violet-500"
          />
          <span className="text-sm text-gray-700 dark:text-gray-300">
            I understand that business data may be processed by third-party AI providers and I consent to enabling AI features for this company.
          </span>
        </label>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={processing}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-zinc-800 border border-gray-300 dark:border-zinc-600 rounded hover:bg-gray-50 dark:hover:bg-zinc-700 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onAgree}
            disabled={!agreed || processing}
            className="px-4 py-2 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed rounded transition-colors flex items-center gap-2"
          >
            {processing ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Enabling...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                I Agree &amp; Enable
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  )
}
