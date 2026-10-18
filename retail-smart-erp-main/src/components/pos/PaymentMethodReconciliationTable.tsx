'use client'

import { formatCurrency } from '@/lib/utils/currency'
import { DollarSign, CreditCard, Banknote } from 'lucide-react'

export interface PaymentMethodBreakdown {
  openingBalances: Record<string, number>
  salesByMethod: Record<string, {
    sales: number
    returns: number
    netSales: number
    transactionCount: number
  }>
  expectedAmounts: Record<string, number>
  varianceByMethod: Record<string, number>
  totalVariance: number
}

export interface PaymentReconciliationRow {
  paymentMethod: string
  label: string
  icon: React.ReactNode
  openingBalance: number
  netSales: number
  expectedAmount: number
  actualAmount: number
  variance: number
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  bank_transfer: 'Bank Transfer',
  credit: 'Store Credit',
  gift_card: 'Gift Card',
  mobile_payment: 'Mobile Payment',
}

const PAYMENT_METHOD_ICONS: Record<string, React.ReactNode> = {
  cash: <Banknote size={18} />,
  card: <CreditCard size={18} />,
  bank_transfer: <DollarSign size={18} />,
  credit: <DollarSign size={18} />,
  gift_card: <CreditCard size={18} />,
  mobile_payment: <CreditCard size={18} />,
}

interface PaymentMethodReconciliationTableProps {
  breakdown: PaymentMethodBreakdown
  actualAmounts: Record<string, number>
  onActualAmountChange?: (paymentMethod: string, amount: number) => void
  readOnly?: boolean
}

export function PaymentMethodReconciliationTable({
  breakdown,
  actualAmounts,
  onActualAmountChange,
  readOnly = false,
}: PaymentMethodReconciliationTableProps) {
  // Collect all payment methods from any source (openingBalances, salesByMethod, expectedAmounts)
  const allMethods = Array.from(new Set([
    ...Object.keys(breakdown.openingBalances || {}),
    ...Object.keys(breakdown.salesByMethod || {}),
    ...Object.keys(breakdown.expectedAmounts || {}),
  ]))

  // Transform breakdown into table rows
  const rows: PaymentReconciliationRow[] = allMethods.map((method) => {
    const salesData = breakdown.salesByMethod[method] || { sales: 0, returns: 0, netSales: 0, transactionCount: 0 }
    const expectedAmount = breakdown.expectedAmounts[method] || 0
    const actualAmount = actualAmounts[method] || 0
    const variance = actualAmount - expectedAmount

    return {
      paymentMethod: method,
      label: PAYMENT_METHOD_LABELS[method] || method,
      icon: PAYMENT_METHOD_ICONS[method] || <DollarSign size={18} />,
      openingBalance: breakdown.openingBalances[method] || 0,
      netSales: salesData.netSales,
      expectedAmount,
      actualAmount,
      variance,
    }
  })

  // Calculate totals
  const totals = rows.reduce(
    (acc, row) => ({
      openingBalance: acc.openingBalance + row.openingBalance,
      netSales: acc.netSales + row.netSales,
      expectedAmount: acc.expectedAmount + row.expectedAmount,
      actualAmount: acc.actualAmount + row.actualAmount,
      variance: acc.variance + row.variance,
    }),
    { openingBalance: 0, netSales: 0, expectedAmount: 0, actualAmount: 0, variance: 0 }
  )

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded border border-gray-200 dark:border-gray-700">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th className="text-left p-3 text-sm font-medium text-gray-500 dark:text-gray-400">
                Payment Method
              </th>
              <th className="text-right p-3 text-sm font-medium text-gray-500 dark:text-gray-400">
                Opening Balance
              </th>
              <th className="text-right p-3 text-sm font-medium text-gray-500 dark:text-gray-400">
                Net Sales
              </th>
              <th className="text-right p-3 text-sm font-medium text-gray-500 dark:text-gray-400">
                Expected
              </th>
              <th className="text-right p-3 text-sm font-medium text-gray-500 dark:text-gray-400">
                Actual
              </th>
              <th className="text-right p-3 text-sm font-medium text-gray-500 dark:text-gray-400">
                Variance
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {rows.map((row) => (
              <tr key={row.paymentMethod} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 dark:text-gray-400">{row.icon}</span>
                    <span className="text-sm font-medium dark:text-gray-300">{row.label}</span>
                  </div>
                </td>
                <td className="p-3 text-right text-sm dark:text-gray-300">
                  {formatCurrency(row.openingBalance)}
                </td>
                <td className="p-3 text-right text-sm dark:text-gray-300">
                  {formatCurrency(row.netSales)}
                </td>
                <td className="p-3 text-right text-sm font-medium dark:text-white">
                  {formatCurrency(row.expectedAmount)}
                </td>
                <td className="p-3 text-right">
                  {readOnly ? (
                    <div className="text-sm font-medium dark:text-white">
                      {formatCurrency(row.actualAmount)}
                    </div>
                  ) : (
                    <div className="relative">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
                        $
                      </span>
                      <input
                        type="number"
                        value={row.actualAmount || ''}
                        onChange={(e) =>
                          onActualAmountChange?.(
                            row.paymentMethod,
                            parseFloat(e.target.value) || 0
                          )
                        }
                        className="w-32 pl-6 pr-2 py-1.5 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                        placeholder="0.00"
                        min="0"
                        step="0.01"
                      />
                    </div>
                  )}
                </td>
                <td className="p-3 text-right">
                  <div
                    className={`text-sm font-medium ${
                      Math.abs(row.variance) < 0.01
                        ? 'text-green-600 dark:text-green-400'
                        : row.variance > 0
                        ? 'text-blue-600 dark:text-blue-400'
                        : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {row.variance > 0 ? '+' : ''}
                    {formatCurrency(row.variance)}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
            <tr>
              <td className="p-3 text-sm font-medium dark:text-gray-300">Total</td>
              <td className="p-3 text-right text-sm font-medium dark:text-white">
                {formatCurrency(totals.openingBalance)}
              </td>
              <td className="p-3 text-right text-sm font-medium dark:text-white">
                {formatCurrency(totals.netSales)}
              </td>
              <td className="p-3 text-right text-sm font-medium dark:text-white">
                {formatCurrency(totals.expectedAmount)}
              </td>
              <td className="p-3 text-right text-sm font-medium dark:text-white">
                {formatCurrency(totals.actualAmount)}
              </td>
              <td className="p-3 text-right">
                <div
                  className={`text-sm font-medium ${
                    Math.abs(totals.variance) < 0.01
                      ? 'text-green-600 dark:text-green-400'
                      : totals.variance > 0
                      ? 'text-blue-600 dark:text-blue-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {totals.variance > 0 ? '+' : ''}
                  {formatCurrency(totals.variance)}
                </div>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded p-4">
          <div className="text-sm text-blue-600 dark:text-blue-400 mb-1">Opening Balance</div>
          <div className="text-xl font-bold dark:text-white">
            {formatCurrency(totals.openingBalance)}
          </div>
        </div>
        <div className="bg-green-50 dark:bg-green-900/20 rounded p-4">
          <div className="text-sm text-green-600 dark:text-green-400 mb-1">Net Sales</div>
          <div className="text-xl font-bold dark:text-white">
            {formatCurrency(totals.netSales)}
          </div>
        </div>
        <div className={`p-4 rounded ${
          Math.abs(totals.variance) < 0.01
            ? 'bg-green-50 dark:bg-green-900/20'
            : totals.variance > 0
            ? 'bg-blue-50 dark:bg-blue-900/20'
            : 'bg-red-50 dark:bg-red-900/20'
        }`}>
          <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Total Variance</div>
          <div className={`text-xl font-bold ${
            Math.abs(totals.variance) < 0.01
              ? 'text-green-600 dark:text-green-400'
              : totals.variance > 0
              ? 'text-blue-600 dark:text-blue-400'
              : 'text-red-600 dark:text-red-400'
          }`}>
            {totals.variance > 0 ? '+' : ''}
            {formatCurrency(totals.variance)}
          </div>
          {Math.abs(totals.variance) > 0.01 && (
            <div className="text-xs mt-1 text-gray-600 dark:text-gray-400">
              {totals.variance > 0 ? 'Overage' : 'Shortage'} detected
            </div>
          )}
        </div>
      </div>
    </div>
  )
}