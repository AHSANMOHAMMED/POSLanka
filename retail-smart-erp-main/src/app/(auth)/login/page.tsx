import type { Metadata } from 'next'
import LoginClient from './LoginClient'

export const metadata: Metadata = {
  title: 'Sign In - RetailSmart ERP',
  description: 'Sign in to your RetailSmart ERP account. AI-powered POS & business management for retail, restaurants, supermarkets, and auto service centers.',
  openGraph: {
    title: 'Sign In | RetailSmart ERP',
    description: 'Access your AI-powered business management dashboard. Unlimited users, all features included.',
    images: [{ url: '/og/home', width: 1200, height: 630 }],
  },
}

export default function LoginPage() {
  return <LoginClient />
}
