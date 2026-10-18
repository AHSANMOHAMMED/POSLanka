'use client'

import { ReactNode } from 'react'
import { DocumentViewerProvider } from '@/components/ui/document-viewer-context'
import { WebSocketProvider } from '@/components/providers/WebSocketProvider'
import { SidebarProvider } from '@/components/layout/Sidebar'

interface ClientProvidersProps {
  children: ReactNode
}

export function ClientProviders({ children }: ClientProvidersProps) {
  return (
    <WebSocketProvider>
      <SidebarProvider>
        <DocumentViewerProvider>
          {children}
        </DocumentViewerProvider>
      </SidebarProvider>
    </WebSocketProvider>
  )
}
