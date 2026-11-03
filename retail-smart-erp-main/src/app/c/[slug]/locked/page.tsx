import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { tenants, subscriptions, tenantUsage, pricingTiers, accountTenants } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import Link from 'next/link'
import { BrandWordmark } from '@/components/ui/logo'
import { resolveLockMessage } from '@/lib/tenant/lock-message'

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

/**
 * Full-screen access gate for locked / suspended / archived companies.
 * Never a blank or black screen — always a clear reason + next step.
 */
export default async function LockedPage({ params }: LockedPageProps) {
  const session = await auth()
  const { slug } = await params

  if (!session?.user) {
    redirect(`/c/${slug}/login`)
  }

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.slug, slug),
  })

  if (!tenant) {
    redirect('/account')
  }

  if (tenant.status === 'active') {
    redirect(`/c/${slug}/dashboard`)
  }

  // Prefer account membership; company-session staff still see the message
  const accountId = session.user.accountId
  if (accountId) {
    const membership = await db.query.accountTenants.findFirst({
      where: and(
        eq(accountTenants.accountId, accountId),
        eq(accountTenants.tenantId, tenant.id),
        eq(accountTenants.isActive, true),
      ),
    })
    if (!membership && session.user.tenantId !== tenant.id) {
      redirect('/account?error=no_access')
    }
  }

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

  const reason = resolveLockMessage({
    status: tenant.status,
    lockedReason: tenant.lockedReason,
    settings: tenant.settings,
  })

  const tone = reason.tone === 'danger'
    ? { iconBg: 'bg-red-100', icon: 'text-red-600', panel: 'bg-red-50 border-red-200', panelText: 'text-red-800', panelSub: 'text-red-700' }
    : reason.tone === 'info'
      ? { iconBg: 'bg-sky-100', icon: 'text-[#0050c0]', panel: 'bg-sky-50 border-sky-200', panelText: 'text-sky-900', panelSub: 'text-sky-700' }
      : { iconBg: 'bg-amber-100', icon: 'text-amber-700', panel: 'bg-amber-50 border-amber-200', panelText: 'text-amber-900', panelSub: 'text-amber-800' }

  const ctaHref = reason.ctaHref?.(slug, tenant.id)
  const statusLabel = tenant.status === 'suspended' ? 'Suspended'
    : tenant.status === 'cancelled' ? 'Archived'
      : tenant.status === 'locked' ? 'Locked'
        : tenant.status

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100 flex items-center justify-center p-4">
      <div className="max-w-lg w-full bg-white rounded-2xl shadow-xl border border-slate-200/80 p-8 sm:p-10">
        <div className="mb-6 flex justify-center"><BrandWordmark height={44} /></div>

        <div className="flex justify-center mb-5">
          <div className={`w-16 h-16 ${tone.iconBg} rounded-full flex items-center justify-center`}>
            <svg className={`w-8 h-8 ${tone.icon}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
        </div>

        <p className="text-center text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
          {statusLabel}
          {tenant.lockedAt ? ` · since ${new Date(tenant.lockedAt).toLocaleDateString()}` : ''}
        </p>
        <h1 className="text-2xl font-bold text-slate-900 text-center mb-2 tracking-tight">
          {reason.title}
        </h1>
        <p className="text-slate-600 text-center mb-6 leading-relaxed">
          {reason.description}
        </p>

        {daysUntilDeletion !== null && (
          <div className={`${tone.panel} border rounded-xl p-4 mb-6`}>
            <div className="flex items-start gap-3">
              <svg className={`w-5 h-5 ${tone.icon} mt-0.5 shrink-0`} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.232 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <div>
                <p className={`font-semibold ${tone.panelText}`}>
                  {daysUntilDeletion > 0
                    ? `Data may be permanently deleted in ${daysUntilDeletion} day${daysUntilDeletion !== 1 ? 's' : ''}`
                    : 'Data deletion is imminent'}
                </p>
                <p className={`text-sm ${tone.panelSub} mt-1`}>
                  Renew or ask support to reactivate before that date to keep sales, stock, and customer records.
                </p>
              </div>
            </div>
          </div>
        )}

        {(dbLimit > 0 || fileLimit > 0) && tenant.lockedReason === 'storage_full' && (
          <div className="bg-slate-50 rounded-xl p-4 mb-6 space-y-3 border border-slate-200">
            <h3 className="font-medium text-slate-900 text-sm">Storage usage</h3>
            {dbLimit > 0 && (
              <div>
                <div className="flex justify-between text-sm text-slate-600 mb-1">
                  <span>Database</span>
                  <span>{formatBytes(dbUsage)} / {formatBytes(dbLimit)}</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${dbUsage > dbLimit ? 'bg-red-500' : 'bg-[#0050c0]'}`}
                    style={{ width: `${Math.min(100, (dbUsage / dbLimit) * 100)}%` }}
                  />
                </div>
              </div>
            )}
            {fileLimit > 0 && (
              <div>
                <div className="flex justify-between text-sm text-slate-600 mb-1">
                  <span>Files</span>
                  <span>{formatBytes(fileUsage)} / {formatBytes(fileLimit)}</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${fileUsage > fileLimit ? 'bg-red-500' : 'bg-[#0050c0]'}`}
                    style={{ width: `${Math.min(100, (fileUsage / fileLimit) * 100)}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        <div className="space-y-3">
          {ctaHref && (
            <Link
              href={ctaHref}
              className="w-full flex items-center justify-center px-4 py-3 bg-[#0050c0] text-white rounded-xl font-semibold hover:bg-[#00419e] transition-colors shadow-md shadow-[rgba(0,80,192,0.25)]"
            >
              {reason.ctaLabel || 'Continue'}
            </Link>
          )}
          <Link
            href="/account"
            className="w-full flex items-center justify-center px-4 py-3 bg-slate-100 text-slate-800 rounded-xl font-medium hover:bg-slate-200 transition-colors"
          >
            Back to account
          </Link>
          <Link
            href="/contact"
            className="w-full flex items-center justify-center px-4 py-3 text-[#0050c0] font-medium hover:underline"
          >
            Contact skyERPOS support
          </Link>
        </div>

        <p className="text-center text-sm text-slate-500 mt-8">
          {tenant.name}
          <span className="text-slate-400"> · </span>
          {slug}
        </p>
      </div>
    </div>
  )
}
