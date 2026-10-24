import type { Metadata } from 'next'
import LoginClient from './LoginClient'

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to skyERPOS with your Business ID, or to your owner account to manage your companies.',
  openGraph: {
    title: 'Sign in | skyERPOS',
    description: 'Sign in to your skyERPOS point of sale and back office.',
    images: [{ url: '/og/home', width: 1200, height: 630 }],
  },
}

export default function LoginPage() {
  return <LoginClient />
}
