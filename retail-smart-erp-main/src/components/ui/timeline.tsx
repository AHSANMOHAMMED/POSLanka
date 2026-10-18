'use client'

import * as React from 'react'
import {
  Circle,
  Clock,
  User,
  Edit,
  Trash2,
  Plus,
  FileText,
  MessageSquare,
  Settings,
  ArrowRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDistanceToNow } from 'date-fns'

// ============================================
// TYPES
// ============================================

export type TimelineItemType =
  | 'default'
  | 'created'
  | 'updated'
  | 'deleted'
  | 'status_change'
  | 'comment'
  | 'assignment'
  | 'document'
  | 'system'

export interface TimelineItemData {
  id: string
  type: TimelineItemType
  title: string
  description?: string
  user?: {
    name: string
    avatar?: string
  }
  timestamp: Date | string
  metadata?: {
    fromStatus?: string
    toStatus?: string
    fieldName?: string
    oldValue?: string
    newValue?: string
  }
}

// ============================================
// TIMELINE ITEM ICONS
// ============================================

const typeIcons: Record<TimelineItemType, React.ComponentType<{ size: number; className?: string }>> = {
  default: Circle,
  created: Plus,
  updated: Edit,
  deleted: Trash2,
  status_change: ArrowRight,
  comment: MessageSquare,
  assignment: User,
  document: FileText,
  system: Settings,
}

const typeColors: Record<TimelineItemType, string> = {
  default: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  created: 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400',
  updated: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
  deleted: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
  status_change: 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400',
  comment: 'bg-yellow-100 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400',
  assignment: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400',
  document: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  system: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500',
}

// ============================================
// TIMELINE ITEM COMPONENT
// ============================================

interface TimelineItemProps {
  item: TimelineItemData
  isLast?: boolean
  showLine?: boolean
}

function TimelineItem({ item, isLast = false, showLine = true }: TimelineItemProps) {
  const Icon = typeIcons[item.type] || Circle
  const colorClass = typeColors[item.type] || typeColors.default

  const timestamp = typeof item.timestamp === 'string' ? new Date(item.timestamp) : item.timestamp
  const timeAgo = formatDistanceToNow(timestamp, { addSuffix: true })

  return (
    <div className="relative flex gap-3">
      {/* Line connector */}
      {showLine && !isLast && (
        <div className="absolute left-4 top-10 w-0.5 h-full bg-gray-200 dark:bg-gray-700 -translate-x-1/2" />
      )}

      {/* Icon */}
      <div className={cn('relative z-10 flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center', colorClass)}>
        <Icon size={14} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pb-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              {item.title}
            </p>
            {item.description && (
              <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">
                {item.description}
              </p>
            )}
            {/* Status change display */}
            {item.type === 'status_change' && item.metadata?.fromStatus && item.metadata?.toStatus && (
              <div className="mt-1 flex items-center gap-2 text-sm">
                <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                  {item.metadata.fromStatus}
                </span>
                <ArrowRight size={12} className="text-gray-400" />
                <span className="px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                  {item.metadata.toStatus}
                </span>
              </div>
            )}
            {/* Field change display */}
            {item.type === 'updated' && item.metadata?.fieldName && (
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                <span className="font-medium">{item.metadata.fieldName}:</span>{' '}
                {item.metadata.oldValue && (
                  <>
                    <span className="line-through">{item.metadata.oldValue}</span>
                    {' → '}
                  </>
                )}
                <span className="text-gray-700 dark:text-gray-300">{item.metadata.newValue}</span>
              </div>
            )}
          </div>
          <div className="flex-shrink-0 text-right">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {timeAgo}
            </p>
            {item.user && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                by {item.user.name}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================
// TIMELINE COMPONENT
// ============================================

export interface TimelineProps {
  items: TimelineItemData[]
  className?: string
  showLine?: boolean
  maxItems?: number
  emptyMessage?: string
}

export function Timeline({
  items,
  className,
  showLine = true,
  maxItems,
  emptyMessage = 'No activity yet',
}: TimelineProps) {
  const displayItems = maxItems ? items.slice(0, maxItems) : items
  const hasMore = maxItems && items.length > maxItems

  if (items.length === 0) {
    return (
      <div className={cn('text-center py-8', className)}>
        <Clock size={24} className="mx-auto text-gray-400 mb-2" />
        <p className="text-sm text-gray-500 dark:text-gray-400">{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div className={className}>
      {displayItems.map((item, index) => (
        <TimelineItem
          key={item.id}
          item={item}
          isLast={index === displayItems.length - 1}
          showLine={showLine}
        />
      ))}
      {hasMore && (
        <div className="text-center pt-2">
          <button className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300">
            Show {items.length - (maxItems || 0)} more
          </button>
        </div>
      )}
    </div>
  )
}

// ============================================
// ACTIVITY FEED COMPONENT (with input)
// ============================================

export interface ActivityFeedProps {
  items: TimelineItemData[]
  onAddComment?: (comment: string) => void
  className?: string
  placeholder?: string
  showCommentInput?: boolean
}

export function ActivityFeed({
  items,
  onAddComment,
  className,
  placeholder = 'Add a comment...',
  showCommentInput = true,
}: ActivityFeedProps) {
  const [comment, setComment] = React.useState('')
  const [isSubmitting, setIsSubmitting] = React.useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!comment.trim() || !onAddComment) return

    setIsSubmitting(true)
    try {
      await onAddComment(comment.trim())
      setComment('')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className={className}>
      {/* Comment input */}
      {showCommentInput && onAddComment && (
        <form onSubmit={handleSubmit} className="mb-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={placeholder}
              disabled={isSubmitting}
              className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!comment.trim() || isSubmitting}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? 'Posting...' : 'Post'}
            </button>
          </div>
        </form>
      )}

      {/* Timeline */}
      <Timeline items={items} />
    </div>
  )
}

// ============================================
// SIMPLE ACTIVITY LIST COMPONENT
// ============================================

export interface ActivityListItem {
  id: string
  action: string
  user: string
  timestamp: Date | string
  icon?: React.ReactNode
}

export interface ActivityListProps {
  items: ActivityListItem[]
  className?: string
  maxItems?: number
}

export function ActivityList({ items, className, maxItems = 10 }: ActivityListProps) {
  const displayItems = items.slice(0, maxItems)

  if (items.length === 0) {
    return (
      <div className={cn('text-center py-4 text-sm text-gray-500 dark:text-gray-400', className)}>
        No recent activity
      </div>
    )
  }

  return (
    <ul className={cn('space-y-2', className)}>
      {displayItems.map((item) => {
        const timestamp = typeof item.timestamp === 'string' ? new Date(item.timestamp) : item.timestamp
        const timeAgo = formatDistanceToNow(timestamp, { addSuffix: true })

        return (
          <li key={item.id} className="flex items-start gap-3 text-sm">
            {item.icon && (
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-500">
                {item.icon}
              </span>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-gray-700 dark:text-gray-300">
                <span className="font-medium text-gray-900 dark:text-white">{item.user}</span>{' '}
                {item.action}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{timeAgo}</p>
            </div>
          </li>
        )
      })}
      {items.length > maxItems && (
        <li className="text-center">
          <button className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400">
            View all activity
          </button>
        </li>
      )}
    </ul>
  )
}
