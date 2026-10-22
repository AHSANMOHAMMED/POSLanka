import { SessionProvider } from 'next-auth/react'
import { InstallPromptPopup } from '@/components/ui/install-prompt-popup'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider basePath="/api/account-auth" refetchInterval={840}>
      {/* Pages render their own <AuthShell> (src/components/admin/kit), which follows the light/dark theme */}
      {children}
      <InstallPromptPopup />
    </SessionProvider>
  )
}
