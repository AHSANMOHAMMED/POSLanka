import type { Metadata } from 'next'
import LoginClient from './LoginClient'

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to POSLanka with your Business ID, or to your owner account to manage your companies.',
  openGraph: {
    title: 'Sign in | POSLanka',
    description: 'Sign in to your POSLanka point of sale and back office.',
    images: [{ url: '/og/home', width: 1200, height: 630 }],
  },
}

export default function LoginPage() {
  return <LoginClient />
}
