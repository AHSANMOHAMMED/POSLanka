import { AdminPage } from '@/components/admin/kit'
import { BroadcastWorkspace } from '@/components/admin/BroadcastWorkspace'

export const metadata = { title: 'Notifications' }

export default function NotificationsPage() {
  return (
    <AdminPage
      title="Notifications"
      description="Send announcements to all vendors or a chosen group, and see who received earlier ones."
    >
      <BroadcastWorkspace kind="notification" />
    </AdminPage>
  )
}
