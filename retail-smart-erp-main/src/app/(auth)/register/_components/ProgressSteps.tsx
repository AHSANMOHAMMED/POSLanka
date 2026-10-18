'use client'

import { Check } from 'lucide-react'

interface ProgressStepsProps {
  steps: string[]
  currentStep: number
}

export function ProgressSteps({ steps, currentStep }: ProgressStepsProps) {
  return (
    <div className="flex items-center justify-center gap-0 mb-6">
      {steps.map((label, index) => (
        <div key={label} className="flex items-center">
          <div className="flex flex-col items-center">
            <div
              className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                index < currentStep
                  ? 'bg-gradient-to-br from-emerald-600 to-emerald-500 text-white shadow-lg shadow-emerald-600/25'
                  : index === currentStep
                  ? 'bg-gradient-to-br from-emerald-600 to-emerald-500 text-white ring-4 ring-emerald-500/20 shadow-lg shadow-emerald-600/25'
                  : 'bg-white/10 text-zinc-500 border border-white/10'
              }`}
            >
              {index < currentStep ? <Check size={14} strokeWidth={3} /> : index + 1}
            </div>
            <span
              className={`text-[10px] mt-1.5 font-semibold whitespace-nowrap ${
                index <= currentStep
                  ? 'text-emerald-400'
                  : 'text-zinc-500'
              }`}
            >
              {label}
            </span>
          </div>
          {index < steps.length - 1 && (
            <div
              className={`w-8 sm:w-12 h-1 mx-1 mt-[-14px] rounded-full transition-all ${
                index < currentStep
                  ? 'bg-gradient-to-r from-emerald-600 to-emerald-500'
                  : 'bg-zinc-700'
              }`}
            />
          )}
        </div>
      ))}
    </div>
  )
}
