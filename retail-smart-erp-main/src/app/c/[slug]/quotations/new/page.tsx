'use client'

import { useParams } from 'next/navigation'
import { QuotationStudio } from '@/components/quotations/QuotationStudio'

export default function NewQuotationStudioPage() {
  const params = useParams()
  return <QuotationStudio slug={params.slug as string} />
}
