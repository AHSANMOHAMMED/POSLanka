import { AdminPage } from '@/components/admin/kit'
import { BroadcastWorkspace } from '@/components/admin/BroadcastWorkspace'

export const metadata = { title: 'Send email' }

export default function SendEmailPage() {
  return (
    <AdminPage
      title="Send email"
      description="Email vendor owners or staff from the platform address, or write to specific addresses. Every send is kept with its delivery status."
    >
      <BroadcastWorkspace kind="email" />
    </AdminPage>
  )
}
