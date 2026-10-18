'use client'

import { useState, useEffect, useRef } from 'react'
import { Check, Loader2, PartyPopper, RotateCcw, ArrowLeft } from 'lucide-react'
import type { SetupWizardData } from '@/lib/setup/create-seed-data'

interface StepCompletionProps {
  completing: boolean
  completed: boolean
  error?: string | null
  wizardData: SetupWizardData
  businessType: string
  onGoToDashboard: () => void
  onRetry?: () => void
  onBack?: () => void
}

interface ProgressStep {
  label: string
  done: boolean
}

export function StepCompletion({ completing, completed, error, wizardData, businessType, onGoToDashboard, onRetry, onBack }: StepCompletionProps) {
  const [progressSteps, setProgressSteps] = useState<ProgressStep[]>([])
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const [stepDefinitions, setStepDefinitions] = useState<ProgressStep[]>([])

  // Build step definitions only when wizardData or businessType changes
  // This prevents recreation during animation
  useEffect(() => {
    const steps: ProgressStep[] = []

    // Warehouses
    const warehouseCount = wizardData.warehouses?.length || 1
    steps.push({ label: `Creating ${warehouseCount > 1 ? `${warehouseCount} warehouses` : 'default warehouse'}...`, done: false })

    // Categories
    if ((wizardData.selectedCategories || []).length > 0) {
      steps.push({ label: 'Adding categories...', done: false })
    }

    // POS
    steps.push({ label: 'Setting up POS profile...', done: false })
    steps.push({ label: 'Configuring payment methods...', done: false })

    // Business-type specific
    if (businessType === 'restaurant' && wizardData.numberOfTables) {
      steps.push({ label: 'Creating restaurant tables...', done: false })
    }

    if (businessType === 'auto_service') {
      if (wizardData.selectedServiceGroups?.length) {
        steps.push({ label: 'Setting up service types...', done: false })
      }
      steps.push({ label: 'Seeding vehicle data...', done: false })
      steps.push({ label: 'Creating inspection templates...', done: false })
    }

    if (businessType === 'dealership') {
      steps.push({ label: 'Seeding vehicle data...', done: false })
    }

    // Accounting
    steps.push({ label: 'Setting up chart of accounts...', done: false })

    if (wizardData.fiscalYearStart && wizardData.fiscalYearEnd) {
      steps.push({ label: 'Creating fiscal year...', done: false })
    }

    if (wizardData.costCenters && wizardData.costCenters.length > 0) {
      steps.push({ label: `Creating ${wizardData.costCenters.length} cost center${wizardData.costCenters.length > 1 ? 's' : ''}...`, done: false })
    }

    if (wizardData.defaultCostCenter) {
      steps.push({ label: `Setting default cost center: ${wizardData.defaultCostCenter}...`, done: false })
    }

    if (wizardData.bankAccounts && wizardData.bankAccounts.length > 0) {
      steps.push({ label: `Creating ${wizardData.bankAccounts.length} bank account${wizardData.bankAccounts.length > 1 ? 's' : ''}...`, done: false })
    }

    // Documents
    steps.push({ label: 'Generating letter head...', done: false })
    steps.push({ label: 'Creating print templates...', done: false })

    // Always
    steps.push({ label: 'Configuring cancellation reasons...', done: false })

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStepDefinitions(steps)
    // Initialize progressSteps with all steps not done
    setProgressSteps(steps.map(step => ({ ...step, done: false })))
  }, [businessType, wizardData])

  // Separate effect for animating steps when completing or completed changes
  useEffect(() => {
    // Clear previous timers
    timersRef.current.forEach(t => clearTimeout(t))
    timersRef.current = []

    if (completing || completed) {
      // If we're starting animation, reset all steps to not done first
      if (completing && !completed) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setProgressSteps(stepDefinitions.map(step => ({ ...step, done: false })))
      }
      
      // Animate through steps
      stepDefinitions.forEach((_, index) => {
        const timer = setTimeout(() => {
          setProgressSteps(prev =>
            prev.map((step, i) => i <= index ? { ...step, done: true } : step)
          )
        }, (index + 1) * 500)
        timersRef.current.push(timer)
      })
      
      // Safety timeout: if still completing after 45 seconds, show error
      const safetyTimer = setTimeout(() => {
        if (completing && !completed && !error) {
          console.error('Setup completion stuck after 45 seconds')
          // This will be caught by the parent component which should handle timeout
        }
      }, 45000)
      timersRef.current.push(safetyTimer)
    } else {
      // If not completing and not completed (API failed or cancelled), reset steps
      setProgressSteps(stepDefinitions.map(step => ({ ...step, done: false })))
    }

    // Cleanup timers on unmount or when completing/completed changes
    return () => {
      timersRef.current.forEach(t => clearTimeout(t))
      timersRef.current = []
    }
  }, [completing, completed, stepDefinitions, error])

  // Error state - show retry and back options
  if (error && !completing && !completed) {
    return (
      <div className="text-center">
        <div className="mb-8">
          <div className="w-20 h-20 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mx-auto mb-4">
            <RotateCcw size={40} className="text-red-600 dark:text-red-400" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            Setup Failed
          </h2>
          <p className="text-gray-500 dark:text-gray-400 mt-2">
            {error}
          </p>
        </div>

        <div className="flex justify-center gap-4">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="px-6 py-2.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors font-medium flex items-center gap-2"
            >
              <ArrowLeft size={16} />
              Go Back
            </button>
          )}
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="px-6 py-2.5 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors font-medium flex items-center gap-2"
            >
              <RotateCcw size={16} />
              Try Again
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="text-center">
      {!completed ? (
        <>
          <div className="mb-8">
            <Loader2 size={48} className="mx-auto text-blue-600 animate-spin mb-4" />
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              Setting up your business...
            </h2>
            <p className="text-gray-500 dark:text-gray-400 mt-1">
              This will only take a moment.
            </p>
          </div>

          <div className="max-w-md mx-auto text-left space-y-3">
            {progressSteps.map((step, index) => (
              <div
                key={`step-${index}-${step.label}`}
                className={`flex items-center gap-3 transition-opacity duration-300 ${
                  step.done ? 'opacity-100' : 'opacity-40'
                }`}
              >
                {step.done ? (
                  <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
                    <Check size={14} className="text-white" />
                  </div>
                ) : (
                  <div className="w-6 h-6 rounded-full border-2 border-gray-300 dark:border-gray-600 flex-shrink-0" />
                )}
                <span className={`text-sm ${step.done ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'}`}>
                  {step.label}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="mb-8">
            <div className="w-20 h-20 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-4">
              <PartyPopper size={40} className="text-green-600 dark:text-green-400" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
              You&apos;re all set!
            </h2>
            <p className="text-gray-500 dark:text-gray-400 mt-2">
              Your business has been configured and is ready to use.
            </p>
          </div>

          <div className="max-w-md mx-auto text-left space-y-2 mb-8">
            {progressSteps.map((step, index) => (
              <div key={`done-${index}-${step.label}`} className="flex items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
                  <Check size={14} className="text-white" />
                </div>
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  {step.label.replace('...', '')}
                </span>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={onGoToDashboard}
            className="px-8 py-3 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors font-medium text-lg"
          >
            Go to Dashboard
          </button>
        </>
      )}
    </div>
  )
}
