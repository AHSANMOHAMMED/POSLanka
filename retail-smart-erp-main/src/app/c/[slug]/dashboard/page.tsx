'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useCompanyOptional } from '@/components/providers/CompanyContextProvider'
import { WorkspaceRenderer } from '@/components/workspace/WorkspaceRenderer'
import { ErrorBoundary } from '@/components/ui/error-boundary'
import { useRealtimeData, useDateFormat } from '@/hooks'
import { AlertTriangle, Clock } from 'lucide-react'
import { AIInsightsWidget } from '@/components/dashboard/AIInsightsWidget'
import { OnboardingChecklist } from '@/components/account/OnboardingChecklist'

interface ExpiringItem {
  id: string
  name: string
  expiryDate: string
  sku: string | null
  currentStock: string
}

function ExpiringItemsWidget() {
  const [items, setItems] = useState<ExpiringItem[]>([])
  const [loading, setLoading] = useState(true)
  const params = useParams()
  const { fDate } = useDateFormat()
  const slug = params.slug as string

  const fetchExpiringItems = useCallback(async () => {
    try {
      const today = new Date()
      const sevenDaysLater = new Date(today)
      sevenDaysLater.setDate(today.getDate() + 7)
      const expiringBefore = sevenDaysLater.toISOString().split('T')[0]

      const res = await fetch(`/api/items?expiringBefore=${expiringBefore}&pageSize=10`)
      if (res.ok) {
        const result = await res.json()
        const data = result.data || result
        setItems(data)
      }
    } catch (error) {
      console.error('Error fetching expiring items:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchExpiringItems()
  }, [fetchExpiringItems])

  useRealtimeData(fetchExpiringItems, { entityType: 'item', refreshOnMount: false })

  function getDaysRemaining(expiryDate: string): number {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const expiry = new Date(expiryDate)
    expiry.setHours(0, 0, 0, 0)
    return Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  }

  function getDaysLabel(days: number): string {
    if (days < 0) return `${Math.abs(days)}d overdue`
    if (days === 0) return 'Expires today'
    if (days === 1) return '1 day left'
    return `${days} days left`
  }

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle size={18} className="text-amber-500" />
          <h3 className="font-semibold text-gray-900 dark:text-white">Expiring Soon</h3>
        </div>
        <div className="text-sm text-gray-400">Loading...</div>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <AlertTriangle size={18} className="text-amber-500" />
          <h3 className="font-semibold text-gray-900 dark:text-white">Expiring Soon</h3>
          {items.length > 0 && (
            <span className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded-full">
              {items.length}
            </span>
          )}
        </div>
        <a
          href={`/c/${slug}/items?filter=expiring`}
          className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
        >
          View all
        </a>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-6">
          <Clock size={32} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
          <p className="text-sm text-gray-500 dark:text-gray-400">No items expiring soon</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(item => {
            const days = getDaysRemaining(item.expiryDate)
            const isUrgent = days < 3
            const colorClass = isUrgent
              ? 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20'
              : 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20'

            return (
              <div
                key={item.id}
                className="flex items-center justify-between py-2 px-3 rounded hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                    {item.name}
                  </div>
                  {item.sku && (
                    <div className="text-xs text-gray-400">{item.sku}</div>
                  )}
                </div>
                <div className="flex items-center gap-3 ml-3">
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {fDate(item.expiryDate)}
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${colorClass}`}>
                    {getDaysLabel(days)}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function DashboardPage() {
  const router = useRouter()
  const params = useParams()
  const { data: session } = useSession()
  const company = useCompanyOptional()
  const slug = params.slug as string
  const role = session?.user?.role
  const businessType = company?.businessType || session?.user?.businessType

  useEffect(() => {
    // Chef in restaurant -> redirect to kitchen display
    if (role === 'chef' && businessType === 'restaurant') {
      router.replace(`/c/${slug}/restaurant/kitchen`)
    }
  }, [router, slug, role, businessType])

  return (
    <div className="space-y-3">
      <OnboardingChecklist companySlug={slug} />
      <ErrorBoundary>
        <WorkspaceRenderer workspaceKey="dashboard" />
      </ErrorBoundary>
      <AIInsightsWidget />
      {businessType === 'supermarket' && <ExpiringItemsWidget />}
    </div>
  )
}
