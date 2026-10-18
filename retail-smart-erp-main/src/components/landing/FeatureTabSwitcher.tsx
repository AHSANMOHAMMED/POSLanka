'use client'

import { useState, type ReactNode } from 'react'
import { type LucideIcon } from 'lucide-react'
import { Check } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { BrowserMockup, FadeIn } from './motion'

interface Tab {
  key: string
  label: string
  icon: LucideIcon
  gradient: string
  mockup: ReactNode
  features: string[]
  description: string
}

interface FeatureTabSwitcherProps {
  tabs: Tab[]
}

export default function FeatureTabSwitcher({ tabs }: FeatureTabSwitcherProps) {
  const [active, setActive] = useState(tabs[0]?.key || '')
  const current = tabs.find((t) => t.key === active) || tabs[0]

  return (
    <div>
      {/* Tab buttons */}
      <FadeIn className="flex flex-wrap justify-center gap-2 mb-10">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActive(tab.key)}
            className={`relative flex items-center gap-2 px-4 py-2.5 rounded-md text-sm font-semibold transition-all ${
              active === tab.key
                ? 'text-white shadow-lg'
                : 'bg-white/5 border border-white/10 text-zinc-400 hover:border-emerald-500/30 hover:text-emerald-400 hover:bg-emerald-500/10'
            }`}
            style={
              active === tab.key
                ? { background: `linear-gradient(135deg, var(--tw-gradient-from, #059669), var(--tw-gradient-to, #10b981))` }
                : undefined
            }
          >
            {active === tab.key && (
              <motion.div
                layoutId="tab-bg"
                className={`absolute inset-0 rounded-md bg-gradient-to-r ${tab.gradient} shadow-lg`}
                style={{ zIndex: -1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              />
            )}
            <tab.icon size={16} />
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </FadeIn>

      {/* Content area */}
      <AnimatePresence mode="wait">
        {current && (
          <motion.div
            key={current.key}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
            className="grid lg:grid-cols-2 gap-10 lg:gap-14 items-center"
          >
            {/* Mockup */}
            <div>
              <BrowserMockup url="app.retailsmarterp.com">
                {current.mockup}
              </BrowserMockup>
            </div>

            {/* Features */}
            <div>
              <h3 className="text-2xl sm:text-3xl font-bold text-white mb-3">
                {current.label}
              </h3>
              <p className="text-zinc-400 leading-relaxed mb-6">
                {current.description}
              </p>
              <ul className="space-y-3">
                {current.features.map((feature, i) => (
                  <motion.li
                    key={feature}
                    initial={{ opacity: 0, x: -15 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.08, duration: 0.3 }}
                    className="flex items-center gap-3"
                  >
                    <div className={`w-5 h-5 rounded-full bg-gradient-to-br ${current.gradient} flex items-center justify-center flex-shrink-0`}>
                      <Check className="w-3 h-3 text-white" />
                    </div>
                    <span className="text-sm text-zinc-300 font-medium">{feature}</span>
                  </motion.li>
                ))}
              </ul>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
