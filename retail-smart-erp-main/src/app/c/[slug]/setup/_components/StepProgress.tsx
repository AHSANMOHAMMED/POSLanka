'use client'

import { Check } from 'lucide-react'

interface Step {
  id: string
  label: string
  title: string
}

interface StepProgressProps {
  steps: Step[]
  currentStep: number
  onStepClick: (stepIndex: number) => void
}

export function StepProgress({ steps, currentStep, onStepClick }: StepProgressProps) {
  return (
    <div className="mb-8">
      {/* Desktop progress bar */}
      <div className="hidden md:flex items-center justify-between">
        {steps.map((step, index) => {
          const isCompleted = index < currentStep
          const isCurrent = index === currentStep
          const isClickable = index <= currentStep + 1

          return (
            <div key={step.id} className="flex items-center flex-1">
              <div className="flex flex-col items-center">
                <button
                  type="button"
                  onClick={() => isClickable && onStepClick(index)}
                  disabled={!isClickable}
                  className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium transition-all ${
                    isCompleted
                      ? 'bg-green-500 text-white hover:bg-green-600'
                      : isCurrent
                      ? 'bg-blue-600 text-white ring-4 ring-blue-100'
                      : 'bg-gray-200 text-gray-500'
                  } ${isClickable ? 'cursor-pointer' : 'cursor-not-allowed'}`}
                >
                  {isCompleted ? <Check size={16} /> : index + 1}
                </button>
                <span
                  className={`text-xs mt-2 font-medium ${
                    isCompleted || isCurrent
                      ? 'text-gray-900'
                      : 'text-gray-500'
                  }`}
                >
                  {step.label}
                </span>
                <span className="text-xs text-gray-500 mt-1">{step.title}</span>
              </div>
              {index < steps.length - 1 && (
                <div
                  className={`flex-1 h-1 mx-4 -mt-5 ${
                    isCompleted ? 'bg-green-500' : 'bg-gray-200'
                  }`}
                />
              )}
            </div>
          )
        })}
      </div>

      {/* Mobile progress indicator */}
      <div className="md:hidden">
        <div className="flex items-center justify-between mb-2">
          <div>
            <span className="text-sm font-medium text-gray-500">
              Step {currentStep + 1} of {steps.length}
            </span>
            <h3 className="text-lg font-semibold text-gray-900">
              {steps[currentStep]?.title}
            </h3>
          </div>
          <div className="text-right">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
              {steps[currentStep]?.label}
            </span>
          </div>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
            style={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
          />
        </div>
        <div className="flex justify-between mt-2 text-xs text-gray-500">
          {steps.map((step, index) => (
            <button
              key={step.id}
              type="button"
              onClick={() => index <= currentStep + 1 && onStepClick(index)}
              disabled={index > currentStep + 1}
              className={`px-1 ${index <= currentStep + 1 ? 'cursor-pointer' : 'cursor-not-allowed'}`}
            >
              {index + 1}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}