'use client'

import { create } from 'zustand'
import { useEffect } from 'react'
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react'

type ToastType = 'success' | 'error' | 'warning' | 'info'

interface Toast {
  id: string
  type: ToastType
  message: string
  duration?: number
}

interface ToastStore {
  toasts: Toast[]
  addToast: (type: ToastType, message: string, duration?: number) => void
  removeToast: (id: string) => void
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  addToast: (type, message, duration = 4000) => {
    const id = Math.random().toString(36).substring(2, 9)
    set((state) => ({
      toasts: [...state.toasts, { id, type, message, duration }],
    }))
  },
  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }))
  },
}))

// Helper functions for easy access
export const toast = {
  success: (message: string, duration?: number) => useToastStore.getState().addToast('success', message, duration),
  error: (message: string, duration?: number) => useToastStore.getState().addToast('error', message, duration),
  warning: (message: string, duration?: number) => useToastStore.getState().addToast('warning', message, duration),
  info: (message: string, duration?: number) => useToastStore.getState().addToast('info', message, duration),
}

const iconMap = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
}

const colorMap = {
  success: 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800 text-green-800 dark:text-green-200',
  error: 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200',
  warning: 'bg-yellow-50 dark:bg-yellow-900/30 border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-200',
  info: 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200',
}

const iconColorMap = {
  success: 'text-green-500 dark:text-green-400',
  error: 'text-red-500 dark:text-red-400',
  warning: 'text-yellow-500 dark:text-yellow-400',
  info: 'text-blue-500 dark:text-blue-400',
}

function ToastItem({ toast: t }: { toast: Toast }) {
  const removeToast = useToastStore((state) => state.removeToast)
  const Icon = iconMap[t.type]

  useEffect(() => {
    if (t.duration) {
      const timer = setTimeout(() => {
        removeToast(t.id)
      }, t.duration)
      return () => clearTimeout(timer)
    }
  }, [t.id, t.duration, removeToast])

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded border shadow-lg animate-slide-in ${colorMap[t.type]}`}
      role="alert"
    >
      <Icon size={16} className={iconColorMap[t.type]} />
      <p className="flex-1 text-xs font-medium">{t.message}</p>
      <button
        onClick={() => removeToast(t.id)}
        className="p-0.5 hover:bg-black/5 rounded transition-colors"
      >
        <X size={14} />
      </button>
    </div>
  )
}

export function ToastContainer() {
  const toasts = useToastStore((state) => state.toasts)

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItem toast={t} />
        </div>
      ))}
    </div>
  )
}
