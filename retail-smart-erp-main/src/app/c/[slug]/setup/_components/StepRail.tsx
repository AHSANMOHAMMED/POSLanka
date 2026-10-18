'use client'

import { motion } from 'framer-motion'
import { Check } from 'lucide-react'

interface Step {
  id: string
  label: string
  title: string
}

interface StepRailProps {
  steps: Step[]
  currentStep: number
  onStepClick: (stepIndex: number) => void
}

export function StepRail({ steps, currentStep, onStepClick }: StepRailProps) {
  return (
    <>
      {/* Desktop: Vertical Rail */}
      <nav className="hidden lg:flex flex-col gap-0" aria-label="Setup steps">
        {steps.map((step, index) => {
          const isCompleted = index < currentStep
          const isCurrent = index === currentStep
          const isClickable = index <= currentStep + 1

          return (
            <div key={step.id} className="relative flex items-start gap-3.5">
              {/* Connecting line */}
              {index < steps.length - 1 && (
                <div
                  className="absolute left-[18px] top-[42px] w-[2px] rounded-full bg-gray-200/80 dark:bg-gray-700/60"
                  style={{ height: 'calc(100% - 12px)' }}
                >
                  <motion.div
                    className="w-full rounded-full bg-gradient-to-b from-green-500 to-emerald-500"
                    initial={{ height: 0 }}
                    animate={{ height: isCompleted ? '100%' : '0%' }}
                    transition={{ duration: 0.5, delay: 0.2 }}
                  />
                </div>
              )}

              {/* Step indicator */}
              <button
                type="button"
                onClick={() => isClickable && onStepClick(index)}
                disabled={!isClickable}
                className={`relative z-10 w-[38px] h-[38px] rounded-xl flex items-center justify-center text-xs font-bold transition-all duration-300 flex-shrink-0 ${
                  isCompleted
                    ? 'bg-gradient-to-br from-green-500 to-emerald-500 text-white shadow-sm shadow-green-500/20 hover:shadow-md hover:shadow-green-500/30'
                    : isCurrent
                    ? 'bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-md shadow-blue-500/25 ring-[3px] ring-blue-100 dark:ring-blue-900/50'
                    : isClickable
                    ? 'bg-gray-100 dark:bg-gray-700/80 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 cursor-pointer'
                    : 'bg-gray-100/60 dark:bg-gray-800/50 text-gray-300 dark:text-gray-600 cursor-not-allowed'
                }`}
              >
                {isCompleted ? (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                  >
                    <Check size={15} strokeWidth={2.5} />
                  </motion.span>
                ) : (
                  index + 1
                )}
              </button>

              {/* Label */}
              <div className="pt-1.5 pb-5 min-w-0">
                <p
                  className={`text-[13px] font-medium truncate transition-colors ${
                    isCurrent
                      ? 'text-gray-900 dark:text-white'
                      : isCompleted
                      ? 'text-gray-700 dark:text-gray-300'
                      : 'text-gray-400 dark:text-gray-500'
                  }`}
                >
                  {step.label}
                </p>
                {isCurrent && (
                  <motion.p
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-[11px] text-blue-500 dark:text-blue-400 mt-0.5 font-medium"
                  >
                    {step.title}
                  </motion.p>
                )}
              </div>
            </div>
          )
        })}
      </nav>

      {/* Mobile: Progress bar */}
      <div className="lg:hidden px-4 py-3">
        <div className="flex items-center justify-between mb-2.5">
          <div>
            <span className="text-[11px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
              Step {currentStep + 1} of {steps.length}
            </span>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mt-0.5">
              {steps[currentStep]?.title}
            </h3>
          </div>
        </div>
        {/* Segmented progress */}
        <div className="flex gap-1">
          {steps.map((_, index) => (
            <div key={index} className="flex-1 h-1.5 rounded-full overflow-hidden bg-gray-200/60 dark:bg-gray-700/40">
              <motion.div
                className={`h-full rounded-full ${
                  index < currentStep
                    ? 'bg-gradient-to-r from-green-500 to-emerald-500'
                    : index === currentStep
                    ? 'bg-gradient-to-r from-blue-500 to-blue-600'
                    : ''
                }`}
                initial={false}
                animate={{ width: index <= currentStep ? '100%' : '0%' }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
              />
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
