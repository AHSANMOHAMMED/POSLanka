'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { PrintJobForm } from '@/components/print-jobs/PrintJobForm'

export default function NewPrintJobPage() {
  const params = useParams()
  const slug = params.slug as string
  return (
    <div className="max-w-6xl mx-auto space-y-3">
      <div className="flex items-center gap-2">
        <Link href={`/c/${slug}/print-jobs`} className="flex items-center text-sm text-gray-500 hover:text-blue-600"><ChevronLeft size={16} /> Print jobs</Link>
      </div>
      <h1 className="text-lg font-semibold text-gray-900 dark:text-white">New print job</h1>
      <PrintJobForm slug={slug} />
    </div>
  )
}
