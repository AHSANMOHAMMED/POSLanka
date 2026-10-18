'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Check,
  Loader2,
  CreditCard,
  Building2,
  Crown,
  Sparkles,
  Database,
  HardDrive,
  Users,
  ShoppingCart,
  Zap,
  X,
  Phone,
  MessageSquare,
} from 'lucide-react'
import { formatCurrencyWithSymbol } from '@/lib/utils/currency'
import { ContactModal } from '@/components/modals'

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

interface Company {
  id: string
  name: string
  slug: string
  subscription: {
    status: string
    tierName: string
    tierId: string
  } | null
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}


function getLocationsLabel(features: Record<string, unknown>): string {
  const locations = features.locations as number | undefined
  if (!locations || locations === -1) return 'Unlimited'
  if (locations === 1) return '1 Location'
  return `Up to ${locations}`
}

function getSupportLabel(features: Record<string, unknown>): string {
  const type = features.supportType as string | undefined
  switch (type) {
    case 'email': return 'Email Support'
    case 'email_chat': return 'Email + Chat'
    case 'phone_chat': return 'Phone + Chat'
    case 'dedicated_manager': return 'Dedicated Manager'
    default: return 'Email Support'
  }
}

const tierDescriptions: Record<string, string> = {
  starter: 'Perfect for small businesses getting started',
  professional: 'Ideal for growing businesses with multiple needs',
  business: 'For established businesses with high demands',
  enterprise: 'Tailored solutions for large-scale operations',
}

export default function PlansPage() {
  const router = useRouter()
  const [tiers, setTiers] = useState<PricingTier[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedTier, setSelectedTier] = useState<string | null>(null)
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null)
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly')
  const [updating, setUpdating] = useState(false)
  const [contactModalOpen, setContactModalOpen] = useState(false)

  const fetchData = useCallback(async () => {
    try {
      const [tiersRes, companiesRes] = await Promise.all([
        fetch('/api/account/pricing-tiers'),
        fetch('/api/account/companies'),
      ])

      if (tiersRes.ok) {
        const tiersData = await tiersRes.json()
        setTiers(tiersData.filter((t: PricingTier) => t.name !== 'trial'))
      }

      if (companiesRes.ok) {
        const companiesData = await companiesRes.json()
        setCompanies(companiesData)
      }
    } catch (error) {
      console.error('Failed to fetch data:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleSelectPlan = async () => {
    if (!selectedTier || !selectedCompany) return

    setUpdating(true)
    try {
      const res = await fetch(`/api/account/subscriptions/${selectedCompany}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tierId: selectedTier }),
      })

      if (res.ok) {
        router.push(`/account/payments?plan=${selectedTier}&company=${selectedCompany}`)
      } else {
        const data = await res.json()
        alert(data.error || 'Failed to select plan')
      }
    } catch (error) {
      console.error('Failed to select plan:', error)
      alert('Failed to select plan')
    } finally {
      setUpdating(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400 dark:text-gray-500" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          href="/account"
          className="inline-flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Link>
      </div>

      {/* Hero Section */}
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-purple-500 to-blue-600 rounded-2xl mb-4">
          <Sparkles className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Simple, Transparent Pricing</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-2 max-w-lg mx-auto">
          All features included on every plan. Only storage differs. Unlimited users and transactions.
        </p>
      </div>

      {/* Billing Toggle */}
      <div className="flex justify-center">
        <div className="bg-gray-100 dark:bg-gray-700 p-1.5 rounded-md inline-flex">
          <button
            onClick={() => setBillingCycle('monthly')}
            className={`px-5 py-2.5 text-sm font-medium rounded transition-all ${
              billingCycle === 'monthly'
                ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            Monthly
          </button>
          <button
            onClick={() => setBillingCycle('yearly')}
            className={`px-5 py-2.5 text-sm font-medium rounded transition-all ${
              billingCycle === 'yearly'
                ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            Yearly
            <span className="ml-2 text-xs text-green-600 dark:text-green-400 font-semibold bg-green-100 dark:bg-green-900/30 px-2 py-0.5 rounded-full">Save ~17%</span>
          </button>
        </div>
      </div>

      {/* Unlimited Badge */}
      <div className="flex justify-center">
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-700 rounded-full">
          <Users className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Unlimited Users</span>
          <span className="text-emerald-300 dark:text-emerald-600 mx-1">|</span>
          <ShoppingCart className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Unlimited Transactions</span>
        </div>
      </div>

      {/* Plans Grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {tiers.map((tier) => {
          const isEnterprise = tier.name === 'enterprise'
          const monthlyEquivalent = billingCycle === 'yearly'
            ? tier.priceYearly / 12
            : tier.priceMonthly
          const isPopular = tier.name === 'professional'
          const isSelected = selectedTier === tier.id

          return (
            <div
              key={tier.id}
              onClick={() => { if (!isEnterprise) setSelectedTier(tier.id) }}
              className={`relative bg-white dark:bg-gray-800 rounded-2xl border-2 p-6 transition-all hover:shadow-xl ${
                isEnterprise
                  ? 'border-gray-200 dark:border-gray-700 cursor-default'
                  : isSelected
                  ? 'border-blue-500 ring-4 ring-blue-100 dark:ring-blue-900/50 cursor-pointer'
                  : isPopular
                  ? 'border-blue-500 shadow-lg cursor-pointer'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 cursor-pointer'
              }`}
            >
              {isPopular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-semibold rounded-full">
                    <Crown className="w-3 h-3" />
                    Most Popular
                  </span>
                </div>
              )}
              {isSelected && !isEnterprise && (
                <div className="absolute top-4 right-4">
                  <div className="w-7 h-7 bg-blue-500 rounded-full flex items-center justify-center">
                    <Check className="w-4 h-4 text-white" />
                  </div>
                </div>
              )}

              <div className="mb-4">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">{tier.displayName}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  {tierDescriptions[tier.name] || ''}
                </p>
              </div>

              {/* Price or Custom Pricing */}
              <div className="mb-6">
                {isEnterprise ? (
                  <div>
                    <span className="text-2xl font-bold text-gray-900 dark:text-white">Custom Pricing</span>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Tailored to your needs</p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-bold text-gray-900 dark:text-white">
                        {formatCurrencyWithSymbol(Math.round(monthlyEquivalent * 100) / 100, tier.currency)}
                      </span>
                      <span className="text-gray-500 dark:text-gray-400 text-sm">/mo</span>
                    </div>
                    {billingCycle === 'yearly' && (
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        Billed {formatCurrencyWithSymbol(tier.priceYearly, tier.currency)} yearly
                      </p>
                    )}
                  </>
                )}
              </div>

              {/* Storage Limits */}
              <div className="space-y-3 mb-6 p-3 bg-gray-50 dark:bg-gray-700 rounded-md">
                <div className="flex items-center gap-2 text-sm">
                  <Database className="w-4 h-4 text-purple-500 dark:text-purple-400" />
                  <span className="font-medium text-gray-900 dark:text-white">
                    {tier.maxDatabaseBytes ? formatBytes(tier.maxDatabaseBytes) : 'Custom'} DB
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <HardDrive className="w-4 h-4 text-green-500 dark:text-green-400" />
                  <span className="font-medium text-gray-900 dark:text-white">
                    {tier.maxFileStorageBytes ? formatBytes(tier.maxFileStorageBytes) : 'Custom'} Files
                  </span>
                </div>
              </div>

              {/* Features */}
              <ul className="space-y-2.5 mb-6">
                <li className="flex items-center gap-2 text-sm dark:text-gray-300">
                  <Check className="w-4 h-4 text-green-500 dark:text-green-400 flex-shrink-0" />
                  <span>All features included</span>
                </li>
                <li className="flex items-center gap-2 text-sm dark:text-gray-300">
                  <Check className="w-4 h-4 text-green-500 dark:text-green-400 flex-shrink-0" />
                  <span>Unlimited users & sales</span>
                </li>
                <li className="flex items-center gap-2 text-sm dark:text-gray-300">
                  <Check className="w-4 h-4 text-green-500 dark:text-green-400 flex-shrink-0" />
                  <span>All business types</span>
                </li>
                <li className="flex items-center gap-2 text-sm dark:text-gray-300">
                  <Check className="w-4 h-4 text-green-500 dark:text-green-400 flex-shrink-0" />
                  <span>All reports & analytics</span>
                </li>
              </ul>

              {/* CTA Button */}
              {isEnterprise ? (
                <div className="space-y-3">
                  <button
                    onClick={(e) => { e.stopPropagation(); setContactModalOpen(true) }}
                    className="w-full py-3 px-4 rounded-md font-medium transition-all bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200"
                  >
                    Contact Us
                  </button>
                  <div className="flex items-center justify-center gap-4 text-xs text-gray-500 dark:text-gray-400">
                    <a href="tel:+94778407616" className="inline-flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-300">
                      <Phone className="w-3 h-3" /> 077 840 7616
                    </a>
                    <a href="https://wa.me/94778407616" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-300">
                      <MessageSquare className="w-3 h-3" /> WhatsApp
                    </a>
                  </div>
                </div>
              ) : (
                <button
                  className={`w-full py-3 px-4 rounded-md font-medium transition-all ${
                    isSelected
                      ? 'bg-blue-500 text-white hover:bg-blue-600 shadow-lg'
                      : isPopular
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  {isSelected ? 'Selected' : 'Select Plan'}
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Feature Comparison Table */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Feature Comparison</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-3">Feature</th>
                {tiers.map(tier => (
                  <th key={tier.id} className="text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-4 py-3">
                    {tier.displayName}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              <tr>
                <td className="px-6 py-3 text-sm text-gray-700 dark:text-gray-300">DB Storage</td>
                {tiers.map(tier => (
                  <td key={tier.id} className="px-4 py-3 text-sm text-center font-medium text-gray-900 dark:text-white">
                    {tier.maxDatabaseBytes ? formatBytes(tier.maxDatabaseBytes) : 'Custom'}
                  </td>
                ))}
              </tr>
              <tr className="bg-gray-50 dark:bg-gray-700/50">
                <td className="px-6 py-3 text-sm text-gray-700 dark:text-gray-300">File Storage</td>
                {tiers.map(tier => (
                  <td key={tier.id} className="px-4 py-3 text-sm text-center font-medium text-gray-900 dark:text-white">
                    {tier.maxFileStorageBytes ? formatBytes(tier.maxFileStorageBytes) : 'Custom'}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="px-6 py-3 text-sm text-gray-700 dark:text-gray-300">Users</td>
                {tiers.map(tier => (
                  <td key={tier.id} className="px-4 py-3 text-sm text-center text-gray-900 dark:text-white">Unlimited</td>
                ))}
              </tr>
              <tr className="bg-gray-50 dark:bg-gray-700/50">
                <td className="px-6 py-3 text-sm text-gray-700 dark:text-gray-300">Transactions</td>
                {tiers.map(tier => (
                  <td key={tier.id} className="px-4 py-3 text-sm text-center text-gray-900 dark:text-white">Unlimited</td>
                ))}
              </tr>
              <tr>
                <td className="px-6 py-3 text-sm text-gray-700 dark:text-gray-300">Locations</td>
                {tiers.map(tier => (
                  <td key={tier.id} className="px-4 py-3 text-sm text-center text-gray-900 dark:text-white">
                    {getLocationsLabel(tier.features as Record<string, unknown>)}
                  </td>
                ))}
              </tr>
              <tr className="bg-gray-50 dark:bg-gray-700/50">
                <td className="px-6 py-3 text-sm text-gray-700 dark:text-gray-300">Reports</td>
                {tiers.map(tier => (
                  <td key={tier.id} className="px-4 py-3 text-sm text-center text-gray-900 dark:text-white">
                    {(tier.features as Record<string, unknown>).customReports ? 'Advanced + Custom' :
                     (tier.features as Record<string, unknown>).advancedReports ? 'Advanced' : 'Basic'}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="px-6 py-3 text-sm text-gray-700 dark:text-gray-300">API Access</td>
                {tiers.map(tier => (
                  <td key={tier.id} className="px-4 py-3 text-center">
                    {(tier.features as Record<string, unknown>).apiAccess ?
                      <Check className="w-4 h-4 text-green-500 dark:text-green-400 mx-auto" /> :
                      <X className="w-4 h-4 text-gray-300 dark:text-gray-600 mx-auto" />}
                  </td>
                ))}
              </tr>
              <tr className="bg-gray-50 dark:bg-gray-700/50">
                <td className="px-6 py-3 text-sm text-gray-700 dark:text-gray-300">Support</td>
                {tiers.map(tier => (
                  <td key={tier.id} className="px-4 py-3 text-sm text-center text-gray-900 dark:text-white">
                    {getSupportLabel(tier.features as Record<string, unknown>)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Company Selection */}
      {selectedTier && companies.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-md flex items-center justify-center">
              <Building2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Select a company to upgrade</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">Choose which company should receive this plan</p>
            </div>
          </div>
          <div className="p-6">
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {companies.map((company) => (
                <button
                  key={company.id}
                  onClick={() => setSelectedCompany(company.id)}
                  className={`p-4 rounded-md border-2 text-left transition-all ${
                    selectedCompany === company.id
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-12 h-12 rounded-md flex items-center justify-center ${
                      selectedCompany === company.id ? 'bg-blue-100 dark:bg-blue-900/30' : 'bg-gray-100 dark:bg-gray-700'
                    }`}>
                      <Building2 className={`w-6 h-6 ${
                        selectedCompany === company.id ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400'
                      }`} />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white">{company.name}</p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {company.subscription?.status === 'trial'
                          ? 'Free Plan'
                          : company.subscription?.tierName || 'No plan'}
                      </p>
                    </div>
                    {selectedCompany === company.id && (
                      <Check className="w-5 h-5 text-blue-500 ml-auto" />
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Continue Button */}
      {selectedTier && selectedCompany && (
        <div className="flex justify-end">
          <button
            onClick={handleSelectPlan}
            disabled={updating}
            className="inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-blue-600 to-blue-500 text-white rounded-md hover:from-blue-700 hover:to-blue-600 transition-all disabled:opacity-50 font-semibold text-lg shadow-lg shadow-blue-500/25"
          >
            {updating ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <CreditCard className="w-5 h-5" />
                Continue to Payment
              </>
            )}
          </button>
        </div>
      )}

      {/* No companies message */}
      {selectedTier && companies.length === 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-2xl p-8 text-center">
          <div className="w-16 h-16 bg-amber-100 dark:bg-amber-900/50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Building2 className="w-8 h-8 text-amber-600 dark:text-amber-400" />
          </div>
          <p className="text-amber-800 dark:text-amber-300 font-medium">
            You need to create a company first before selecting a plan.
          </p>
          <Link
            href="/account/companies/new"
            className="inline-flex items-center gap-2 mt-4 px-5 py-2.5 bg-amber-600 text-white rounded-md hover:bg-amber-700 transition-colors font-medium"
          >
            Create Company
          </Link>
        </div>
      )}

      {/* Volume Discount Banner */}
      <div className="bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-900/30 dark:to-blue-900/30 border border-purple-200 dark:border-purple-700 rounded-2xl p-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/50 rounded-md flex items-center justify-center flex-shrink-0">
            <Zap className="w-6 h-6 text-purple-600 dark:text-purple-400" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">Volume Discounts Available</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Manage 2+ companies and save 15%. 6+ companies save 25%. 11+ companies save 30%.
            </p>
          </div>
        </div>
      </div>

      {/* Contact Modal for Enterprise */}
      <ContactModal isOpen={contactModalOpen} onClose={() => setContactModalOpen(false)} />
    </div>
  )
}
