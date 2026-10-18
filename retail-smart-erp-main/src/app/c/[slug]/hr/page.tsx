'use client'

import Link from 'next/link'
import {
  Users,
  Calculator,
  Layers,
  FileText,
  Play,
  Banknote,
} from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'

interface HRCard {
  title: string
  description: string
  href: string
  icon: React.ReactNode
  color: string
}

export default function HRPage() {
  const { tenantSlug } = useCompany()

  const cards: HRCard[] = [
    {
      title: 'Employees',
      description: 'Manage employee profiles, employment details, and bank information',
      href: `/c/${tenantSlug}/hr/employees`,
      icon: <Users size={24} />,
      color: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
    },
    {
      title: 'Salary Components',
      description: 'Configure earnings, deductions, and statutory components with formulas',
      href: `/c/${tenantSlug}/hr/salary-components`,
      icon: <Calculator size={24} />,
      color: 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
    },
    {
      title: 'Salary Structures',
      description: 'Create salary templates by grouping components together',
      href: `/c/${tenantSlug}/hr/salary-structures`,
      icon: <Layers size={24} />,
      color: 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400',
    },
    {
      title: 'Salary Slips',
      description: 'View and manage monthly salary slips for employees',
      href: `/c/${tenantSlug}/hr/salary-slips`,
      icon: <FileText size={24} />,
      color: 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400',
    },
    {
      title: 'Payroll Runs',
      description: 'Process bulk payroll for all eligible employees',
      href: `/c/${tenantSlug}/hr/payroll-runs`,
      icon: <Play size={24} />,
      color: 'bg-cyan-50 dark:bg-cyan-900/20 text-cyan-600 dark:text-cyan-400',
    },
    {
      title: 'Employee Advances',
      description: 'Manage advance requests, approvals, and salary deductions',
      href: `/c/${tenantSlug}/hr/employee-advances`,
      icon: <Banknote size={24} />,
      color: 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400',
    },
  ]

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Human Resources</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Manage employees, payroll, salary structures, and advances
        </p>
      </div>

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
