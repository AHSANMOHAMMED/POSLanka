import type { Metadata } from 'next'
import ForgotPasswordClient from './ForgotPasswordClient'

export const metadata: Metadata = {
  title: 'Forgot Password - RetailSmart ERP',
  description: 'Reset your RetailSmart ERP account password. Enter your email address and we\'ll send you instructions to create a new password.',
  openGraph: {
    title: 'Forgot Password | RetailSmart ERP',
    description: 'Reset your account password securely.',
    images: [{ url: '/og/home', width: 1200, height: 630 }],
  },
}

export default function ForgotPasswordPage() {
  return <ForgotPasswordClient />
}
