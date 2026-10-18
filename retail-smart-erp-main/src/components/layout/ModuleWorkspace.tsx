'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ChevronRight, Home } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

// ============================================
// TYPES
// ============================================

export interface ShortcutItem {
  href: string
  icon: LucideIcon
  label: string
  badge?: number
  description?: string
}

export interface LinkItem {
  label: string
  href: string
}

export interface LinkGroup {
  title: string
  items: LinkItem[]
}

export interface ModuleWorkspaceProps {
  title: string
  description: string
  icon: LucideIcon
  colorScheme: {
    header: string
    iconBg: string
    shortcutBg: string
    shortcutBorder: string
    shortcutHover: string
    text: string
  }
  shortcuts: ShortcutItem[]
  linkGroups: LinkGroup[]
}

// ============================================
// MODULE WORKSPACE COMPONENT
// ============================================

export function ModuleWorkspace({
  title,
  description,
  icon: Icon,
  colorScheme,
  shortcuts,
  linkGroups,
}: ModuleWorkspaceProps) {
  const params = useParams()
  const slug = params.slug as string

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-gray-500">
        <Link
          href={`/c/${slug}/dashboard`}
          className="flex items-center gap-1 hover:text-gray-700 transition-colors"
        >
          <Home className="w-3.5 h-3.5" />
          <span>Home</span>
        </Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-gray-900 dark:text-white font-medium">{title}</span>
      </nav>

      {/* Module Header */}
      <div className={`flex items-center gap-4 p-6 rounded-2xl bg-gradient-to-r ${colorScheme.header} shadow-sm`}>
        <div className={`w-14 h-14 ${colorScheme.iconBg} rounded-2xl flex items-center justify-center shadow-lg`}>
          <Icon className="w-7 h-7 text-white" strokeWidth={1.5} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">{title}</h1>
          <p className="text-white/80 text-sm mt-0.5">{description}</p>
        </div>
      </div>

      {/* Shortcuts Section */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-6 py-3 border-b border-gray-100 dark:border-gray-700">
          <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
            Shortcuts
          </h2>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {shortcuts.map((shortcut) => {
              const ShortcutIcon = shortcut.icon
              return (
                <Link
                  key={shortcut.href}
                  href={shortcut.href}
                  className={`relative flex flex-col items-center justify-center p-4 rounded-2xl border ${colorScheme.shortcutBg} ${colorScheme.shortcutBorder} ${colorScheme.shortcutHover} transition-all duration-200 group hover:shadow-lg hover:-translate-y-0.5`}
                >
                  {shortcut.badge !== undefined && shortcut.badge > 0 && (
                    <span className="absolute -top-2 -right-2 min-w-[22px] h-[22px] px-1.5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center shadow-md">
                      {shortcut.badge > 99 ? '99+' : shortcut.badge}
                    </span>
                  )}
                  <div className={`w-12 h-12 ${colorScheme.iconBg} rounded-md flex items-center justify-center mb-2.5 group-hover:scale-110 transition-transform shadow-lg`}>
                    <ShortcutIcon className="w-6 h-6 text-white" strokeWidth={1.5} />
                  </div>
                  <span className={`text-xs font-semibold ${colorScheme.text} text-center leading-tight`}>
                    {shortcut.label}
                  </span>
                  {shortcut.description && (
                    <span className="text-[10px] text-gray-400 text-center mt-0.5">
                      {shortcut.description}
                    </span>
                  )}
                </Link>
              )
            })}
          </div>
        </div>
      </div>

      {/* Link Groups (Masters, Reports, Transactions) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {linkGroups.map((group) => (
          <div
            key={group.title}
            className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden"
          >
            <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700">
              <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                {group.title}
              </h3>
            </div>
            <ul className="divide-y divide-gray-50 dark:divide-gray-700/50">
              {group.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="flex items-center justify-between px-5 py-3 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors group"
                  >
                    <span className="group-hover:text-gray-900 dark:group-hover:text-white transition-colors">
                      {item.label}
                    </span>
                    <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 group-hover:text-gray-500 transition-colors" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}
