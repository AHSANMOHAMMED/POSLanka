'use client'

import { useRouter, useParams } from 'next/navigation'
import { useEffect } from 'react'

// Dealership module landing page - redirect to vehicle inventory
export default function DealershipPage() {
  const router = useRouter()
  const params = useParams()
  const slug = params.slug as string

  useEffect(() => {
    router.replace(`/c/${slug}/dealership/inventory`)
  }, [router, slug])

  return null
}
