'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { ProjectForm } from '@/components/projects/ProjectForm'

export default function NewProjectPage() {
  const slug = useParams().slug as string
  return (
    <div className="space-y-3 max-w-6xl">
      <Link href={`/c/${slug}/projects`} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"><ChevronLeft size={14} /> Projects</Link>
      <h1 className="text-lg font-semibold text-gray-900 dark:text-white">New project</h1>
      <ProjectForm slug={slug} />
    </div>
  )
}
