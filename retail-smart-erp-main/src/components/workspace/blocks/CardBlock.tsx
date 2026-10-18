'use client'

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import type { CardBlock as CardBlockType } from '@/lib/workspace/types'

interface CardBlockProps {
  block: CardBlockType
}

export function CardBlock({ block }: CardBlockProps) {
  const { title, links } = block.data

  return (
    <div className="bg-white dark:bg-gray-800 rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden w-full">
      <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700">
        <h3 className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
          {title}
        </h3>
      </div>
      <ul className="divide-y divide-gray-50 dark:divide-gray-700/50">
        {links.map((link) => (
          <li key={link.href + link.label}>
            <Link
              href={link.href}
              className="flex items-center justify-between px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors group"
            >
              <div>
                <span className="group-hover:text-gray-900 dark:group-hover:text-white transition-colors">
                  {link.label}
                </span>
                {link.description && (
                  <p className="text-xs text-gray-400 mt-0.5">{link.description}</p>
                )}
              </div>
              <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 group-hover:text-gray-500 transition-colors flex-shrink-0" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
