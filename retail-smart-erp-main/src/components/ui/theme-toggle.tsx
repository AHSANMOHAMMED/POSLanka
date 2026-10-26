'use client'

import { useRef, useState, useEffect, useSyncExternalStore } from 'react'
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
  {
    value: 'violet',
    label: 'Cyber Violet',
    accentColor: '#a855f7',
    bgPreview: 'bg-[#0b0717]',
    description: 'Electric neon amethyst dark',
  },
  {
    value: 'crimson',
    label: 'Ruby Crimson',
    accentColor: '#f43f5e',
    bgPreview: 'bg-[#14050a]',
    description: 'High performance crimson wine',
  },
]

interface ThemeToggleProps {
  onThemeChange?: (theme: Theme) => void
}

const emptySubscribe = () => () => {}

export function ThemeToggle({ onThemeChange }: ThemeToggleProps) {
  const { theme, setTheme, palette, setPalette, resolvedTheme } = useTheme()
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false)

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

  const CurrentIcon = mounted && resolvedTheme === 'dark' ? Moon : Sun

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="p-2 rounded-xl hover:bg-white/10 dark:hover:bg-white/10 active:scale-95 transition-all duration-150 flex items-center gap-1.5 text-white/90 hover:text-white"
        aria-label="Customize theme"
        title="Customize theme & background colors"
        suppressHydrationWarning
      >
        <CurrentIcon className="w-4.5 h-4.5 transition-transform hover:rotate-12 duration-200" />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-72 rounded-2xl shadow-2xl bg-white/95 dark:bg-[#121622]/95 backdrop-blur-xl border border-gray-200/90 dark:border-white/10 p-3.5 z-50 space-y-3.5">
          {/* Appearance Mode */}
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2 px-1">
              Display Mode
            </div>
            <div className="grid grid-cols-3 gap-1.5 bg-gray-100 dark:bg-white/[0.06] p-1 rounded-xl">
              {themeOptions.map((option) => {
                const Icon = option.icon
                const isSelected = theme === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => handleModeSelect(option.value)}
                    className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-semibold transition-all ${
                      isSelected
                        ? 'bg-white dark:bg-gray-800 text-gray-950 dark:text-white shadow-xs ring-1 ring-black/5 dark:ring-white/10'
                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-950 dark:hover:text-white hover:bg-white/50 dark:hover:bg-white/[0.04]'
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
          <div className="border-t border-gray-100 dark:border-white/10 pt-3">
            <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2 px-1">
              <span className="flex items-center gap-1.5">
                <Palette size={13} className="text-[var(--primary)]" />
                Color Palette & Themes
              </span>
            </div>
            <div className="space-y-1 max-h-[260px] overflow-y-auto pr-1">
              {paletteOptions.map((p) => {
                const isSelected = palette === p.value
                return (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setPalette(p.value)}
                    className={`w-full flex items-center justify-between p-2 rounded-xl text-left transition-all ${
                      isSelected
                        ? 'bg-[var(--primary)]/10 dark:bg-[var(--primary)]/20 text-gray-900 dark:text-white ring-1 ring-[var(--primary)]/40 shadow-xs'
                        : 'hover:bg-gray-100/80 dark:hover:bg-white/[0.06] text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className="w-5 h-5 rounded-full border-2 border-white dark:border-gray-800 shadow-xs flex-shrink-0"
                        style={{
                          backgroundColor: p.accentColor,
                          boxShadow: isSelected ? `0 0 10px ${p.accentColor}80` : undefined,
                        }}
                      />
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
                      <span className="w-4 h-4 rounded-full bg-[var(--primary)] text-white text-[10px] flex items-center justify-center font-bold">
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
