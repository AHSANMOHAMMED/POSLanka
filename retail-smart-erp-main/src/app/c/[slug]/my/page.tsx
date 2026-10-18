'use client'

import { useState, useEffect } from 'react'
import { PermissionGuard } from '@/components/auth/PermissionGuard'
import { Breadcrumb } from '@/components/ui/page-header'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { Loader2, FileText, DollarSign, Banknote, ArrowRight } from 'lucide-react'
import Link from 'next/link'

interface PortalSummary {
  recentSlips: number
  pendingAdvances: number
  totalCommissions: string
}

export default function MyPortalPage() {
  const { tenantSlug: slug } = useCompany()
  const [summary, setSummary] = useState<PortalSummary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const [slipsRes, advancesRes, commissionsRes] = await Promise.all([
          fetch('/api/my/salary-slips?pageSize=1'),
          fetch('/api/my/advances?pageSize=1&status=pending_approval'),
          fetch('/api/my/commissions?pageSize=1'),
        ])

        const slipsData = slipsRes.ok ? await slipsRes.json() : null
        const advancesData = advancesRes.ok ? await advancesRes.json() : null
        const commissionsData = commissionsRes.ok ? await commissionsRes.json() : null

        setSummary({
          recentSlips: slipsData?.pagination?.total || 0,
          pendingAdvances: advancesData?.pagination?.total || 0,
          totalCommissions: commissionsData?.pagination?.total?.toString() || '0',
        })
      } catch {
        // Silently fail - cards will show 0
        setSummary({ recentSlips: 0, pendingAdvances: 0, totalCommissions: '0' })
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    )
  }

  const cards = [
    {
      title: 'My Salary Slips',
      description: 'View your monthly salary slips and payment history',
      icon: FileText,
      href: `/c/${slug}/my/salary-slips`,
      stat: `${summary?.recentSlips || 0} total slips`,
      color: 'bg-blue-50 text-blue-600',
    },
    {
      title: 'My Commissions',
      description: 'Track your commission earnings and payouts',
      icon: DollarSign,
      href: `/c/${slug}/my/commissions`,
      stat: `${summary?.totalCommissions || 0} records`,
      color: 'bg-green-50 text-green-600',
    },
    {
      title: 'My Advances',
      description: 'View advance requests and recovery status',
      icon: Banknote,
      href: `/c/${slug}/my/advances`,
      stat: `${summary?.pendingAdvances || 0} pending`,
      color: 'bg-orange-50 text-orange-600',
    },
  ]

  return (
    <PermissionGuard permission="viewOwnPaySlips">
      <div className="p-6 space-y-6">
        <Breadcrumb items={[{ label: 'My Portal' }]} />
        <h2 className="text-lg font-semibold">My Portal</h2>
        <p className="text-sm text-gray-500">Access your personal salary, commission, and advance information.</p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {cards.map((card) => (
            <Link
              key={card.title}
              href={card.href}
              className="bg-white rounded border p-6 hover:shadow-md transition-shadow group"
            >
              <div className="flex items-start justify-between">
                <div className={`p-3 rounded ${card.color}`}>
                  <card.icon className="w-6 h-6" />
                </div>
                <ArrowRight className="w-5 h-5 text-gray-300 group-hover:text-gray-500 transition-colors" />
              </div>
              <h3 className="text-base font-semibold mt-4">{card.title}</h3>
              <p className="text-sm text-gray-500 mt-1">{card.description}</p>
              <p className="text-sm font-medium text-gray-700 mt-3">{card.stat}</p>
            </Link>
          ))}
        </div>
      </div>
    </PermissionGuard>
  )
}
