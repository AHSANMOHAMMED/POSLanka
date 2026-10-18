'use client'

import Link from 'next/link'
import { Check, Star } from 'lucide-react'
import { motion } from 'framer-motion'

interface PricingCardProps {
  name: string
  price: string
  period: string
  features: string[]
  popular?: boolean
  storage?: string
  fileStorage?: string
  currencyNote?: string
  currencyCode?: string
  isCustom?: boolean
}

export default function PricingCard({
  name,
  price,
  period,
  features,
  popular = false,
  storage,
  fileStorage,
  currencyNote,
  currencyCode,
  isCustom = false,
}: PricingCardProps) {
  return (
    <motion.div
      whileHover={{ y: -6 }}
      transition={{ duration: 0.25 }}
      className={`relative rounded-2xl p-7 ${
        popular
          ? 'gradient-border-animated bg-white/5 shadow-2xl shadow-emerald-500/5'
          : 'bg-white/5 border border-white/10 hover:shadow-lg'
      } transition-shadow`}
    >
      {popular && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 px-4 py-1 bg-gradient-to-r from-emerald-600 to-emerald-500 text-white text-xs font-bold rounded-full shadow-lg">
          <Star size={12} className="fill-white" /> Most Popular
        </span>
      )}

      <h3 className="text-lg font-bold text-white">{name}</h3>
      <div className="mt-4 mb-5">
        {isCustom ? (
          <span className="text-2xl font-bold text-white">Custom Pricing</span>
        ) : (
          <>
            {period === 'forever' && (
              <span className="inline-block mb-3 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full">
                Free Forever
              </span>
            )}
            <div>
              <span className="text-4xl font-extrabold text-white tracking-tight">{currencyNote}{price}</span>
              {period === 'forever' ? (
                <span className="text-sm text-emerald-400/70 ml-1">/forever</span>
              ) : (
                <span className="text-sm text-zinc-500 ml-1">/{period}</span>
              )}
            </div>
            {currencyCode && <p className="text-xs text-zinc-500 mt-1">{currencyCode}</p>}
            {period === 'forever' && (
              <p className="text-xs text-zinc-500 mt-2">No credit card &middot; No expiry</p>
            )}
          </>
        )}
      </div>

      {(storage || fileStorage) && (
        <div className="mb-5 space-y-1 text-sm text-zinc-400">
          {storage && <p>Database: <span className="font-semibold text-white">{storage}</span></p>}
          {fileStorage && <p>File Storage: <span className="font-semibold text-white">{fileStorage}</span></p>}
        </div>
      )}

      <ul className="space-y-3 mb-7">
        {features.map((feature, i) => (
          <li key={i} className="flex items-start gap-2.5 text-sm text-zinc-300">
            <div className="mt-0.5 w-4 h-4 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center flex-shrink-0">
              <Check size={10} className="text-white" />
            </div>
            {feature}
          </li>
        ))}
      </ul>

      <Link
        href={isCustom ? '/contact' : '/register'}
        className={`block w-full py-3 text-center text-sm font-semibold rounded-md transition-all ${
          popular
            ? 'bg-gradient-to-r from-emerald-600 to-emerald-500 text-white hover:from-emerald-700 hover:to-emerald-600 shadow-lg shadow-emerald-600/25'
            : 'border-2 border-white/10 text-white hover:border-emerald-500/30 hover:text-emerald-400 hover:bg-emerald-500/10'
        }`}
      >
        {isCustom ? 'Contact Us' : period === 'forever' ? 'Get Started Free' : 'Get Started'}
      </Link>
    </motion.div>
  )
}
