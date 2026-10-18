'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type Step = {
  key: string
  label: string
  done: boolean
  href?: string
}

export function OnboardingChecklist({ companySlug }: { companySlug: string }) {
  const [steps, setSteps] = useState<Step[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch('/api/setup/onboarding-status')
        if (res.ok) {
          const data = await res.json()
          setSteps(data.steps || [])
        } else {
          setSteps([
            { key: 'company', label: 'Create company', done: true },
            { key: 'plan', label: 'Choose plan', done: true },
            {
              key: 'staff',
              label: 'Invite cashiers',
              done: false,
              href: `/c/${companySlug}/settings/users`,
            },
            {
              key: 'item',
              label: 'Add first item',
              done: false,
              href: `/c/${companySlug}/items`,
            },
            {
              key: 'pos',
              label: 'Open POS and make a sale',
              done: false,
              href: `/c/${companySlug}/pos`,
            },
          ])
        }
      } finally {
        setLoading(false)
      }
    })()
  }, [companySlug])

  if (loading) return null
  const remaining = steps.filter((s) => !s.done)
  if (remaining.length === 0) return null

  return (
    <div className="mb-4 border border-teal-200 bg-teal-50 rounded-lg p-4">
      <h2 className="font-semibold text-teal-900">Get started (&lt; 10 minutes)</h2>
      <ul className="mt-2 space-y-1 text-sm">
        {steps.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span>{s.done ? '✓' : '○'}</span>
            {s.href && !s.done ? (
              <Link href={s.href} className="text-teal-800 underline">
                {s.label}
              </Link>
            ) : (
              <span className={s.done ? 'text-teal-700' : 'text-teal-900'}>{s.label}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
