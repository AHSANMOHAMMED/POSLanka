'use client'

import { type LucideIcon } from 'lucide-react'
import { SpringCounter, StaggerContainer, StaggerItemScale } from './motion'

interface Stat {
  value: number
  suffix?: string
  label: string
  icon?: LucideIcon
  gradient?: string
}

interface StatsCounterProps {
  stats: Stat[]
  dark?: boolean
}

export default function StatsCounter({ stats, dark = false }: StatsCounterProps) {
  return (
    <StaggerContainer staggerDelay={0.12} className="grid grid-cols-2 lg:grid-cols-4 gap-8">
      {stats.map((stat, i) => (
        <StaggerItemScale key={i}>
          <div className="text-center">
            {stat.icon && (
              <div className={`w-12 h-12 rounded-md bg-gradient-to-br ${stat.gradient || 'from-blue-500 to-violet-500'} flex items-center justify-center mx-auto mb-3 shadow-lg`}>
                <stat.icon className="w-6 h-6 text-white" />
              </div>
            )}
            <div className={`text-4xl sm:text-5xl font-extrabold tracking-tight ${dark ? 'text-white' : 'gradient-text-animate'}`}>
              <SpringCounter value={stat.value} suffix={stat.suffix || ''} />
            </div>
            <div className={`mt-2 text-sm font-medium ${dark ? 'text-gray-400' : 'text-zinc-400'}`}>{stat.label}</div>
          </div>
        </StaggerItemScale>
      ))}
    </StaggerContainer>
  )
}
