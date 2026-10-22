'use client'

import { useRef, useState, useEffect } from 'react'
import { Sun, Moon, Monitor, Palette } from 'lucide-react'
import { useTheme, type ThemePalette, type Theme } from '@/components/providers/ThemeProvider'

const themeOptions = [
  { value: 'light' as const, label: 'Light', icon: Sun },
  { value: 'dark' as const, label: 'Dark', icon: Moon },
  { value: 'system' as const, label: 'Auto', icon: Monitor },
]

const paletteOptions: Array<{
  value: ThemePalette
  label: string
  accentColor: string
  bgPreview: string
  description: string
}> = [
  {
    value: 'default',
    label: 'Classic Slate',
    accentColor: '#2563eb',
    bgPreview: 'bg-slate-900',
    description: 'Clean balanced contrast',
  },
  {
    value: 'midnight',
    label: 'Midnight Navy',
    accentColor: '#3b82f6',
    bgPreview: 'bg-[#090e1a]',
    description: 'Deep cosmic luxury dark',
  },
  {
    value: 'emerald',
    label: 'Emerald Green',
    accentColor: '#10b981',
    bgPreview: 'bg-[#04140d]',
    description: 'Fresh supermarket botanical',
  },
  {
    value: 'charcoal',
    label: 'Carbon OLED',
    accentColor: '#38bdf8',
    bgPreview: 'bg-black',
    description: 'Pitch black ultra contrast',
  },
  {
    value: 'amber',
    label: 'Warm Amber',
    accentColor: '#f59e0b',
    bgPreview: 'bg-[#140e0a]',
    description: 'Warm golden bistro tone',
  },
]

interface ThemeToggleProps {
  onThemeChange?: (theme: Theme) => void
}

export function ThemeToggle({ onThemeChange }: ThemeToggleProps) {
  const { theme, setTheme, palette, setPalette, resolvedTheme } = useTheme()
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleModeSelect = (value: Theme) => {
    setTheme(value)
    onThemeChange?.(value)
  }

  const CurrentIcon = resolvedTheme === 'dark' ? Moon : Sun

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center gap-1.5 text-gray-600 dark:text-gray-300"
        aria-label="Customize theme"
        title="Customize theme & background colors"
      >
        <CurrentIcon className="w-5 h-5" />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-64 rounded-xl shadow-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-3 z-50 space-y-3">
          {/* Appearance Mode */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1.5 px-1">
              Mode
            </div>
            <div className="grid grid-cols-3 gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
              {themeOptions.map((option) => {
                const Icon = option.icon
                const isSelected = theme === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => handleModeSelect(option.value)}
                    className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs font-medium transition-all ${
                      isSelected
                        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-xs'
                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {option.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Color Palettes (Rich Contrast Backgrounds) */}
          <div className="border-t border-gray-100 dark:border-gray-800 pt-2.5">
            <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2 px-1">
              <span className="flex items-center gap-1">
                <Palette size={12} />
                Background Theme
              </span>
            </div>
            <div className="space-y-1">
              {paletteOptions.map((p) => {
                const isSelected = palette === p.value
                return (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setPalette(p.value)}
                    className={`w-full flex items-center justify-between p-2 rounded-lg text-left transition-all ${
                      isSelected
                        ? 'bg-blue-50/80 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200 ring-1 ring-blue-500/30'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-800/60 text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="relative w-5 h-5 rounded-full border border-gray-300 dark:border-gray-600 flex items-center justify-center overflow-hidden flex-shrink-0">
                        <div
                          className="w-full h-full"
                          style={{ backgroundColor: p.accentColor }}
                        />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold truncate leading-tight">
                          {p.label}
                        </div>
                        <div className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                          {p.description}
                        </div>
                      </div>
                    </div>
                    {isSelected && (
                      <span className="text-blue-600 dark:text-blue-400 text-xs font-bold pl-2">
                        ✓
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
