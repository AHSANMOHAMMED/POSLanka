'use client'

import { useParams } from 'next/navigation'
import { QuotationStudio } from '@/components/quotations/QuotationStudio'

export default function EditQuotationPage() {
  const params = useParams()
  return <QuotationStudio slug={params.slug as string} editId={params.id as string} />
}
