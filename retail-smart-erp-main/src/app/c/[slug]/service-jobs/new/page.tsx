'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { ServiceJobForm } from '@/components/service-jobs/ServiceJobForm'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { serviceJobTerms } from '@/lib/service-jobs/constants'

export default function NewServiceJobPage() {
  const params = useParams()
  const slug = params.slug as string
  const { businessType } = useCompany()
  const terms = serviceJobTerms(businessType)
  return (
    <div className="max-w-6xl mx-auto space-y-3">
      <div className="flex items-center gap-2">
        <Link href={`/c/${slug}/service-jobs`} className="flex items-center text-sm text-gray-500 hover:text-blue-600"><ChevronLeft size={16} /> {terms.many}</Link>
      </div>
      <h1 className="text-lg font-semibold text-gray-900 dark:text-white">New {terms.one.toLowerCase()}</h1>
      <ServiceJobForm slug={slug} />
    </div>
  )
}
