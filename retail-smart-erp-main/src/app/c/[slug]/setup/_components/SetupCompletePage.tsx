'use client'

import { CheckCircle, ArrowRight, Building2, Sparkles } from 'lucide-react'

interface SetupCompletePageProps {
  slug: string
}

export function SetupCompletePage({ slug }: SetupCompletePageProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 via-white to-emerald-50/30 dark:from-slate-900 dark:via-slate-900 dark:to-emerald-950/10 p-4">
      <div className="text-center max-w-md">
        {/* Success Icon */}
        <div className="relative mx-auto mb-8 w-24 h-24">
          <div className="absolute inset-0 bg-gradient-to-br from-green-200/60 to-emerald-200/40 dark:from-green-900/20 dark:to-emerald-900/10 rounded-3xl rotate-6" />
          <div className="relative w-24 h-24 bg-gradient-to-br from-green-100 to-emerald-100 dark:from-green-900/30 dark:to-emerald-900/20 rounded-3xl flex items-center justify-center shadow-lg shadow-green-500/10">
            <CheckCircle size={44} className="text-green-600 dark:text-green-400" />
          </div>
          <div className="absolute -top-1 -right-1 w-6 h-6 bg-gradient-to-br from-amber-400 to-orange-400 rounded-lg flex items-center justify-center shadow-sm">
            <Sparkles size={12} className="text-white" />
          </div>
        </div>

        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2 tracking-tight">
          Company Setup Complete
        </h1>
        <p className="text-sm text-gray-400 dark:text-gray-500 mb-8 leading-relaxed">
          Your company has been set up successfully.<br />
          You can start using your dashboard.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <a
            href={`/c/${slug}/dashboard`}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all duration-200 font-semibold text-sm shadow-sm shadow-blue-500/20"
          >
            Go to Dashboard
            <ArrowRight size={16} />
          </a>
          <a
            href="/account/companies"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 rounded-xl hover:bg-gray-50 dark:hover:bg-slate-800 hover:border-gray-300 transition-all duration-200 font-medium text-sm"
          >
            <Building2 size={16} />
            All Companies
          </a>
        </div>
      </div>
    </div>
  )
}
