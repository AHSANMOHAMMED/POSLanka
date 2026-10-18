'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Building2,
  CreditCard,
  Users,
  Settings,
  BarChart3,
  Bell,
  MessageSquare,
  HelpCircle,
  FileText,
  Wallet,
  Banknote,
  Sparkles,
} from 'lucide-react'
import { formatCurrencyWithSymbol } from '@/lib/utils/currency'

const navigation = [
  {
    name: 'Overview',
    href: '/account',
    icon: BarChart3,
    exact: true,
  },
  {
    name: 'Sites',
    href: '/account/sites',
    icon: Building2,
  },
  {
    name: 'Billing',
    href: '/account/billing',
    icon: CreditCard,
  },
  {
    name: 'Plans',
    href: '/account/plans',
    icon: Sparkles,
  },
  {
    name: 'Payments',
    href: '/account/payments',
    icon: Banknote,
  },
  {
    name: 'Wallet',
    href: '/account/wallet',
    icon: Wallet,
  },
  {
    name: 'Team',
    href: '/account/team',
    icon: Users,
  },
  {
    name: 'Activity',
    href: '/account/activity',
    icon: FileText,
  },
  {
    name: 'Settings',
    href: '/account/settings',
    icon: Settings,
  },
]

const secondaryNavigation = [
  {
    name: 'Messages',
    href: '/account/messages',
    icon: MessageSquare,
  },
  {
    name: 'Notifications',
    href: '/account/notifications',
    icon: Bell,
  },
  {
    name: 'Support',
    href: '/account/support',
    icon: HelpCircle,
  },
]

interface AccountSidebarProps {
  mobileOpen?: boolean
  onMobileClose?: () => void
}

export function AccountSidebar({ mobileOpen = false, onMobileClose }: AccountSidebarProps) {
  const pathname = usePathname()
  const [walletBalance, setWalletBalance] = useState(0)
  const [currency, setCurrency] = useState('LKR')

  // Close mobile sidebar on route change
  useEffect(() => {
    onMobileClose?.()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  useEffect(() => {
    async function fetchWallet() {
      try {
        const res = await fetch('/api/account/wallet')
        if (res.ok) {
          const data = await res.json()
          setWalletBalance(data.balance || 0)
          setCurrency(data.currency || 'LKR')
        }
      } catch (error) {
        console.error('Failed to fetch wallet:', error)
      }
    }
    fetchWallet()
  }, [])

  const isActive = (href: string, exact?: boolean) => {
    if (exact) {
      return pathname === href
    }
    return pathname === href || pathname?.startsWith(href + '/')
  }

  const sidebarContent = (
    <>
      <nav className="flex-1 space-y-1 px-3 py-4">
        <div className="space-y-1">
          {navigation.map((item) => {
            const active = isActive(item.href, item.exact)
            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={onMobileClose}
                className={`group flex items-center gap-3 rounded px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-gray-900 dark:bg-gray-700 text-white'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                <item.icon
                  className={`h-5 w-5 flex-shrink-0 ${
                    active ? 'text-white' : 'text-gray-400 dark:text-gray-500 group-hover:text-gray-600 dark:group-hover:text-gray-400'
                  }`}
                />
                {item.name}
              </Link>
            )
          })}
        </div>

        <div className="mt-8 pt-4 border-t border-gray-200 dark:border-gray-700">
          <p className="px-3 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">
            Support
          </p>
          {secondaryNavigation.map((item) => {
            const active = isActive(item.href)
            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={onMobileClose}
                className={`group flex items-center gap-3 rounded px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-gray-900 dark:bg-gray-700 text-white'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                <item.icon
                  className={`h-5 w-5 flex-shrink-0 ${
                    active ? 'text-white' : 'text-gray-400 dark:text-gray-500 group-hover:text-gray-600 dark:group-hover:text-gray-400'
                  }`}
                />
                {item.name}
              </Link>
            )
          })}
        </div>
      </nav>

      {/* Wallet info */}
      <div className="border-t border-gray-200 dark:border-gray-700 p-4">
        <div className="rounded bg-gray-50 dark:bg-gray-900/50 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Wallet Balance</span>
            <Link
              href="/account/wallet"
              onClick={onMobileClose}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
            >
              Add
            </Link>
          </div>
          <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">
            {formatCurrencyWithSymbol(walletBalance, currency)}
          </p>
        </div>
      </div>
    </>
  )

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          style={{ top: '64px' }}
          onClick={onMobileClose}
          aria-hidden="true"
        />
      )}

      {/* Mobile slide-out sidebar */}
      <aside
        className={`fixed left-0 bottom-0 z-50 w-64 flex flex-col bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 transform transition-transform duration-200 ease-in-out lg:hidden ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{ top: '64px' }}
      >
        {sidebarContent}
      </aside>

      {/* Desktop sidebar */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:flex lg:w-64 lg:flex-col lg:pt-16">
        <div className="flex flex-1 flex-col overflow-y-auto border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          {sidebarContent}
        </div>
      </aside>

      {/* Mobile bottom navigation */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
        <div className="flex justify-around py-2">
          {navigation.slice(0, 5).map((item) => {
            const active = isActive(item.href, item.exact)
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex flex-col items-center px-3 py-2 text-xs ${
                  active ? 'text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-400'
                }`}
              >
                <item.icon className="h-5 w-5 mb-1" />
                {item.name}
              </Link>
            )
          })}
        </div>
      </nav>
    </>
  )
}
