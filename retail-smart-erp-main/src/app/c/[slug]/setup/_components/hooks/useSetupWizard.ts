'use client'

import { useState, useCallback } from 'react'
import type { ServiceGroupSeed } from '@/lib/setup/seed-data'

interface CompanyInfo {
  id: string
  name: string
  businessType: string
  currency: string
  country: string
  countryName: string
  setupCompleted: boolean
  aiEnabled: boolean
  logoUrl?: string
}

// WizardData should match SetupWizardData from create-seed-data.ts
interface WizardData {
  // Step 1: Business Profile
  taxRate?: number
  taxInclusive?: boolean
  logoUrl?: string
  timezone?: string
  coaTemplate: 'numbered' | 'unnumbered'
  fiscalYearStart?: string
  fiscalYearEnd?: string
  fiscalYearName?: string

  // Step 2: Business-type specific
  selectedCategories: string[]
  // Restaurant specific
  numberOfTables?: number
  tableAreas?: string[]
  // Auto service specific
  selectedServiceGroups?: ServiceGroupSeed[]
  defaultLaborRate?: number

  // Step 3: Warehouses (multiple)
  warehouses?: Array<{
    name: string
    code: string
    address?: string
    phone?: string
    email?: string
    isDefault: boolean
  }>
  // Backward compat: single warehouse name
  warehouseName?: string

  // Step 4: Cost Centers & Accounting
  costCenters?: string[]
  defaultCostCenter?: string        // Name of the cost center to mark as default
  bankAccounts?: Array<{
    accountName: string
    bankName?: string
    accountNumber?: string
    branchCode?: string
    isDefault: boolean
  }>
  accountOverrides?: Record<string, string> // Maps setting key to account number (overrides SYSTEM_ACCOUNT_DEFAULTS)

  // Step 5: POS & Payments
  paymentMethods: string[]
  posProfileName: string
  receiptFormat: string
  posWarehouseName?: string          // Selected warehouse for POS profile
  posCostCenter?: string             // Selected cost center for POS profile

  // Step 6: Users & Permissions
  users?: Array<{
    email: string
    role: string
    sendInvite: boolean
  }>

  // Step 7: Email Configuration
  emailConfig?: {
    smtpServer: string
    smtpPort: number
    smtpUsername: string
    smtpPassword: string
    useSSL: boolean
    fromEmail: string
  }
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

export function useSetupWizard(companySlug: string) {
  const [wizardData, setWizardData] = useState<WizardData>({
    selectedCategories: [],
    coaTemplate: 'numbered',
    paymentMethods: ['cash'],
    posProfileName: 'Default POS',
    receiptFormat: '80mm'
  })
  const [isCompleting, setIsCompleting] = useState(false)
  const [isCompleted, setIsCompleted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo | null>(null)

  // Update wizard data with partial updates (for child components)
  const updateWizardData = useCallback((updates: Partial<WizardData>) => {
    setWizardData(prev => ({
      ...prev,
      ...updates
    }))
  }, [])

  // Load company info and setup progress. Returns the last completed step index (-1 if none).
  const loadProgress = useCallback(async (): Promise<number> => {
    try {
      // Fetch company info
      const companyRes = await fetch(`/api/c/${companySlug}/info`)
      if (!companyRes.ok) throw new Error('Failed to load company info')
      const companyData = await companyRes.json()
      setCompanyInfo({
        id: companyData.id,
        name: companyData.name,
        businessType: companyData.businessType || 'retail',
        currency: companyData.currency || 'LKR',
        country: companyData.country || '',
        countryName: companyData.countryName || '',
        setupCompleted: !!companyData.setupCompletedAt,
        aiEnabled: !!companyData.aiEnabled
      })

      // Fetch saved setup progress
      const progressRes = await fetch(`/api/c/${companySlug}/setup/progress`)
      if (progressRes.ok) {
        const progressData = await progressRes.json()
        if (progressData.data) {
          setWizardData(prev => ({
            ...prev,
            ...progressData.data
          }))
        }
        return progressData.currentStep ?? -1
      }
      return -1
    } catch (err) {
      console.error('Failed to load setup progress:', err)
      throw err
    }
  }, [companySlug])

  // Save step data to backend
  const saveStep = useCallback(async (stepIndex: number, data: WizardData, completed = true) => {
    try {
      const response = await fetch(`/api/c/${companySlug}/setup/step/${stepIndex}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data, completed })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to save step')
      }

      return await response.json()
    } catch (err) {
      console.error('Failed to save step:', err)
      setError(err instanceof Error ? err.message : 'Failed to save step')
      throw err
    }
  }, [companySlug])

  // Reset setup progress
  const resetSetup = useCallback(async () => {
    try {
      const response = await fetch(`/api/c/${companySlug}/setup/reset`, {
        method: 'DELETE'
      })

      if (!response.ok) {
        throw new Error('Failed to reset setup')
      }

      setWizardData({
        selectedCategories: [],
        coaTemplate: 'numbered',
        paymentMethods: ['cash'],
        posProfileName: 'Default POS',
        receiptFormat: '80mm'
      })
      setIsCompleted(false)
      setError(null)
      
      return await response.json()
    } catch (err) {
      console.error('Failed to reset setup:', err)
      setError(err instanceof Error ? err.message : 'Failed to reset setup')
      throw err
    }
  }, [companySlug])

  // Complete setup (final step)
  const completeSetup = useCallback(async () => {
    setIsCompleting(true)
    setError(null)
    
    try {
      const response = await fetch(`/api/c/${companySlug}/setup/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(wizardData)
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Setup failed')
      }

      const result = await response.json()
      if (result.failedInvites?.length > 0) {
        setError(`Setup complete, but invitation emails failed for: ${result.failedInvites.join(', ')}. You can resend invitations from Settings.`)
      }
      setIsCompleted(true)
      return result
    } catch (err) {
      console.error('Setup completion failed:', err)
      setError(err instanceof Error ? err.message : 'Setup failed')
      throw err
    } finally {
      setIsCompleting(false)
    }
  }, [companySlug, wizardData])

  return {
    wizardData,
    updateWizardData,
    setWizardData,
    saveStep,
    loadProgress,
    resetSetup,
    completeSetup,
    isCompleting,
    isCompleted,
    error,
    setError,
    companyInfo
  }
}