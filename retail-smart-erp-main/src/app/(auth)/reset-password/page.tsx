import type { Metadata } from 'next'
import ResetPasswordClient from './ResetPasswordClient'

export const metadata: Metadata = {
  title: 'Set a new password',
  description: 'Set a new password for your POSLanka account.',
  robots: { index: false, follow: false },
}

export default function ResetPasswordPage() {
  return <ResetPasswordClient />
}
