import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { tenants, subscriptions, tenantUsage, pricingTiers, accountTenants } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import Link from 'next/link'

interface LockedPageProps {
  params: Promise<{ slug: string }>
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function getDaysUntil(date: Date): number {
  const now = new Date()
  const diff = date.getTime() - now.getTime()
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
}

export default async function LockedPage({ params }: LockedPageProps) {
  const session = await auth()
  const { slug } = await params

  if (!session?.user?.accountId) {
    redirect('/login')
  }

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.slug, slug),
  })

  if (!tenant) {
    redirect('/account')
  }

  if (tenant.status !== 'locked') {
    redirect(`/c/${slug}`)
  }

  // Verify membership
  const membership = await db.query.accountTenants.findFirst({
    where: and(
      eq(accountTenants.accountId, session.user.accountId),
      eq(accountTenants.tenantId, tenant.id),
      eq(accountTenants.isActive, true)
    ),
  })

  if (!membership) {
    redirect('/account?error=no_access')
  }

  // Get subscription and usage info
  const subscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.tenantId, tenant.id),
  })

  const usage = await db.query.tenantUsage.findFirst({
    where: eq(tenantUsage.tenantId, tenant.id),
  })

  let tier = null
  if (subscription?.tierId) {
    tier = await db.query.pricingTiers.findFirst({
      where: eq(pricingTiers.id, subscription.tierId),
    })
  }

  const daysUntilDeletion = tenant.deletionScheduledAt
    ? getDaysUntil(new Date(tenant.deletionScheduledAt))
    : null

  const dbUsage = usage?.storageBytes || 0
  const fileUsage = usage?.fileStorageBytes || 0
  const dbLimit = tier?.maxDatabaseBytes || 0
  const fileLimit = tier?.maxFileStorageBytes || 0

  const reasonMessages: Record<string, { title: string; description: string }> = {
    trial_expired: {
      title: 'Your subscription has expired',
      description: 'Your subscription period has ended. Upgrade to a paid plan to continue using your company.',
    },
    storage_full: {
      title: 'Storage limit exceeded',
      description: 'Your company has exceeded its storage limits. Upgrade to a higher plan to get more storage.',
    },
    subscription_expired: {
      title: 'Your subscription has expired',
      description: 'Your subscription payment is overdue. Please renew to continue using your company.',
    },
  }

  const reason = reasonMessages[tenant.lockedReason || ''] || {
    title: 'Company access locked',
    description: 'Your company access has been restricted. Please contact support or upgrade your plan.',
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-lg w-full bg-white rounded-md shadow-lg p-8">
        {/* Lock Icon */}
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
        </div>

        {/* Title */}
        <h1 className="text-2xl font-bold text-gray-900 text-center mb-2">
          {reason.title}
        </h1>
        <p className="text-gray-600 text-center mb-6">
          {reason.description}
        </p>

        {/* Deletion Warning */}
        {daysUntilDeletion !== null && (
          <div className="bg-red-50 border border-red-200 rounded p-4 mb-6">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-red-600 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.232 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <div>
                <p className="font-semibold text-red-800">
                  {daysUntilDeletion > 0
                    ? `Data will be permanently deleted in ${daysUntilDeletion} day${daysUntilDeletion !== 1 ? 's' : ''}`
                    : 'Data deletion is imminent'
                  }
                </p>
                <p className="text-sm text-red-700 mt-1">
                  All company data including sales, inventory, customers, and work orders will be permanently removed.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Storage Usage */}
        {(dbLimit > 0 || fileLimit > 0) && (
          <div className="bg-gray-50 rounded p-4 mb-6 space-y-3">
            <h3 className="font-medium text-gray-900 text-sm">Storage Usage</h3>
            {dbLimit > 0 && (
              <div>
                <div className="flex justify-between text-sm text-gray-600 mb-1">
                  <span>Database</span>
                  <span>{formatBytes(dbUsage)} / {formatBytes(dbLimit)}</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${dbUsage > dbLimit ? 'bg-red-500' : dbUsage > dbLimit * 0.8 ? 'bg-yellow-500' : 'bg-blue-500'}`}
                    style={{ width: `${Math.min(100, (dbUsage / dbLimit) * 100)}%` }}
                  />
                </div>
              </div>
            )}
            {fileLimit > 0 && (
              <div>
                <div className="flex justify-between text-sm text-gray-600 mb-1">
                  <span>File Storage</span>
                  <span>{formatBytes(fileUsage)} / {formatBytes(fileLimit)}</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${fileUsage > fileLimit ? 'bg-red-500' : fileUsage > fileLimit * 0.8 ? 'bg-yellow-500' : 'bg-blue-500'}`}
                    style={{ width: `${Math.min(100, (fileUsage / fileLimit) * 100)}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="space-y-3">
          <Link
            href={`/account/subscription/${tenant.id}`}
            className="w-full flex items-center justify-center px-4 py-3 bg-blue-600 text-white rounded font-medium hover:bg-blue-700 transition-colors"
          >
            Upgrade Now
          </Link>
          <Link
            href="/account"
            className="w-full flex items-center justify-center px-4 py-3 bg-gray-100 text-gray-700 rounded font-medium hover:bg-gray-200 transition-colors"
          >
            Go to Account Dashboard
          </Link>
        </div>

        {/* Company Info */}
        <p className="text-center text-sm text-gray-500 mt-6">
          {tenant.name} ({slug})
        </p>
      </div>
    </div>
  )
}
