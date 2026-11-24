'use client'

import { useState, useCallback, use } from 'react'
import Link from 'next/link'
import { useRealtimeData } from '@/hooks'
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  CreditCard,
  Database,
  FileText,
  HardDrive,
  Printer,
  Receipt,
  ShoppingBag,
  Users,
  ExternalLink,
} from 'lucide-react'
import { formatCurrencyWithSymbol } from '@/lib/utils/currency'

interface StatementResponse {
  company: {
    id: string
    name: string
    slug: string
    currency: string
    status: string
  }
  subscription: {
    id: string
    status: string
    billingCycle: string
    currentPeriodStart: string | null
    currentPeriodEnd: string | null
    trialEndsAt: string | null
    cancelAtPeriodEnd: boolean
    lastPaymentAt: string | null
  } | null
  tier: {
    id: string
    name: string
    displayName: string
    priceMonthly: string | null
    priceYearly: string | null
    currency: string
    maxUsers: number | null
    maxSalesMonthly: number | null
    maxDatabaseBytes: number | null
    maxFileStorageBytes: number | null
  } | null
  usage: {
    usersCount: number
    customersCount: number
    itemsCount: number
    salesCount: number
    purchasesCount: number
    databaseBytes: number
    fileStorageBytes: number
    updatedAt: string | null
  }
  dueNotice: {
    enabled: boolean
    scenario: string
    title: string
    message: string
    dueAmount: number | null
    dueCurrency: string | null
    formattedAmount: string | null
    dueDate: string | null
    billingPeriod: string | null
    contactNote: string | null
    urgency: {
      color: 'green' | 'amber' | 'red'
      label: string
      daysRemaining: number | null
      countdownText: string | null
    } | null
  } | null
  currentStatement: {
    statementNo: string
    periodLabel: string
    amountDue: number
    currency: string
    dueDate: string | null
    status: string
  }
  recentInvoices: Array<{
    id: string
    invoiceNumber: string
    periodStart: string
    periodEnd: string
    subtotal: string
    volumeDiscount: string
    total: string
    status: string
    paidAt: string | null
  }>
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

function UsageMeter({
  icon: Icon,
  label,
  usedLabel,
  limitLabel,
  percent,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  usedLabel: string
  limitLabel: string
  percent: number | null
  accent: string
}) {
  const barColor =
    percent === null
      ? 'bg-blue-500'
      : percent >= 90
      ? 'bg-red-500'
      : percent >= 75
      ? 'bg-amber-500'
      : 'bg-emerald-500'

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${accent}`}>
            <Icon className="w-4 h-4" />
          </div>
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">{label}</span>
        </div>
        {percent !== null && (
          <span className="text-xs font-bold text-gray-500 dark:text-gray-400">
            {Math.min(100, Math.round(percent))}%
          </span>
        )}
      </div>
      <div className="text-lg font-bold text-gray-900 dark:text-white font-mono">
        {usedLabel}
        <span className="text-xs font-normal text-gray-500 dark:text-gray-400 ml-1">
          / {limitLabel}
        </span>
      </div>
      <div className="mt-2.5 h-2 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${percent !== null ? Math.min(100, Math.max(4, percent)) : 25}%` }}
        />
      </div>
    </div>
  )
}

export default function TenantBillingPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = use(params)
  const [data, setData] = useState<StatementResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/billing/statement')
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setError(err.error || 'Unable to load billing statement')
        return
      }
      setData(await res.json())
      setError(null)
    } catch {
      setError('Failed to connect to billing service')
    } finally {
      setLoading(false)
    }
  }, [])

  useRealtimeData(load, { entityType: ['account-billing', 'account-subscription'] })

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 dark:border-white" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="max-w-4xl mx-auto py-16 text-center">
        <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">Billing Unavailable</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{error || 'Unable to load billing statement'}</p>
        <Link
          href={`/c/${slug}/dashboard`}
          className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-medium"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Dashboard
        </Link>
      </div>
    )
  }

  const notice = data.dueNotice
  const urgencyColor = notice?.urgency?.color || 'amber'
  const noticeCardClass =
    urgencyColor === 'green'
      ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-700 text-emerald-950 dark:text-emerald-100'
      : urgencyColor === 'red'
      ? 'bg-red-50 dark:bg-red-950/30 border-red-300 dark:border-red-700 text-red-950 dark:text-red-100'
      : 'bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700 text-amber-950 dark:text-amber-100'

  const dbPercent = data.tier?.maxDatabaseBytes
    ? (data.usage.databaseBytes / data.tier.maxDatabaseBytes) * 100
    : null
  const filePercent = data.tier?.maxFileStorageBytes
    ? (data.usage.fileStorageBytes / data.tier.maxFileStorageBytes) * 100
    : null
  const usersPercent = data.tier?.maxUsers
    ? (data.usage.usersCount / data.tier.maxUsers) * 100
    : null
  const salesPercent = data.tier?.maxSalesMonthly
    ? (data.usage.salesCount / data.tier.maxSalesMonthly) * 100
    : null

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 print:hidden">
        <div>
          <Link
            href={`/c/${slug}/dashboard`}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-900 dark:hover:text-white mb-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to {data.company.name}
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2.5">
            <Receipt className="w-6 h-6 text-blue-600" />
            Billing &amp; Postpaid Usage Statement
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Monthly server hosting, resource usage breakdown, and payment invoices for {data.company.name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <Printer className="w-4 h-4" />
            Print Statement
          </button>
          <Link
            href={`/account/subscription/${data.company.id}`}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold"
          >
            <CreditCard className="w-4 h-4" />
            Manage Plan
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* Active Payment Due Alert (Traffic-light styled) */}
      {notice && (
        <div className={`rounded-2xl border-2 p-5 ${noticeCardClass}`}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1.5 flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {/* Road Lamp dots */}
                <span className="inline-flex items-center gap-1 bg-black/80 px-2 py-1 rounded-full">
                  <span className={`w-2.5 h-2.5 rounded-full ${urgencyColor === 'red' ? 'bg-red-400' : 'bg-white/25'}`} />
                  <span className={`w-2.5 h-2.5 rounded-full ${urgencyColor === 'amber' ? 'bg-amber-300' : 'bg-white/25'}`} />
                  <span className={`w-2.5 h-2.5 rounded-full ${urgencyColor === 'green' ? 'bg-emerald-400' : 'bg-white/25'}`} />
                </span>
                <span className="px-2 py-0.5 rounded text-xs font-extrabold uppercase bg-black/10 dark:bg-white/10">
                  {notice.urgency?.label || 'PAYMENT NOTICE'}
                </span>
                {notice.urgency?.countdownText && (
                  <span className="inline-flex items-center gap-1 text-xs font-bold">
                    <Calendar className="w-3.5 h-3.5" />
                    {notice.urgency.countdownText}
                    {notice.dueDate ? ` (${new Date(notice.dueDate).toLocaleDateString()})` : ''}
                  </span>
                )}
              </div>
              <h2 className="text-lg font-bold">{notice.title}</h2>
              <p className="text-sm opacity-90">{notice.message}</p>
              {notice.contactNote && (
                <p className="text-xs font-semibold pt-1">
                  Payment / Support Instructions: {notice.contactNote}
                </p>
              )}
            </div>
            {notice.formattedAmount && (
              <div className="bg-white/80 dark:bg-gray-900/80 rounded-xl px-4 py-3 text-right border border-black/10 dark:border-white/10 shrink-0">
                <div className="text-[11px] uppercase tracking-wider font-bold opacity-70">Amount Due</div>
                <div className="text-2xl font-black font-mono text-gray-900 dark:text-white">
                  {notice.formattedAmount}
                </div>
                {notice.billingPeriod && (
                  <div className="text-xs opacity-75 mt-0.5">{notice.billingPeriod}</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Postpaid Resource Usage Breakdown */}
      <div>
        <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-3">
          Current Billing Period — Resource &amp; Data Usage
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <UsageMeter
            icon={Database}
            label="Database Usage"
            usedLabel={formatBytes(data.usage.databaseBytes)}
            limitLabel={data.tier?.maxDatabaseBytes ? formatBytes(data.tier.maxDatabaseBytes) : 'Unlimited'}
            percent={dbPercent}
            accent="bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-300"
          />
          <UsageMeter
            icon={HardDrive}
            label="File &amp; Media Storage"
            usedLabel={formatBytes(data.usage.fileStorageBytes)}
            limitLabel={data.tier?.maxFileStorageBytes ? formatBytes(data.tier.maxFileStorageBytes) : 'Unlimited'}
            percent={filePercent}
            accent="bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300"
          />
          <UsageMeter
            icon={Users}
            label="Active Staff Users"
            usedLabel={String(data.usage.usersCount)}
            limitLabel={data.tier?.maxUsers ? String(data.tier.maxUsers) : 'Unlimited'}
            percent={usersPercent}
            accent="bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300"
          />
          <UsageMeter
            icon={ShoppingBag}
            label="Total Sales / Bills"
            usedLabel={data.usage.salesCount.toLocaleString()}
            limitLabel={data.tier?.maxSalesMonthly ? `${data.tier.maxSalesMonthly.toLocaleString()} / mo` : 'Unlimited'}
            percent={salesPercent}
            accent="bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300"
          />
        </div>
      </div>

      {/* Itemized Postpaid Statement / Invoice */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
        <div className="px-6 py-5 border-b border-gray-200 dark:border-gray-700 flex flex-wrap items-center justify-between gap-4 bg-gray-50/70 dark:bg-gray-900/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-blue-600 dark:text-blue-400">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                Current Statement — {data.currentStatement.statementNo}
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Billing Period: {data.currentStatement.periodLabel}
                {data.currentStatement.dueDate ? ` · Due ${new Date(data.currentStatement.dueDate).toLocaleDateString()}` : ''}
              </p>
            </div>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-extrabold uppercase ${
            urgencyColor === 'red' && notice
              ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
              : urgencyColor === 'green' && notice
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
              : notice
              ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
              : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
          }`}>
            {data.currentStatement.status}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-xs uppercase text-gray-500 dark:text-gray-400 bg-gray-50/40 dark:bg-gray-900/20">
                <th className="px-6 py-3 font-semibold">Service / Usage Item</th>
                <th className="px-6 py-3 font-semibold">Metered Usage Details</th>
                <th className="px-6 py-3 font-semibold text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              <tr>
                <td className="px-6 py-4 font-medium text-gray-900 dark:text-white">
                  {data.tier?.displayName || 'Platform'} Server &amp; POS Plan ({data.subscription?.billingCycle || 'monthly'})
                </td>
                <td className="px-6 py-4 text-gray-500 dark:text-gray-400">
                  {data.subscription?.status === 'trial' ? 'Trial / Free Tier' : 'Active Cloud POS & ERP Hosting'}
                </td>
                <td className="px-6 py-4 text-right font-mono font-semibold text-gray-900 dark:text-white">
                  {formatCurrencyWithSymbol(data.currentStatement.amountDue, data.currentStatement.currency)}
                </td>
              </tr>
              <tr>
                <td className="px-6 py-4 font-medium text-gray-900 dark:text-white">
                  Cloud Database &amp; Transaction Metering
                </td>
                <td className="px-6 py-4 text-gray-500 dark:text-gray-400">
                  {formatBytes(data.usage.databaseBytes)} DB · {data.usage.itemsCount.toLocaleString()} items · {data.usage.customersCount.toLocaleString()} customers · {data.usage.salesCount.toLocaleString()} sales
                </td>
                <td className="px-6 py-4 text-right font-mono text-gray-500 dark:text-gray-400">
                  Included
                </td>
              </tr>
              <tr>
                <td className="px-6 py-4 font-medium text-gray-900 dark:text-white">
                  Media, Receipts &amp; File Storage
                </td>
                <td className="px-6 py-4 text-gray-500 dark:text-gray-400">
                  {formatBytes(data.usage.fileStorageBytes)} stored · {data.usage.usersCount} active staff user(s)
                </td>
                <td className="px-6 py-4 text-right font-mono text-gray-500 dark:text-gray-400">
                  Included
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-900/40">
                <td colSpan={2} className="px-6 py-4 text-right font-bold text-gray-900 dark:text-white">
                  Total Statement Balance Due
                </td>
                <td className="px-6 py-4 text-right text-xl font-black font-mono text-gray-900 dark:text-white">
                  {formatCurrencyWithSymbol(data.currentStatement.amountDue, data.currentStatement.currency)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Past Billing Invoices */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2.5">
          <CheckCircle2 className="w-5 h-5 text-emerald-500" />
          <h2 className="text-base font-bold text-gray-900 dark:text-white">Invoice History</h2>
        </div>
        {data.recentInvoices.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No closed historical invoices yet — your active cycle statement is shown above.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-xs uppercase text-gray-500">
                  <th className="px-6 py-3">Invoice #</th>
                  <th className="px-6 py-3">Period</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {data.recentInvoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className="px-6 py-3 font-mono font-semibold text-gray-900 dark:text-white">{inv.invoiceNumber}</td>
                    <td className="px-6 py-3 text-gray-500 dark:text-gray-400">
                      {new Date(inv.periodStart).toLocaleDateString()} – {new Date(inv.periodEnd).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold uppercase ${
                        inv.status === 'paid'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-amber-100 text-amber-800'
                      }`}>
                        {inv.status}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-right font-mono font-bold text-gray-900 dark:text-white">
                      {formatCurrencyWithSymbol(parseFloat(inv.total), data.currentStatement.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
