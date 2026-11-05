'use client'

import { createContext, useContext, ReactNode } from 'react'

export interface CompanyContext {
  tenantId: string
  tenantSlug: string
  tenantName: string
  businessType: string
  /** 'mall' only: the business types it runs (see useBusinessScope) */
  businessSegments?: string[] | null
  role: string
  isOwner: boolean
  currency: string
  dateFormat: string
  timeFormat: string
}

const CompanyCtx = createContext<CompanyContext | null>(null)

interface CompanyContextProviderProps {
  children: ReactNode
  value: CompanyContext
}

export function CompanyContextProvider({ children, value }: CompanyContextProviderProps) {
  return (
    <CompanyCtx.Provider value={value}>
      {children}
    </CompanyCtx.Provider>
  )
}

export function useCompany(): CompanyContext {
  const context = useContext(CompanyCtx)
  if (!context) {
    throw new Error('useCompany must be used within a CompanyContextProvider')
  }
  return context
}

export function useCompanyOptional(): CompanyContext | null {
  return useContext(CompanyCtx)
}
