'use client'

import { NotificationLogTable } from '@/components/notifications'
import { ListPageLayout } from '@/components/layout/ListPageLayout'

export default function NotificationLogsPage() {
  return (
    <ListPageLayout
      module="Settings"
      moduleHref="/settings"
      title="Message Logs"
    >
      <div className="p-4">
        <NotificationLogTable />
      </div>
    </ListPageLayout>
  )
}
