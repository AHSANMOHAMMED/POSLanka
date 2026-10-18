'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  BookOpen,
  Calendar,
  FileText,
  Layers,
  Scale,
  TrendingUp,
  BarChart3,
  Users,
  Truck,
  Settings,
  Loader2,
  Sparkles,
} from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { useRealtimeData } from '@/hooks'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'

interface AccountingCard {
  title: string
  description: string
  href: string
  icon: React.ReactNode
  color: string
}

export default function AccountingPage() {
  const { tenantSlug } = useCompany()
  const router = useRouter()
  const [accounts, setAccounts] = useState<unknown[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [settingUp, setSettingUp] = useState(false)

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch('/api/accounting/accounts?all=true')
      if (res.ok) {
        const data = await res.json()
        setAccounts(Array.isArray(data) ? data : data.data || [])
      } else {
        setAccounts([])
      }
    } catch {
      setAccounts([])
    } finally {
      setLoading(false)
    }
  }, [])

  useRealtimeData(fetchAccounts, { entityType: 'account' })

  const cards: AccountingCard[] = [
    {
      title: 'Chart of Accounts',
      description: 'Manage your account structure and hierarchy',
      href: `/c/${tenantSlug}/accounting/chart-of-accounts`,
      icon: <BookOpen size={24} />,
      color: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
    },
    {
      title: 'Fiscal Years',
      description: 'Manage accounting periods and fiscal years',
      href: `/c/${tenantSlug}/accounting/fiscal-years`,
      icon: <Calendar size={24} />,
      color: 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
    },
    {
      title: 'Journal Entries',
      description: 'Create and manage manual journal entries',
      href: `/c/${tenantSlug}/accounting/journal-entries`,
      icon: <FileText size={24} />,
      color: 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400',
    },
    {
      title: 'General Ledger',
      description: 'View all ledger entries and transactions',
      href: `/c/${tenantSlug}/accounting/general-ledger`,
      icon: <Layers size={24} />,
      color: 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400',
    },
    {
      title: 'Trial Balance',
      description: 'View debit and credit balances for all accounts',
      href: `/c/${tenantSlug}/accounting/reports/trial-balance`,
      icon: <Scale size={24} />,
      color: 'bg-cyan-50 dark:bg-cyan-900/20 text-cyan-600 dark:text-cyan-400',
    },
    {
      title: 'Profit & Loss',
      description: 'Income and expense summary report',
      href: `/c/${tenantSlug}/accounting/reports/profit-and-loss`,
      icon: <TrendingUp size={24} />,
      color: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400',
    },
    {
      title: 'Balance Sheet',
      description: 'Assets, liabilities, and equity overview',
      href: `/c/${tenantSlug}/accounting/reports/balance-sheet`,
      icon: <BarChart3 size={24} />,
      color: 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400',
    },
    {
      title: 'Accounts Receivable',
      description: 'Outstanding customer balances and aging',
      href: `/c/${tenantSlug}/accounting/reports/accounts-receivable`,
      icon: <Users size={24} />,
      color: 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400',
    },
    {
      title: 'Accounts Payable',
      description: 'Outstanding supplier balances and aging',
      href: `/c/${tenantSlug}/accounting/reports/accounts-payable`,
      icon: <Truck size={24} />,
      color: 'bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400',
    },
    {
      title: 'Settings',
      description: 'Configure default accounts and preferences',
      href: `/c/${tenantSlug}/accounting/settings`,
      icon: <Settings size={24} />,
      color: 'bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-400',
    },
  ]

  async function handleSetup() {
    setSettingUp(true)
    try {
      const res = await fetch('/api/accounting/setup', { method: 'POST' })
      if (res.ok) {
        toast.success('Default Chart of Accounts created successfully')
        router.push(`/c/${tenantSlug}/accounting/chart-of-accounts`)
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to set up accounting')
      }
    } catch {
      toast.error('Error setting up accounting')
    } finally {
      setSettingUp(false)
    }
  }

  if (loading) {
    return <PageLoading text="Loading accounting..." />
  }

  const isSetUp = accounts && accounts.length > 0

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Accounting</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Manage your chart of accounts, journal entries, and financial reports
        </p>
      </div>

      {!isSetUp && (
        <div className="mb-8 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded p-6 text-center">
          <Sparkles size={40} className="mx-auto mb-3 text-blue-500 dark:text-blue-400" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            Set Up Accounting
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-4 max-w-md mx-auto">
            Get started by creating a default Chart of Accounts with standard account categories for your business.
          </p>
          <button
            onClick={handleSetup}
            disabled={settingUp}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {settingUp ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Setting up...
              </>
            ) : (
              <>
                <Sparkles size={16} />
                Setup Accounting
              </>
            )}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((card) => (
          <Link
            key={card.title}
            href={card.href}
            className="block bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-5 hover:shadow-md hover:border-gray-300 dark:hover:border-gray-600 transition-all group"
          >
            <div className="flex items-start gap-4">
              <div className={`p-3 rounded ${card.color}`}>
                {card.icon}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                  {card.title}
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {card.description}
                </p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
