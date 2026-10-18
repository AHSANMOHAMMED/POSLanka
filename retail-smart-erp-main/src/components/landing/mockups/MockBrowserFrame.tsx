'use client'

import { type ReactNode } from 'react'

interface MockBrowserFrameProps {
  children: ReactNode
  className?: string
  url?: string
}

export function MockBrowserFrame({
  children,
  className = '',
  url = 'app.retailsmarterp.com',
}: MockBrowserFrameProps) {
  return (
    <div
      className={`rounded-md shadow-2xl overflow-hidden border border-gray-200 bg-white ${className}`}
    >
      {/* Browser chrome bar */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-100 border-b border-gray-200">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-400" />
          <div className="w-3 h-3 rounded-full bg-yellow-400" />
          <div className="w-3 h-3 rounded-full bg-green-400" />
        </div>
        <div className="flex-1 ml-2">
          <div className="bg-white rounded-md px-3 py-1 text-[10px] text-gray-400 max-w-[220px] truncate border border-gray-200 font-mono">
            {url}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 rounded text-gray-400 flex items-center justify-center">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M1 5h8M5 1v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
        </div>
      </div>
      {/* Content area */}
      <div className="bg-white overflow-x-auto">{children}</div>
    </div>
  )
}
