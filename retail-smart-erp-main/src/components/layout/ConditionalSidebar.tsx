'use client'

import { ModuleSidebar } from '@/components/layout/ModuleSidebar'

interface ConditionalSidebarProps {
  companySlug: string
}

export function ConditionalSidebar({ companySlug }: ConditionalSidebarProps) {
  return <ModuleSidebar companySlug={companySlug} />
}
