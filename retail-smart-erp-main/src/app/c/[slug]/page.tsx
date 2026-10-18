'use client'

import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'

export default function CompanyIndexPage() {
  const params = useParams()
  const router = useRouter()
  const slug = params.slug as string

  useEffect(() => {
    router.replace(`/c/${slug}/dashboard`)
  }, [router, slug])

  return null
}
