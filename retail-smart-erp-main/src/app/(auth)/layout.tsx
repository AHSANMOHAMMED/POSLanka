import { SessionProvider } from 'next-auth/react'
import { InstallPromptPopup } from '@/components/ui/install-prompt-popup'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider basePath="/api/account-auth" refetchInterval={840}>
      <main className="auth-root">
        <div className="fixed inset-0 -z-50 bg-[#09090b]" aria-hidden="true" />
        {children}
        <InstallPromptPopup />
      </main>
    </SessionProvider>
  )
}
