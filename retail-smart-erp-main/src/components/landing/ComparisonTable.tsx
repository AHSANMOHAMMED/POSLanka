'use client'

import { Check } from 'lucide-react'
import { FadeIn } from './motion'

interface ComparisonTableProps {
  headers: string[]
  rows: Array<{ feature: string; values: (boolean | string)[] }>
}

export default function ComparisonTable({ headers, rows }: ComparisonTableProps) {
  return (
    <FadeIn>
      <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/5">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/10 bg-white/[0.02]">
              <th className="px-6 py-4 text-left text-sm font-semibold text-white">Feature</th>
              {headers.map((header, i) => (
                <th key={header} className={`px-6 py-4 text-center text-sm font-semibold ${i === 0 ? 'text-emerald-400' : 'text-white'}`}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className={i % 2 === 0 ? 'bg-transparent' : 'bg-white/[0.02]'}>
                <td className="px-6 py-3.5 text-sm text-zinc-300 font-medium">{row.feature}</td>
                {row.values.map((val, j) => (
                  <td key={j} className="px-6 py-3.5 text-center">
                    {typeof val === 'string' ? (
                      <span className="text-sm font-semibold text-white">{val}</span>
                    ) : (
                      val && (
                        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center mx-auto">
                          <Check size={14} className="text-white" strokeWidth={3} />
                        </div>
                      )
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </FadeIn>
  )
}
