'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { StepRail } from './StepRail'
import { StepBusinessProfile } from './StepBusinessProfile'
import { StepBusinessConfig } from './StepBusinessConfig'
import { StepWarehouses } from './StepWarehouses'
import { StepAccounting } from './StepAccounting'
import { StepPOS } from './StepPOS'
import { StepUsers } from './StepUsers'
import { StepReview } from './StepReview'
import { AIAssistantPanel } from './AIAssistantPanel'
import { Confetti } from './Confetti'
import { useSetupWizard } from './hooks/useSetupWizard'
import { useSetupSound } from './hooks/useSetupSound'
import { Loader2, Volume2, VolumeX, Sparkles, CheckCircle, RotateCcw, ArrowLeft, ArrowRight, Save } from 'lucide-react'

interface SetupWizardProps {
  companySlug: string
}

const stepVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 200 : -200,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -200 : 200,
    opacity: 0,
  }),
}

export function SetupWizard({ companySlug }: SetupWizardProps) {
  const [currentStep, setCurrentStep] = useState(0)
  const [direction, setDirection] = useState(1)
  const [isLoading, setIsLoading] = useState(true)
  const [showAI, setShowAI] = useState(false)

  const {
    wizardData,
    updateWizardData,
    saveStep,
    loadProgress,
    resetSetup,
    completeSetup,
    isCompleting,
    isCompleted,
    error,
    setError,
    companyInfo
  } = useSetupWizard(companySlug)

  const { playClick, playStepComplete, playSetupComplete, isMuted, toggleMute } = useSetupSound()

  const steps = [
    { id: 'business', label: 'Business Profile', title: 'Business Profile' },
    { id: 'categories', label: 'Categories', title: 'Categories & Services' },
    { id: 'warehouses', label: 'Warehouses', title: 'Warehouses' },
    { id: 'accounting', label: 'Accounting', title: 'Cost Centers & Bank Accounts' },
    { id: 'pos', label: 'POS & Payments', title: 'POS & Payments' },
    { id: 'users', label: 'Users', title: 'Users & Permissions' },
    { id: 'review', label: 'Review', title: 'Review & Setup' },
  ]

  // Redirect after completion
  useEffect(() => {
    if (isCompleted) {
      playSetupComplete()
      const timer = setTimeout(() => {
        window.location.href = `/c/${companySlug}/dashboard`
      }, 3000)
      return () => clearTimeout(timer)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCompleted, companySlug])

  // Load progress on mount
  useEffect(() => {
    let isMounted = true

    const initialize = async () => {
      setIsLoading(true)
      try {
        const restoredStep = await loadProgress()
        // Resume from the step after the last completed one
        if (isMounted && restoredStep >= 0) {
          setCurrentStep(Math.min(restoredStep + 1, 6))
        }
      } catch (err) {
        console.error('Failed to load setup progress:', err)
        if (isMounted) {
          setError('Failed to load setup progress. Please refresh the page.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    initialize()
    return () => { isMounted = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companySlug])

  const validateCurrentStep = useCallback(async (): Promise<boolean> => {
    setError(null)

    switch (currentStep) {
      case 0: // Business Profile
        if (!wizardData.fiscalYearStart) {
          setError('Fiscal year start date is required.')
          return false
        }
        break
      case 2: // Warehouses
        if (!wizardData.warehouses || wizardData.warehouses.length === 0 || !wizardData.warehouses.some(w => w.name.trim())) {
          setError('At least one warehouse with a name is required.')
          return false
        }
        break
      case 3: // Accounting
        if (!wizardData.costCenters || wizardData.costCenters.length === 0 || !wizardData.costCenters.some(c => c.trim())) {
          setError('At least one cost center with a name is required.')
          return false
        }
        break
      case 5: { // Users
        const users = wizardData.users || []
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        const invalidUser = users.find(u => u.email && !emailRegex.test(u.email))
        if (invalidUser) {
          setError(`Invalid email address: ${invalidUser.email}`)
          return false
        }
        break
      }
    }

    return true
  }, [currentStep, wizardData, setError])

  const handleNext = useCallback(async () => {
    if (currentStep >= steps.length - 1) return

    const isValid = await validateCurrentStep()
    if (!isValid) return

    await saveStep(currentStep, wizardData)
    playStepComplete()
    setDirection(1)
    setCurrentStep((prev) => prev + 1)
  }, [currentStep, steps.length, validateCurrentStep, saveStep, wizardData, playStepComplete])

  const handleBack = useCallback(() => {
    if (currentStep <= 0) return
    playClick()
    setDirection(-1)
    setCurrentStep((prev) => prev - 1)
  }, [currentStep, playClick])

  const handleStepClick = useCallback(async (stepIndex: number) => {
    if (stepIndex > currentStep + 1) return

    if (stepIndex > currentStep) {
      const isValid = await validateCurrentStep()
      if (!isValid) return
      await saveStep(currentStep, wizardData)
      playStepComplete()
    } else {
      playClick()
    }

    setDirection(stepIndex > currentStep ? 1 : -1)
    setCurrentStep(stepIndex)
  }, [currentStep, validateCurrentStep, saveStep, wizardData, playStepComplete, playClick])

  const handleCompleteSetup = useCallback(async () => {
    try {
      await saveStep(currentStep, wizardData)
      await completeSetup()
    } catch {
      // Error is already set in useSetupWizard
    }
  }, [currentStep, saveStep, wizardData, completeSetup])

  const handleReset = useCallback(async () => {
    if (confirm('Are you sure you want to reset the setup? All progress will be lost.')) {
      await resetSetup()
      setCurrentStep(0)
      setError(null)
    }
  }, [resetSetup, setError])

  const isReviewStep = currentStep === steps.length - 1

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <StepBusinessProfile
            data={wizardData}
            currency={companyInfo?.currency || 'LKR'}
            country={companyInfo?.country || ''}
            countryName={companyInfo?.countryName || ''}
            businessType={companyInfo?.businessType || 'retail'}
            companySlug={companySlug}
            aiEnabled={companyInfo?.aiEnabled}
            onChange={updateWizardData}
          />
        )
      case 1:
        return (
          <StepBusinessConfig
            data={wizardData}
            businessType={companyInfo?.businessType || 'retail'}
            companySlug={companySlug}
            country={companyInfo?.country || ''}
            countryName={companyInfo?.countryName || ''}
            currency={companyInfo?.currency || 'LKR'}
            aiEnabled={companyInfo?.aiEnabled}
            onChange={updateWizardData}
          />
        )
      case 2:
        return (
          <StepWarehouses
            data={wizardData}
            companySlug={companySlug}
            businessType={companyInfo?.businessType || 'retail'}
            country={companyInfo?.country || ''}
            countryName={companyInfo?.countryName || ''}
            currency={companyInfo?.currency || 'LKR'}
            companyName={companyInfo?.name || 'Your Company'}
            aiEnabled={companyInfo?.aiEnabled}
            onChange={updateWizardData}
          />
        )
      case 3:
        return (
          <StepAccounting
            data={wizardData}
            companySlug={companySlug}
            businessType={companyInfo?.businessType || 'retail'}
            country={companyInfo?.country || ''}
            countryName={companyInfo?.countryName || ''}
            currency={companyInfo?.currency || 'LKR'}
            companyName={companyInfo?.name || 'Your Company'}
            aiEnabled={companyInfo?.aiEnabled}
            onChange={updateWizardData}
          />
        )
      case 4:
        return (
          <StepPOS
            data={wizardData}
            companySlug={companySlug}
            businessType={companyInfo?.businessType || 'retail'}
            country={companyInfo?.country || ''}
            countryName={companyInfo?.countryName || ''}
            currency={companyInfo?.currency || 'LKR'}
            aiEnabled={companyInfo?.aiEnabled}
            onChange={updateWizardData}
          />
        )
      case 5:
        return (
          <StepUsers
            data={wizardData}
            onChange={updateWizardData}
          />
        )
      case 6:
        return (
          <StepReview
            data={wizardData}
            companyInfo={companyInfo}
          />
        )
      default:
        return null
    }
  }

  // Full-page loading
  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-900">
        <div className="text-center">
          <Loader2 className="h-10 w-10 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">Loading setup wizard...</p>
        </div>
      </div>
    )
  }

  // Completion overlay
  if (isCompleted) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-gradient-to-br from-gray-50 via-white to-green-50/40 dark:from-slate-900 dark:via-slate-900 dark:to-emerald-950/20 relative overflow-hidden">
        <Confetti active={true} />
        <motion.div
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 15 }}
          className="w-24 h-24 bg-gradient-to-br from-green-100 to-emerald-100 dark:from-green-900/30 dark:to-emerald-900/20 rounded-3xl flex items-center justify-center mb-8 shadow-lg shadow-green-500/10"
        >
          <CheckCircle size={48} className="text-green-600 dark:text-green-400" />
        </motion.div>
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="text-3xl font-bold text-gray-900 dark:text-white mb-3 tracking-tight"
        >
          Your company is ready!
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="text-gray-400 dark:text-gray-500 text-sm"
        >
          Redirecting to your dashboard...
        </motion.p>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-gray-50 via-slate-50 to-blue-50/30 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800 overflow-hidden">
      {/* Header */}
      <header className="h-16 flex-shrink-0 border-b border-gray-200/60 dark:border-gray-700/50 bg-white/70 dark:bg-slate-800/70 backdrop-blur-md px-4 lg:px-8 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          {companyInfo?.logoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={companyInfo.logoUrl} alt="" className="h-9 w-9 rounded-lg object-contain flex-shrink-0 ring-1 ring-gray-200 dark:ring-gray-700" />
          ) : (
            <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center flex-shrink-0">
              <span className="text-white text-sm font-bold">{(companyInfo?.name || 'C')[0]}</span>
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-gray-900 dark:text-white truncate tracking-tight">
              {companyInfo?.name || 'Your Company'}
            </h1>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 hidden sm:block">
              Company Setup Wizard
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {companyInfo?.aiEnabled && (
            <button
              onClick={() => setShowAI(!showAI)}
              className={`p-2 rounded-lg transition-all duration-200 ${
                showAI
                  ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 shadow-sm'
                  : 'text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-slate-700'
              }`}
              title={showAI ? 'Close AI Assistant' : 'AI Assistant'}
            >
              <Sparkles size={16} />
            </button>
          )}
          <button
            onClick={toggleMute}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 transition-all duration-200"
            title={isMuted ? 'Unmute sounds' : 'Mute sounds'}
          >
            {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <button
            onClick={handleReset}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 transition-all duration-200"
            title="Reset setup"
          >
            <RotateCcw size={14} />
          </button>
        </div>
      </header>

      {/* Mobile progress */}
      <div className="lg:hidden border-b border-gray-200/60 dark:border-gray-700/50 bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm">
        <StepRail steps={steps} currentStep={currentStep} onStepClick={handleStepClick} />
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Desktop step rail */}
        <aside className="hidden lg:flex flex-col w-64 flex-shrink-0 border-r border-gray-200/60 dark:border-gray-700/50 bg-gradient-to-b from-white via-white to-slate-50/80 dark:from-slate-800 dark:via-slate-800/90 dark:to-slate-900 p-5 pt-8 overflow-y-auto">
          <StepRail steps={steps} currentStep={currentStep} onStepClick={handleStepClick} />
        </aside>

        {/* Step content with transitions */}
        <main className="flex-1 overflow-hidden relative">
          {/* Error banner */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -40 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -40 }}
                className="absolute top-0 left-0 right-0 z-20 mx-4 lg:mx-8 mt-4"
              >
                <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300 shadow-sm">
                  {error}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Step content */}
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={currentStep}
              custom={direction}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
              className="absolute inset-0 overflow-y-auto p-4 lg:p-8 lg:pb-4"
            >
              <div className="max-w-3xl mx-auto">
                {renderStepContent()}
              </div>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Footer */}
      <footer className="h-[72px] flex-shrink-0 border-t border-gray-200/60 dark:border-gray-700/50 bg-white/70 dark:bg-slate-800/70 backdrop-blur-md px-4 lg:px-8 flex items-center justify-between">
        <button
          onClick={handleBack}
          disabled={currentStep === 0 || isCompleting}
          className="flex items-center gap-2 px-5 py-2.5 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 hover:border-gray-300 transition-all duration-200 font-medium text-sm disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ArrowLeft size={15} />
          Back
        </button>

        {isReviewStep ? (
          <button
            onClick={handleCompleteSetup}
            disabled={isCompleting}
            className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-lg hover:from-green-700 hover:to-emerald-700 transition-all duration-200 font-semibold text-sm shadow-sm shadow-green-500/20 disabled:opacity-60 disabled:cursor-not-allowed disabled:shadow-none"
          >
            {isCompleting ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                Setting Up...
              </>
            ) : (
              <>
                <Save size={15} />
                Complete Setup
              </>
            )}
          </button>
        ) : (
          <button
            onClick={handleNext}
            disabled={isCompleting}
            className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg hover:from-blue-700 hover:to-blue-800 transition-all duration-200 font-semibold text-sm shadow-sm shadow-blue-500/20 disabled:opacity-60 disabled:cursor-not-allowed disabled:shadow-none"
          >
            Continue
            <ArrowRight size={15} />
          </button>
        )}
      </footer>

      {/* AI Assistant Panel */}
      {showAI && companyInfo?.aiEnabled && (
        <AIAssistantPanel
          companySlug={companySlug}
          currentStep={steps[currentStep]?.label || ''}
          context={{
            businessType: companyInfo?.businessType,
            country: companyInfo?.country,
            countryName: companyInfo?.countryName,
            currency: companyInfo?.currency,
            companyName: companyInfo?.name,
          }}
        />
      )}
    </div>
  )
}
