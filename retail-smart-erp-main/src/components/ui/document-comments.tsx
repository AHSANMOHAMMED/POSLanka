'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { MessageSquare, Send, Trash2, History, Loader2 } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { Timeline, TimelineItemData } from '@/components/ui/timeline'
import { useRealtimeData } from '@/hooks'
import type { EntityType } from '@/lib/websocket/events'
import { formatDistanceToNow } from 'date-fns'

interface Comment {
  id: string
  content: string
  createdAt: string
  userId: string
  user: { fullName: string } | null
}

interface ActivityLog {
  id: string
  action: string
  description: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
  user: { fullName: string } | null
}

interface DocumentCommentsAndActivityProps {
  documentType: string // e.g., 'purchase_order', 'work_order'
  documentId: string
  entityType: EntityType | EntityType[] // for real-time updates, e.g., 'purchase-order'
}

const actionToTimelineType: Record<string, TimelineItemData['type']> = {
  create: 'created',
  update: 'updated',
  delete: 'deleted',
  status_change: 'status_change',
  submit: 'status_change',
  approve: 'status_change',
  reject: 'status_change',
  cancel: 'deleted',
  convert: 'document',
}

export function DocumentCommentsAndActivity({
  documentType,
  documentId,
  entityType,
}: DocumentCommentsAndActivityProps) {
  const { data: session } = useSession()
  const [activeTab, setActiveTab] = useState<'comments' | 'activity'>('comments')
  const [comments, setComments] = useState<Comment[]>([])
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([])
  const [newComment, setNewComment] = useState('')
  const [loadingComments, setLoadingComments] = useState(false)
  const [loadingActivity, setLoadingActivity] = useState(false)
  const [posting, setPosting] = useState(false)

  const fetchComments = useCallback(async () => {
    if (!documentId) return
    setLoadingComments(true)
    try {
      const res = await fetch(`/api/comments?documentType=${documentType}&documentId=${documentId}`)
      if (res.ok) {
        const data = await res.json()
        setComments(data)
      }
    } catch (error) {
      console.error('Error fetching comments:', error)
    } finally {
      setLoadingComments(false)
    }
  }, [documentType, documentId])

  const fetchActivity = useCallback(async () => {
    if (!documentId) return
    setLoadingActivity(true)
    try {
      const res = await fetch(`/api/document-activity?entityType=${documentType}&entityId=${documentId}`)
      if (res.ok) {
        const data = await res.json()
        setActivityLogs(data)
      }
    } catch (error) {
      console.error('Error fetching activity:', error)
    } finally {
      setLoadingActivity(false)
    }
  }, [documentType, documentId])

  useEffect(() => {
    fetchComments()
    fetchActivity()
  }, [fetchComments, fetchActivity])

  // Real-time updates
  useRealtimeData(
    useCallback(async () => {
      fetchComments()
      fetchActivity()
    }, [fetchComments, fetchActivity]),
    { entityType, refreshOnMount: false }
  )

  async function handleAddComment() {
    if (!newComment.trim()) return
    setPosting(true)
    try {
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentType,
          documentId,
          content: newComment.trim(),
        }),
      })
      if (res.ok) {
        setNewComment('')
        fetchComments()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to add comment')
      }
    } catch (error) {
      console.error('Error adding comment:', error)
      toast.error('Failed to add comment')
    } finally {
      setPosting(false)
    }
  }

  async function handleDeleteComment(commentId: string) {
    try {
      const res = await fetch(`/api/comments/${commentId}`, { method: 'DELETE' })
      if (res.ok) {
        setComments(prev => prev.filter(c => c.id !== commentId))
      } else {
        toast.error('Failed to delete comment')
      }
    } catch {
      toast.error('Failed to delete comment')
    }
  }

  const timelineItems: TimelineItemData[] = activityLogs.map(log => ({
    id: log.id,
    type: actionToTimelineType[log.action] || 'default',
    title: log.description || `${log.action}`,
    user: log.user ? { name: log.user.fullName } : undefined,
    timestamp: log.createdAt,
    metadata: log.metadata as TimelineItemData['metadata'],
  }))

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setActiveTab('comments')}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'comments'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'
          }`}
        >
          <MessageSquare size={14} />
          Comments
          {comments.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 text-[10px] font-semibold bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-full">
              {comments.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('activity')}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'activity'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'
          }`}
        >
          <History size={14} />
          Activity
          {activityLogs.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 text-[10px] font-semibold bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-full">
              {activityLogs.length}
            </span>
          )}
        </button>
      </div>

      {/* Content */}
      <div className="p-4">
        {activeTab === 'comments' ? (
          <div className="space-y-3">
            {/* Comment input */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddComment() } }}
                placeholder="Add a comment..."
                className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                disabled={posting}
              />
              <button
                onClick={handleAddComment}
                disabled={posting || !newComment.trim()}
                className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {posting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              </button>
            </div>

            {/* Comments list */}
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {loadingComments ? (
                <div className="flex justify-center py-4">
                  <Loader2 size={20} className="animate-spin text-gray-400" />
                </div>
              ) : comments.length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">No comments yet</p>
              ) : (
                comments.map(comment => (
                  <div key={comment.id} className="flex gap-2 group">
                    <div className="w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                        {(comment.user?.fullName || 'U')[0].toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                          {comment.user?.fullName || 'Unknown'}
                        </span>
                        <span className="text-[10px] text-gray-400">
                          {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
                        </span>
                        {comment.userId === session?.user?.id && (
                          <button
                            onClick={() => handleDeleteComment(comment.id)}
                            className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-300 hover:text-red-500 transition-all"
                            title="Delete comment"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap break-words">{comment.content}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="max-h-[300px] overflow-y-auto">
            {loadingActivity ? (
              <div className="flex justify-center py-4">
                <Loader2 size={20} className="animate-spin text-gray-400" />
              </div>
            ) : timelineItems.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">No activity recorded</p>
            ) : (
              <Timeline items={timelineItems} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
