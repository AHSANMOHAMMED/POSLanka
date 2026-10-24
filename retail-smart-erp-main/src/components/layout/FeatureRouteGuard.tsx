'use client'

import Link from 'next/link'
import { useParams, usePathname } from 'next/navigation'
import { PowerOff } from 'lucide-react'
import { useFeatureFlags } from '@/hooks/useFeatureFlag'
import { FEATURE_FLAG_LABELS, featureForHref } from '@/lib/features/flags'

/**
 * Pages of a feature the platform turned off for this business show a notice instead of the page,
 * also when opened by URL or bookmark. (Menus hide them; the API refuses them with 403.)
 */
export function FeatureRouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || ''
  const { slug } = useParams<{ slug: string }>()
  const { flags, loading } = useFeatureFlags()
  const relative = pathname.replace(/^\/c\/[^/]+/, '') || '/'
  const flag = featureForHref(relative)
  if (!flag || (!loading && flags[flag])) return <>{children}</>
  // Wait for the switches before mounting a switchable page, so a switched-off page never calls its API
  if (loading) return <div className="mx-auto mt-16 h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" aria-label="Loading" />

  return (
    <div className="mx-auto mt-16 max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <PowerOff className="mx-auto mb-3 h-10 w-10 text-gray-400" aria-hidden />
      <h1 className="text-lg font-semibold text-gray-900 dark:text-white">{FEATURE_FLAG_LABELS[flag]} is turned off</h1>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
        This feature is not enabled for your business. Contact skyERPOS support to turn it on.
      </p>
      <Link href={`/c/${slug}/dashboard`} className="mt-5 inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
        Back to dashboard
      </Link>
    </div>
  )
}
