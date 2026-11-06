'use client'

import React from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface WizardStep {
  id: string
  title: string
  description?: string
  icon?: React.ReactNode
}

export interface FormWizardProps {
  steps: WizardStep[]
  activeStep: number
  onStepClick?: (stepIndex: number) => void
  className?: string
}

export function FormWizard({ steps, activeStep, onStepClick, className }: FormWizardProps) {
  return (
    <div className={cn('w-full py-4', className)}>
      <nav aria-label="Progress">
        <ol className="flex items-center justify-between w-full">
          {steps.map((step, idx) => {
            const isCompleted = idx < activeStep
            const isCurrent = idx === activeStep
            const isClickable = !!onStepClick && isCompleted

            return (
              <li
                key={step.id}
                className={cn(
                  'relative flex-1 flex flex-col items-center group',
                  idx !== steps.length - 1 && 'after:content-[""] after:w-full after:h-0.5 after:border-b after:border-slate-200 dark:after:border-slate-700 after:inline-block after:absolute after:top-5 after:left-1/2'
                )}
              >
                <button
                  type="button"
                  disabled={!isClickable}
                  onClick={() => isClickable && onStepClick(idx)}
                  className={cn(
                    'z-10 w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all duration-200',
                    isCompleted
                      ? 'theme-btn-primary shadow-sm'
                      : isCurrent
                      ? 'border-2 theme-border-primary theme-text-primary bg-white dark:bg-slate-900 shadow-md ring-4 ring-primary/20'
                      : 'border-2 border-slate-200 dark:border-slate-700 text-slate-400 bg-slate-50 dark:bg-slate-800'
                  )}
                >
                  {isCompleted ? <Check size={18} strokeWidth={2.5} /> : step.icon || idx + 1}
                </button>
                <div className="mt-2 text-center">
                  <p
                    className={cn(
                      'text-xs font-semibold tracking-tight',
                      isCurrent
                        ? 'theme-text-primary font-bold'
                        : isCompleted
                        ? 'text-slate-800 dark:text-slate-200'
                        : 'text-slate-400 dark:text-slate-500'
                    )}
                  >
                    {step.title}
                  </p>
                  {step.description && (
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 hidden sm:block">
                      {step.description}
                    </p>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      </nav>
    </div>
  )
}

