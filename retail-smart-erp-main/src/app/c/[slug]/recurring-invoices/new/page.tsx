'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { RecurringInvoiceForm } from '@/components/recurring-invoices/RecurringInvoiceForm'

export default function NewRecurringInvoicePage() {
  const slug = useParams().slug as string
  return (
    <div className="space-y-3 max-w-6xl">
      <Link href={`/c/${slug}/recurring-invoices`} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"><ChevronLeft size={14} /> Recurring invoices</Link>
      <h1 className="text-lg font-semibold text-gray-900 dark:text-white">New recurring invoice</h1>
      <RecurringInvoiceForm slug={slug} />
    </div>
  )
}
