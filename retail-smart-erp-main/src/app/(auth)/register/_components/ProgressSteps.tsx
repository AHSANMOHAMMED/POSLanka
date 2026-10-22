'use client'

import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ProgressStepsProps {
  steps: string[]
  currentStep: number
}

export function ProgressSteps({ steps, currentStep }: ProgressStepsProps) {
  return (
    <ol className="mb-7 flex items-center" aria-label={`Step ${currentStep + 1} of ${steps.length}`}>
      {steps.map((label, index) => {
        const done = index < currentStep
        const current = index === currentStep
        return (
          <li key={label} className={cn('flex items-center', index < steps.length - 1 && 'flex-1')} aria-current={current ? 'step' : undefined}>
            <span className="flex flex-col items-center gap-1.5">
              <span
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-semibold transition-colors',
                  done && 'bg-adm-primary text-adm-primary-fg',
                  current && 'bg-adm-primary text-adm-primary-fg ring-4 ring-[var(--adm-ring)]',
                  !done && !current && 'border border-adm-border-strong bg-adm-surface text-adm-subtle'
                )}
              >
                {done ? <Check size={14} strokeWidth={3} aria-hidden /> : index + 1}
              </span>
              <span className={cn('whitespace-nowrap text-[11.5px] font-medium', done || current ? 'text-adm-fg' : 'text-adm-subtle')}>{label}</span>
            </span>
            {index < steps.length - 1 && (
              <span aria-hidden className={cn('mx-2 mb-5 h-0.5 flex-1 rounded-full', done ? 'bg-adm-primary' : 'bg-adm-border')} />
            )}
          </li>
        )
      })}
    </ol>
  )
}
