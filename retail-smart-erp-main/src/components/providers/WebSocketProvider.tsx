'use client'

import { createContext, useContext, ReactNode } from 'react'
import { useWebSocket, disconnectWebSocket } from '@/hooks/useWebSocket'
import type { ConnectionStatus } from '@/lib/websocket/client'

interface WebSocketContextValue {
  status: ConnectionStatus
  isConnected: boolean
  subscribe: (channels: string[]) => void
  unsubscribe: (channels: string[]) => void
}

const defaultContextValue: WebSocketContextValue = {
  status: 'disconnected',
  isConnected: false,
  subscribe: () => {},
  unsubscribe: () => {},
}

const WebSocketContext = createContext<WebSocketContextValue>(defaultContextValue)

interface WebSocketProviderProps {
  children: ReactNode
}

export function WebSocketProvider({ children }: WebSocketProviderProps) {
  const ws = useWebSocket()

  return (
    <WebSocketContext.Provider value={ws}>
      {children}
    </WebSocketContext.Provider>
  )
}

export function useWebSocketContext() {
  return useContext(WebSocketContext)
}

export { disconnectWebSocket }
