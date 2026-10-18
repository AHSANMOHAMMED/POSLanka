'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRealtimeData } from '@/hooks'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import Image from 'next/image'
import {
  Building2,
  Plus,
  ArrowUpRight,
  CreditCard,
  Loader2,
  Zap,
  HardDrive,
  Database,
  MoreHorizontal,
  Settings,
  Trash2,
  Crown,
  AlertTriangle,
  X,
  Check,
  Users,
  Shield,
  Headphones,
  Globe,
  ChevronDown,
  ChevronUp,
  Sparkles,
  TrendingUp,
  Star,
} from 'lucide-react'
import { formatCurrencyWithSymbol } from '@/lib/utils/currency'
import { toast } from '@/components/ui/toast'
import { BUSINESS_TYPES, getBusinessTypeLabel, getBusinessTypeEmoji } from '@/lib/constants/business-types'
import { PageSkeleton } from '@/components/ui/skeleton'

interface Company {
  id: string
  name: string
  slug: string
  businessType: string
  logoUrl: string | null
  status: string
  role: string
  isOwner: boolean
  createdAt: string
  setupCompletedAt: string | null
  subscription: {
    status: string
    tierName: string
    trialEndsAt: string | null
    currentPeriodEnd: string | null
  } | null
  usage: {
    databaseBytes: number
    fileStorageBytes: number
    updatedAt: string | null
  } | null
  limits: {
    maxDatabaseBytes: number | null
    maxFileStorageBytes: number | null
  }
}

interface DashboardStats {
  totalSites: number
  activeSites: number
  freeSites: number
  totalDatabaseBytes: number
  totalFileStorageBytes: number
  credits: number
  currency: string
}

interface PricingTier {
  id: string
  name: string
  displayName: string
  priceMonthly: number
  priceYearly: number
  currency: string
  maxUsers: number | null
  maxSalesMonthly: number | null
  maxDatabaseBytes: number | null
  maxFileStorageBytes: number | null
  features: Record<string, unknown>
}

interface FAQ {
  question: string
  answer: string
}

const faqs: FAQ[] = [
  {
    question: 'Can I change my plan later?',
    answer: 'Yes, you can upgrade or downgrade your plan at any time. Changes take effect immediately, and we\'ll prorate your billing accordingly.',
  },
  {
    question: 'What happens when my subscription ends?',
    answer: 'Your first company is completely free forever with full access to all features. Additional companies require a paid plan. If a paid subscription expires, your company will be locked — upgrade within 7 days to keep your data.',
  },
  {
    question: 'What happens if my company gets locked?',
    answer: 'When locked (subscription expired or storage exceeded), you cannot access your company data. You have 7 days to upgrade or renew before data is permanently deleted.',
  },
  {
    question: 'Are all features really included on every plan?',
    answer: 'Yes! Every plan includes all features, unlimited users, and unlimited transactions. Plans only differ by database and file storage limits.',
  },
]

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

// getBusinessTypeLabel and getBusinessTypeEmoji imported from @/lib/constants/business-types

// Stat Card Component
function StatCard({
  icon: Icon,
  label,
  value,
  subValue,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  subValue?: string
  color: 'blue' | 'purple' | 'green' | 'orange' | 'pink'
}) {
  const colors: Record<'blue' | 'purple' | 'green' | 'orange' | 'pink', string> = {
    blue: 'bg-blue-50 text-blue-600',
    purple: 'bg-purple-50 text-purple-600',
    green: 'bg-green-50 text-green-600',
    orange: 'bg-orange-50 text-orange-600',
    pink: 'bg-pink-50 text-pink-600',
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{label}</p>
          <p className="text-3xl font-bold text-gray-900 dark:text-white mt-2">{value}</p>
          {subValue && <p className="text-sm text-gray-400 mt-1">{subValue}</p>}
        </div>
        <div className={`w-12 h-12 rounded-md flex items-center justify-center ${colors[color]}`}>
          <Icon className="w-6 h-6" />
        </div>
      </div>
    </div>
  )
}

// Storage Progress Bar Component
function StorageProgressBar({
  used,
  limit,
  color,
}: {
  used: number
  limit: number | null
  color: 'purple' | 'green'
}) {
  const percentage = limit ? Math.min((used / limit) * 100, 100) : 0
  const isWarning = percentage >= 80
  const isCritical = percentage >= 95

  const colors = {
    purple: {
      bg: 'bg-purple-100',
      fill: isCritical ? 'bg-red-500' : isWarning ? 'bg-yellow-500' : 'bg-purple-500',
    },
    green: {
      bg: 'bg-green-100',
      fill: isCritical ? 'bg-red-500' : isWarning ? 'bg-yellow-500' : 'bg-green-500',
    },
  }

  return (
    <div className={`h-1.5 ${colors[color].bg} rounded-full overflow-hidden flex-1`}>
      <div
        className={`h-full ${colors[color].fill} rounded-full transition-all`}
        style={{ width: limit ? `${percentage}%` : '0%' }}
      />
    </div>
  )
}


// Company Card Component
function CompanyCard({
  company,
  onDelete,
  currentTime,
}: {
  company: Company
  onDelete: (company: Company) => void
  currentTime: number
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [opening, setOpening] = useState(false)

  const trialEndsAt = company.subscription?.trialEndsAt
  const _daysUntilTrialEnds = useMemo(() => {
    if (!trialEndsAt) return null
    return Math.ceil((new Date(trialEndsAt).getTime() - currentTime) / (1000 * 60 * 60 * 24))
  }, [trialEndsAt, currentTime])

  const statusColor = {
    active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    trial: 'bg-green-50 text-green-700 border-green-200',
    past_due: 'bg-red-50 text-red-700 border-red-200',
    cancelled: 'bg-gray-50 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700',
    locked: 'bg-red-50 text-red-700 border-red-200',
  }[company.subscription?.status || 'cancelled'] || 'bg-gray-50 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700'

  return (
    <div className="group bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 hover:border-gray-200 hover:shadow-lg transition-all duration-200">
      <div className="p-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-gradient-to-br from-gray-100 to-gray-50 rounded-2xl flex items-center justify-center text-2xl shadow-sm">
              {company.logoUrl ? (
                <Image
                  src={company.logoUrl}
                  alt={company.name}
                  width={48}
                  height={48}
                  className="rounded-md object-cover"
                />
              ) : (
                getBusinessTypeEmoji(company.businessType)
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-gray-900 dark:text-white text-lg">{company.name}</h3>
                {company.isOwner && (
                  <Crown className="w-4 h-4 text-amber-500" />
                )}
              </div>
              <p className="text-sm text-gray-400">{company.slug}</p>
            </div>
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen(!menuOpen)}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors opacity-0 group-hover:opacity-100"
            >
              <MoreHorizontal className="w-5 h-5" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} aria-hidden />
                <div
                  className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-md shadow-lg border border-gray-100 dark:border-gray-700 py-2 z-20"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Link
                    href={`/account/subscription/${company.id}`}
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    <Settings className="w-4 h-4" />
                    Manage Plan
                  </Link>
                  <Link
                    href={`/account/usage/${company.id}`}
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    <Database className="w-4 h-4" />
                    View Usage
                  </Link>
                  {company.isOwner && (
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        onDelete(company)
                        setMenuOpen(false)
                      }}
                      className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete Site
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Badges */}
        <div className="flex flex-wrap items-center gap-2 mb-5">
          <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-3 py-1.5 rounded-full font-medium">
            {getBusinessTypeLabel(company.businessType)}
          </span>
          {company.subscription && (
            <span className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-medium border ${statusColor}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${
                company.subscription.status === 'active' ? 'bg-emerald-500' :
                company.subscription.status === 'trial' ? 'bg-green-500' :
                company.subscription.status === 'past_due' ? 'bg-red-500' : 'bg-gray-500'
              }`} />
              {company.subscription.status === 'trial'
                ? 'Free'
                : company.subscription.status === 'locked'
                ? 'Locked'
                : company.subscription.tierName || company.subscription.status}
            </span>
          )}
        </div>

        {/* Storage Usage */}
        <div className="mb-5 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-md space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-purple-100 rounded flex items-center justify-center">
              <Database className="w-4 h-4 text-purple-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Database</span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {formatBytes(company.usage?.databaseBytes || 0)}
                  {company.limits.maxDatabaseBytes && (
                    <span className="text-gray-400"> / {formatBytes(company.limits.maxDatabaseBytes)}</span>
                  )}
                </span>
              </div>
              <StorageProgressBar
                used={company.usage?.databaseBytes || 0}
                limit={company.limits.maxDatabaseBytes}
                color="purple"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-green-100 rounded flex items-center justify-center">
              <HardDrive className="w-4 h-4 text-green-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-gray-600 dark:text-gray-400">File Storage</span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {formatBytes(company.usage?.fileStorageBytes || 0)}
                  {company.limits.maxFileStorageBytes && (
                    <span className="text-gray-400"> / {formatBytes(company.limits.maxFileStorageBytes)}</span>
                  )}
                </span>
              </div>
              <StorageProgressBar
                used={company.usage?.fileStorageBytes || 0}
                limit={company.limits.maxFileStorageBytes}
                color="green"
              />
            </div>
          </div>
        </div>

        {/* Locked Warning */}
        {(company.subscription?.status === 'locked' || company.status === 'locked') && (
          <div className="mb-5 p-4 bg-gradient-to-r from-red-50 to-orange-50 border border-red-200 rounded-md">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-red-600" />
              <div className="flex-1">
                <p className="text-sm font-medium text-red-800">
                  Company access is locked
                </p>
                <Link
                  href={`/account/subscription/${company.id}`}
                  className="text-sm font-medium text-red-700 hover:text-red-900 underline underline-offset-2"
                >
                  Upgrade to restore access
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Trial Warning - removed: free plan has no expiry */}

        {/* Action Button - Opens in new tab on tenant subdomain with transfer token */}
        <button
          type="button"
          disabled={opening || (company.status !== 'active' && company.status !== 'locked')}
          onClick={async () => {
            if (opening) return
            setOpening(true)

            const baseDomain = process.env.NEXT_PUBLIC_BASE_DOMAIN
            const isDev = baseDomain === 'localhost'
            const protocol = isDev ? 'http' : 'https'
            const port = isDev ? ':3000' : ''
            const path = company.setupCompletedAt ? '/dashboard' : '/setup'
            const fallbackUrl = baseDomain
              ? `${protocol}://${company.slug}.${baseDomain}${port}${path}`
              : `/c/${company.slug}${path}`

            // Open blank tab immediately to avoid popup blocker
            const newTab = window.open('about:blank', '_blank')

            try {
              // Get transfer token for seamless login
              const res = await fetch('/api/account-auth/transfer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tenantSlug: company.slug }),
              })

              if (res.ok) {
                const { transferToken } = await res.json()
                const transferUrl = baseDomain
                  ? `${protocol}://${company.slug}.${baseDomain}${port}/login?transfer=${transferToken}`
                  : `/c/${company.slug}/login?transfer=${transferToken}`

                if (newTab) {
                  newTab.location.href = transferUrl
                } else {
                  window.open(transferUrl, '_blank')
                }
              } else {
                // Fallback: direct link without transfer
                if (newTab) newTab.location.href = fallbackUrl
                else window.open(fallbackUrl, '_blank')
              }
            } catch {
              // Fallback: direct link without transfer
              if (newTab) newTab.location.href = fallbackUrl
              else window.open(fallbackUrl, '_blank')
            } finally {
              setOpening(false)
            }
          }}
          className={`w-full flex items-center justify-center gap-2 px-4 py-3 ${
            company.setupCompletedAt
              ? 'bg-gray-900 text-white hover:bg-gray-800'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          } rounded-md transition-all font-medium group-hover:shadow-md ${
            company.status !== 'active' && company.status !== 'locked' ? 'opacity-50 pointer-events-none' : ''
          } ${opening ? 'opacity-75' : ''}`}
        >
          {opening ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Opening...
            </>
          ) : (
            <>
              {company.setupCompletedAt ? 'Open Dashboard' : 'Complete Setup'}
              <ArrowUpRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </>
          )}
        </button>
      </div>
    </div>
  )
}

// Pricing Card Component
function PricingCard({
  tier,
  isPopular,
  billingCycle,
}: {
  tier: PricingTier
  isPopular: boolean
  billingCycle: 'monthly' | 'yearly'
}) {
  const price = billingCycle === 'monthly' ? tier.priceMonthly : tier.priceYearly / 12

  return (
    <div className={`relative bg-white dark:bg-gray-800 rounded-2xl border-2 p-6 transition-all hover:shadow-xl ${
      isPopular ? 'border-blue-500 shadow-lg scale-105' : 'border-gray-100 dark:border-gray-700 hover:border-gray-200'
    }`}>
      {isPopular && (
        <div className="absolute -top-4 left-1/2 -translate-x-1/2">
          <span className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-semibold rounded-full shadow-lg">
            <Star className="w-3.5 h-3.5" />
            Most Popular
          </span>
        </div>
      )}

      <div className="text-center mb-6">
        <h3 className="text-xl font-bold text-gray-900 dark:text-white">{tier.displayName}</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {tier.name === 'starter' && 'For small businesses'}
          {tier.name === 'professional' && 'For growing teams'}
          {tier.name === 'business' && 'For established businesses'}
          {tier.name === 'enterprise' && 'For large organizations'}
        </p>
      </div>

      <div className="text-center mb-6">
        <div className="flex items-baseline justify-center gap-1">
          <span className="text-3xl font-bold text-gray-900 dark:text-white">
            {formatCurrencyWithSymbol(Math.round(price), tier.currency)}
          </span>
          <span className="text-gray-500 dark:text-gray-400">/mo</span>
        </div>
        {billingCycle === 'yearly' && (
          <p className="text-sm text-green-600 font-medium mt-1">
            Save {formatCurrencyWithSymbol(tier.priceMonthly * 12 - tier.priceYearly, tier.currency)}/year
          </p>
        )}
      </div>

      {/* Storage Limits */}
      <div className="space-y-2 mb-4 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-md">
        <div className="flex items-center gap-2 text-sm">
          <Database className="w-4 h-4 text-purple-500" />
          <span className="font-medium text-gray-900 dark:text-white">
            {tier.maxDatabaseBytes ? formatBytes(tier.maxDatabaseBytes) : 'Custom'} DB
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <HardDrive className="w-4 h-4 text-green-500" />
          <span className="font-medium text-gray-900 dark:text-white">
            {tier.maxFileStorageBytes ? formatBytes(tier.maxFileStorageBytes) : 'Custom'} Files
          </span>
        </div>
      </div>

      <ul className="space-y-2.5 mb-6">
        <li className="flex items-center gap-3 text-sm">
          <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center">
            <Users className="w-3 h-3 text-green-600" />
          </div>
          <span className="text-gray-700 dark:text-gray-300">Unlimited Users & Sales</span>
        </li>
        <li className="flex items-center gap-3 text-sm">
          <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center">
            <Check className="w-3 h-3 text-green-600" />
          </div>
          <span className="text-gray-700 dark:text-gray-300">
            {(tier.features as Record<string, unknown>)?.advancedReports ? 'Advanced' : 'Basic'} Reports
          </span>
        </li>
      </ul>

      <Link
        href="/account/plans"
        className={`block w-full py-3 px-4 rounded-md font-medium text-center transition-all ${
          isPopular
            ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700 shadow-md hover:shadow-lg'
            : 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white hover:bg-gray-200'
        }`}
      >
        Get Started
      </Link>
    </div>
  )
}

// FAQ Item Component
function FAQItem({ faq, isOpen, onToggle, id }: { faq: FAQ; isOpen: boolean; onToggle: () => void; id: string }) {
  return (
    <div className="border-b border-gray-100 dark:border-gray-700 last:border-0">
      <button
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={`faq-answer-${id}`}
        id={`faq-question-${id}`}
        className="w-full flex items-center justify-between py-5 text-left"
      >
        <span className="font-medium text-gray-900 dark:text-white">{faq.question}</span>
        {isOpen ? (
          <ChevronUp className="w-5 h-5 text-gray-400" />
        ) : (
          <ChevronDown className="w-5 h-5 text-gray-400" />
        )}
      </button>
      {isOpen && (
        <div
          id={`faq-answer-${id}`}
          role="region"
          aria-labelledby={`faq-question-${id}`}
        >
          <p className="pb-5 text-gray-600 dark:text-gray-400 leading-relaxed">{faq.answer}</p>
        </div>
      )}
    </div>
  )
}

export default function AccountDashboard() {
  const { data: session } = useSession()
  const [companies, setCompanies] = useState<Company[]>([])
  const [pricingTiers, setPricingTiers] = useState<PricingTier[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentTime, setCurrentTime] = useState(() => Date.now())
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly')
  const [openFAQ, setOpenFAQ] = useState<number | null>(null)
  const [stats, setStats] = useState<DashboardStats>({
    totalSites: 0,
    activeSites: 0,
    freeSites: 0,
    totalDatabaseBytes: 0,
    totalFileStorageBytes: 0,
    credits: 0,
    currency: 'USD',
  })

  // Update current time on mount
  useEffect(() => {
    setCurrentTime(Date.now())
  }, [])

  // Delete modal state
  const [deleteModal, setDeleteModal] = useState<{ open: boolean; company: Company | null }>({
    open: false,
    company: null,
  })
  const [deletePassword, setDeletePassword] = useState('')
  const [deleting, setDeleting] = useState(false)

  const fetchData = useCallback(async () => {
    setError(null)
    try {
      const [companiesRes, walletRes, tiersRes] = await Promise.all([
        fetch('/api/account/companies'),
        fetch('/api/account/wallet'),
        fetch('/api/account/pricing-tiers'),
      ])

      if (companiesRes.ok) {
        const companiesData = await companiesRes.json()
        setCompanies(companiesData)

        const active = companiesData.filter((c: Company) => c.subscription?.status === 'active').length
        const free = companiesData.filter((c: Company) => c.subscription?.status === 'trial').length

        // Use cached tenantUsage initially
        const cachedDb = companiesData.reduce((sum: number, c: Company) => sum + (c.usage?.databaseBytes || 0), 0)
        const cachedFiles = companiesData.reduce(
          (sum: number, c: Company) => sum + (c.usage?.fileStorageBytes || 0),
          0
        )

        setStats((prev) => ({
          ...prev,
          totalSites: companiesData.length,
          activeSites: active,
          freeSites: free,
          totalDatabaseBytes: cachedDb,
          totalFileStorageBytes: cachedFiles,
        }))

        // Fetch real-time breakdown for each company to get accurate totals
        const breakdownPromises = companiesData.map((c: Company) =>
          fetch(`/api/account/usage/${c.id}/breakdown`)
            .then(r => r.ok ? r.json() : null)
            .catch(() => null)
        )
        const breakdowns = await Promise.all(breakdownPromises)

        let realTimeDb = 0
        let realTimeFiles = 0
        let hasBreakdown = false
        const updatedCompanies = companiesData.map((c: Company, i: number) => {
          const bd = breakdowns[i]
          if (bd) {
            hasBreakdown = true
            const dbBytes = bd.database?.totalBytes || 0
            const fileBytes = bd.files?.totalBytes || 0
            realTimeDb += dbBytes
            realTimeFiles += fileBytes
            return {
              ...c,
              usage: {
                databaseBytes: dbBytes,
                fileStorageBytes: fileBytes,
                updatedAt: c.usage?.updatedAt || null,
              },
            }
          }
          realTimeDb += c.usage?.databaseBytes || 0
          realTimeFiles += c.usage?.fileStorageBytes || 0
          return c
        })

        if (hasBreakdown) {
          setCompanies(updatedCompanies)
          setStats((prev) => ({
            ...prev,
            totalDatabaseBytes: realTimeDb,
            totalFileStorageBytes: realTimeFiles,
          }))
        }
      } else {
        const errorData = await companiesRes.json().catch(() => ({}))
        setError(errorData.error || 'Failed to load companies')
      }

      if (walletRes.ok) {
        const walletData = await walletRes.json()
        setStats((prev) => ({
          ...prev,
          credits: walletData.balance || 0,
          currency: walletData.currency || 'USD',
        }))
      }

      if (tiersRes.ok) {
        const tiersData = await tiersRes.json()
        setPricingTiers(tiersData.filter((t: PricingTier) => t.name !== 'trial'))
      }
    } catch (err) {
      console.error('Failed to fetch data:', err)
      setError('Failed to load data. Please check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  // Real-time updates via WebSocket
  useRealtimeData(fetchData, { entityType: ['account-site', 'account-wallet'] })

  const handleDelete = async () => {
    if (!deleteModal.company || !deletePassword) return

    setDeleting(true)

    try {
      const res = await fetch('/api/account/companies', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: deleteModal.company.id,
          password: deletePassword,
        }),
      })

      let data: { error?: string; code?: string } = {}
      const contentType = res.headers.get('content-type')
      if (contentType?.includes('application/json')) {
        try {
          data = await res.json()
        } catch {
          // ignore parse error, use generic message
        }
      }

      if (res.ok) {
        toast.success('Site deleted successfully')
        setDeleteModal({ open: false, company: null })
        setDeletePassword('')
    
        fetchData()
      } else {
        const message = data.error || 'Failed to delete site'
        toast.error(message)
      }
    } catch (err) {
      console.error('Failed to delete:', err)
      toast.error('Network error. Please try again.')
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
    return <PageSkeleton layout="dashboard" />
  }

  if (error) {
    return (
      <div className="max-w-md mx-auto py-12 text-center">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-8 h-8 text-red-600" />
        </div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Something went wrong</h2>
        <p className="text-gray-500 dark:text-gray-400 mb-6">{error}</p>
        <button
          onClick={() => {
            setLoading(true)
            fetchData()
          }}
          className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded hover:bg-gray-800 transition-colors"
        >
          Try Again
        </button>
      </div>
    )
  }

  // Welcome screen for new users
  if (companies.length === 0) {
    return (
      <div className="max-w-4xl mx-auto py-8">
        {/* Hero */}
        <div className="text-center mb-12">
          <div className="w-20 h-20 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-lg">
            <Sparkles className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-3">
            Welcome, {session?.user?.name?.split(' ')[0] || 'there'}!
          </h1>
          <p className="text-xl text-gray-500 dark:text-gray-400">Let&apos;s get your business up and running</p>
        </div>

        {/* Business Type Selection */}
        <div className="bg-white dark:bg-gray-800 rounded-3xl border border-gray-100 dark:border-gray-700 shadow-sm p-8 mb-8">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-6 text-center">
            What type of business are you running?
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {BUSINESS_TYPES.map((type) => (
              <Link
                key={type.value}
                href={`/account/companies/new?type=${type.value}`}
                className="group p-6 rounded-2xl border-2 border-gray-100 dark:border-gray-700 hover:border-blue-500 hover:shadow-lg transition-all text-center"
              >
                <div className="text-4xl mb-3">{type.emoji}</div>
                <p className="font-semibold text-gray-900 dark:text-white group-hover:text-blue-600 transition-colors">{type.label}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{type.description}</p>
              </Link>
            ))}
          </div>
        </div>

        {/* Free Plan Banner */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-3xl p-8 text-white text-center">
          <div className="flex items-center justify-center gap-3 mb-3">
            <Zap className="w-6 h-6" />
            <h3 className="text-xl font-semibold">Free Forever</h3>
          </div>
          <p className="text-blue-100 max-w-md mx-auto">
            Every new business gets full access to all features. No credit card required to start.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-12">
      {/* Hero Section */}
      <div className="bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 rounded-3xl p-8 md:p-10 text-white">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold mb-2">
              Welcome back, {session?.user?.name?.split(' ')[0] || 'there'}
            </h1>
            <p className="text-gray-400 text-lg">Manage your businesses and track performance</p>
          </div>
          <Link
            href="/account/companies/new"
            className="inline-flex items-center gap-2 px-6 py-3 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors font-medium shadow-lg"
          >
            <Plus className="w-5 h-5" />
            New Company
          </Link>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard
          icon={Building2}
          label="Total Sites"
          value={stats.totalSites.toString()}
          subValue={`${stats.activeSites} active, ${stats.freeSites} free`}
          color="blue"
        />
        <StatCard
          icon={Database}
          label="Database Usage"
          value={formatBytes(stats.totalDatabaseBytes)}
          color="purple"
        />
        <StatCard
          icon={HardDrive}
          label="File Storage"
          value={formatBytes(stats.totalFileStorageBytes)}
          color="green"
        />
        <StatCard
          icon={CreditCard}
          label="Wallet Balance"
          value={formatCurrencyWithSymbol(stats.credits, stats.currency)}
          color="orange"
        />
      </div>

      {/* Companies Section */}
      <div>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Your Companies</h2>
          <Link
            href="/account/companies/new"
            className="text-sm font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1"
          >
            <Plus className="w-4 h-4" />
            Add New
          </Link>
        </div>
        <div className="grid gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
          {companies.map((company) => (
            <CompanyCard
              key={company.id}
              company={company}
              onDelete={(c) => {
                setDeleteModal({ open: true, company: c })
            
              }}
              currentTime={currentTime}
            />
          ))}
        </div>
      </div>

      {/* Pricing Section */}
      {pricingTiers.length > 0 && (
        <div className="bg-gradient-to-b from-gray-50 to-white dark:from-gray-800 dark:to-gray-900 rounded-3xl p-8 md:p-12">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-3">
              Choose the Right Plan for You
            </h2>
            <p className="text-gray-500 dark:text-gray-400 max-w-2xl mx-auto">
              All plans include unlimited users and unlimited transactions. Choose based on your storage needs.
            </p>

            {/* Billing Toggle */}
            <div className="flex justify-center mt-6">
              <div className="bg-gray-100 dark:bg-gray-700 p-1.5 rounded-md inline-flex">
                <button
                  onClick={() => setBillingCycle('monthly')}
                  className={`px-5 py-2.5 text-sm font-medium rounded transition-all ${
                    billingCycle === 'monthly'
                      ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900'
                  }`}
                >
                  Monthly
                </button>
                <button
                  onClick={() => setBillingCycle('yearly')}
                  className={`px-5 py-2.5 text-sm font-medium rounded transition-all ${
                    billingCycle === 'yearly'
                      ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900'
                  }`}
                >
                  Yearly
                  <span className="ml-2 text-xs text-green-600 font-semibold bg-green-100 px-2 py-0.5 rounded-full">
                    Save ~17%
                  </span>
                </button>
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:gap-6 sm:grid-cols-2 lg:grid-cols-4 max-w-6xl mx-auto">
            {pricingTiers.map((tier, index) => (
              <PricingCard
                key={tier.id}
                tier={tier}
                isPopular={tier.name === 'professional' || index === 1}
                billingCycle={billingCycle}
              />
            ))}
          </div>

          {/* Trust Badges */}
          <div className="flex flex-wrap items-center justify-center gap-8 mt-12 pt-8 border-t border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
              <Shield className="w-5 h-5" />
              <span className="text-sm font-medium">Secure Payments</span>
            </div>
            <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
              <Headphones className="w-5 h-5" />
              <span className="text-sm font-medium">24/7 Support</span>
            </div>
            <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
              <Globe className="w-5 h-5" />
              <span className="text-sm font-medium">99.9% Uptime</span>
            </div>
            <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
              <TrendingUp className="w-5 h-5" />
              <span className="text-sm font-medium">Free Plan</span>
            </div>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        <Link
          href="/account/wallet"
          className="group bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6 hover:shadow-lg hover:border-green-200 transition-all"
        >
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-green-100 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
              <Zap className="w-7 h-7 text-green-600" />
            </div>
            <div>
              <p className="font-semibold text-gray-900 dark:text-white text-lg">Add Credits</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Top up your wallet balance</p>
            </div>
          </div>
        </Link>

        <Link
          href="/account/billing"
          className="group bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6 hover:shadow-lg hover:border-blue-200 transition-all"
        >
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-blue-100 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
              <CreditCard className="w-7 h-7 text-blue-600" />
            </div>
            <div>
              <p className="font-semibold text-gray-900 dark:text-white text-lg">Billing History</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">View invoices & payments</p>
            </div>
          </div>
        </Link>

        <Link
          href="/account/support"
          className="group bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6 hover:shadow-lg hover:border-purple-200 transition-all"
        >
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-purple-100 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
              <Headphones className="w-7 h-7 text-purple-600" />
            </div>
            <div>
              <p className="font-semibold text-gray-900 dark:text-white text-lg">Get Support</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Contact our team</p>
            </div>
          </div>
        </Link>
      </div>

      {/* FAQ Section */}
      <div className="bg-white dark:bg-gray-800 rounded-3xl border border-gray-100 dark:border-gray-700 p-8">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Frequently Asked Questions</h2>
        <div className="divide-y divide-gray-100 dark:divide-gray-700">
          {faqs.map((faq, index) => (
            <FAQItem
              key={index}
              faq={faq}
              id={String(index)}
              isOpen={openFAQ === index}
              onToggle={() => setOpenFAQ(openFAQ === index ? null : index)}
            />
          ))}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteModal.open && deleteModal.company && (
        <div className="fixed inset-0 bg-black/60 dark:bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="p-4 sm:p-6">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center">
                  <AlertTriangle className="w-7 h-7 text-red-600" />
                </div>
                <div className="flex-1">
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">Delete Site</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">This action cannot be undone</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setDeleteModal({ open: false, company: null })
                    setDeletePassword('')
                
                  }}
                  className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
                >
                  <X className="w-5 h-5 text-gray-400" />
                </button>
              </div>

              {deleteModal.company?.subscription && ['trial', 'active', 'past_due'].includes(deleteModal.company.subscription.status) && (
                <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    Your remaining {deleteModal.company.subscription.status === 'trial' ? 'free plan' : 'plan'} time will be saved and applied to your next company.
                  </p>
                </div>
              )}

              <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-6">
                <p className="text-sm text-red-800">
                  <strong>Warning:</strong> Deleting <strong>{deleteModal.company.name}</strong> will
                  permanently remove all data including customers, sales, inventory, and work orders.
                </p>
              </div>

              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Enter your password to confirm
                </label>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="Your account password"
                  className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-all dark:bg-gray-700 dark:text-white"
                  autoFocus
                />
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setDeleteModal({ open: false, company: null })
                    setDeletePassword('')
                
                  }}
                  className="flex-1 px-4 py-3 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={!deletePassword || deleting}
                  className="flex-1 px-4 py-3 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 font-medium"
                >
                  {deleting ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    'Delete Site'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
