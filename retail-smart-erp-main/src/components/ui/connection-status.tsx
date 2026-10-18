'use client'

import { useWebSocketContext } from '@/components/providers/WebSocketProvider'
import { Wifi, WifiOff, RefreshCw } from 'lucide-react'

interface ConnectionStatusProps {
  /** Show label text (default: false) */
  showLabel?: boolean
  /** Size of the indicator (default: 'sm') */
  size?: 'sm' | 'md' | 'lg'
  /** Custom class name */
  className?: string
}

export function ConnectionStatus({
  showLabel = false,
  size = 'sm',
  className = '',
}: ConnectionStatusProps) {
  const { status } = useWebSocketContext()

  const sizeClasses = {
    sm: 'h-2 w-2',
    md: 'h-3 w-3',
    lg: 'h-4 w-4',
  }

  const iconSizes = {
    sm: 12,
    md: 14,
    lg: 16,
  }

  const dotSize = sizeClasses[size]
  const iconSize = iconSizes[size]

  const getStatusConfig = () => {
    switch (status) {
      case 'connected':
        return {
          color: 'bg-green-500',
          icon: <Wifi size={iconSize} className="text-green-600" />,
          label: 'Connected',
          title: 'Real-time updates active',
        }
      case 'connecting':
        return {
          color: 'bg-yellow-500 animate-pulse',
          icon: <RefreshCw size={iconSize} className="text-yellow-600 animate-spin" />,
          label: 'Connecting...',
          title: 'Connecting to real-time server',
        }
      case 'reconnecting':
        return {
          color: 'bg-yellow-500 animate-pulse',
          icon: <RefreshCw size={iconSize} className="text-yellow-600 animate-spin" />,
          label: 'Reconnecting...',
          title: 'Reconnecting to real-time server',
        }
      case 'disconnected':
      default:
        return {
          color: 'bg-gray-400',
          icon: <WifiOff size={iconSize} className="text-gray-500" />,
          label: 'Offline',
          title: 'Real-time updates unavailable (using polling)',
        }
    }
  }

  const config = getStatusConfig()

  return (
    <div
      className={`inline-flex items-center gap-1.5 ${className}`}
      title={config.title}
    >
      <span className={`${dotSize} rounded-full ${config.color}`} />
      {showLabel && (
        <span className="text-xs text-gray-600 dark:text-gray-400">{config.label}</span>
      )}
    </div>
  )
}

/**
 * Minimal dot indicator for connection status
 */
export function ConnectionDot({
  className = '',
}: {
  className?: string
}) {
  const { status } = useWebSocketContext()

  const getColor = () => {
    switch (status) {
      case 'connected':
        return 'bg-green-500'
      case 'connecting':
      case 'reconnecting':
        return 'bg-yellow-500 animate-pulse'
      case 'disconnected':
      default:
        return 'bg-gray-400'
    }
  }

  const getTitle = () => {
    switch (status) {
      case 'connected':
        return 'Real-time updates active'
      case 'connecting':
        return 'Connecting...'
      case 'reconnecting':
        return 'Reconnecting...'
      case 'disconnected':
      default:
        return 'Offline (using polling)'
    }
  }

  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${getColor()} ${className}`}
      title={getTitle()}
    />
  )
}
