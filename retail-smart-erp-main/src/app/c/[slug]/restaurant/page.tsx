'use client'

import { useRouter, useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useEffect } from 'react'

// Restaurant module landing page - redirect based on role
export default function RestaurantPage() {
  const router = useRouter()
  const params = useParams()
  const { data: session } = useSession()
  const slug = params.slug as string
  const role = session?.user?.role

  useEffect(() => {
    if (!role) return
    if (role === 'chef') {
      router.replace(`/c/${slug}/restaurant/kitchen`)
    } else {
      router.replace(`/c/${slug}/restaurant/orders`)
    }
  }, [router, slug, role])

  return null
}
