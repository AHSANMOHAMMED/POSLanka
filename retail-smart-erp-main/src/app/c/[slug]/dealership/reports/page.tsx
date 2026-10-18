'use client'

import { BarChart3, TrendingUp, Receipt, Users, FileWarning, Clock } from 'lucide-react'
import { ListPageLayout } from '@/components/layout/ListPageLayout'

interface ReportCard {
  title: string
  description: string
  icon: React.ReactNode
  color: string
}

const reports: ReportCard[] = [
  {
    title: 'Vehicle Aging Report',
    description: 'Track how long vehicles have been in inventory. Identify slow-moving stock and vehicles that need price adjustments or promotional attention.',
    icon: <Clock size={24} />,
    color: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20',
  },
  {
    title: 'Profit/Loss per Vehicle',
    description: 'Analyze profitability for each vehicle sold. Includes purchase cost, import taxes, preparation expenses, and final selling price breakdown.',
    icon: <TrendingUp size={24} />,
    color: 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20',
  },
  {
    title: 'Import Tax Summary',
    description: 'Consolidated view of all import duties, excise taxes, VAT, and surcharges paid. Grouped by period, vehicle type, and HS code classification.',
    icon: <Receipt size={24} />,
    color: 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20',
  },
  {
    title: 'Dealer Performance',
    description: 'Evaluate dealer network performance by sales volume, revenue generated, commission earned, allocation turnaround time, and payment compliance.',
    icon: <Users size={24} />,
    color: 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20',
  },
  {
    title: 'Document Expiry Alerts',
    description: 'Monitor expiring documents such as revenue licenses, emission certificates, insurance policies, and dealer contracts. Alerts before expiry dates.',
    icon: <FileWarning size={24} />,
    color: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20',
  },
]

export default function DealershipReportsPage() {
  return (
    <ListPageLayout
      module="Dealership"
      moduleHref="/dealership/inventory"
      title="Reports"
    >
      <div className="px-4 py-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {reports.map((report) => (
            <div
              key={report.title}
              className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-5 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between mb-3">
                <div className={`p-2.5 rounded ${report.color}`}>
                  {report.icon}
                </div>
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                  Coming Soon
                </span>
              </div>
              <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-2">
                {report.title}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                {report.description}
              </p>
            </div>
          ))}
        </div>

        {/* Summary Note */}
        <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded">
          <div className="flex items-start gap-3">
            <BarChart3 size={20} className="text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-medium text-blue-900 dark:text-blue-300">
                Reports Module Under Development
              </h4>
              <p className="text-sm text-blue-700 dark:text-blue-400 mt-1">
                These reports are being developed to provide comprehensive insights into your dealership operations.
                Data is already being collected from your imports, inventory, allocations, and payments modules.
              </p>
            </div>
          </div>
        </div>
      </div>
    </ListPageLayout>
  )
}
