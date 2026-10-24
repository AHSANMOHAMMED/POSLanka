import type { Metadata } from 'next'
import RegisterClient from './RegisterClient'

export const metadata: Metadata = {
  title: 'Create account',
  description: 'Create your skyERPOS owner account and set up your first business. Your first company is free.',
  keywords: ['register', 'create account', 'POS Sri Lanka', 'skyERPOS', 'sign up'],
  openGraph: {
    title: 'Create your account | skyERPOS',
    description: 'Point of sale and back office for Sri Lankan businesses. Your first company is free.',
    images: [{ url: '/og/home', width: 1200, height: 630 }],
  },
}

export default function RegisterPage() {
  return <RegisterClient />
}
