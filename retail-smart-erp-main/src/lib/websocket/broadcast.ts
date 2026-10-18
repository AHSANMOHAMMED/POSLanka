// Broadcast helper for API routes
// This module provides a way to notify clients about data changes from API routes
// Uses an internal HTTP endpoint to communicate with the WebSocket server

import type { EntityType } from './events'
import type { ActivityAction } from '@/lib/utils/activity-log'

/**
 * Broadcast message structure
 */
export interface BroadcastMessage {
  tenantId: string
  entityType: EntityType
  action: 'created' | 'updated' | 'deleted'
  id: string
  data?: Record<string, unknown>
}

/**
 * Account-level broadcast message structure (cross-tenant, user-scoped)
 */
export interface AccountBroadcastMessage {
  userId: string
  entityType: EntityType
  action: 'created' | 'updated' | 'deleted'
  id: string
  data?: Record<string, unknown>
}

// Use globalThis to share state across module instances in Next.js
// Note: This may not work reliably across all bundler contexts
declare global {
  var __broadcastProcessor: ((msg: BroadcastMessage) => void) | undefined
  var __accountBroadcastProcessor: ((msg: AccountBroadcastMessage) => void) | undefined
}

/**
 * Register a queue processor (called by WebSocket server on init)
 */
export function registerBroadcastProcessor(
  processor: (msg: BroadcastMessage) => void
) {
  globalThis.__broadcastProcessor = processor
  console.log('[Broadcast] Processor registered')
}

/**
 * Register an account-level broadcast processor (called by WebSocket server on init)
 */
export function registerAccountBroadcastProcessor(
  processor: (msg: AccountBroadcastMessage) => void
) {
  globalThis.__accountBroadcastProcessor = processor
  console.log('[Broadcast] Account processor registered')
}

/**
 * Get the internal broadcast URL
 */
function getBroadcastUrl(): string {
  // Use the server's internal URL for broadcast
  const port = process.env.PORT || '3000'
  return `http://127.0.0.1:${port}/_internal/broadcast`
}

/**
 * Broadcast a data change to all connected clients for a tenant
 *
 * This function tries the following in order:
 * 1. Direct processor call (if available in same context)
 * 2. Internal HTTP request to the custom server
 *
 * @example
 * // In an API route after creating an item:
 * broadcastChange(tenantId, 'item', 'created', item.id)
 */
export function broadcastChange(
  tenantId: string,
  entityType: EntityType,
  action: 'created' | 'updated' | 'deleted',
  id: string,
  data?: Record<string, unknown>
) {
  const message: BroadcastMessage = {
    tenantId,
    entityType,
    action,
    id,
    data,
  }

  // Try direct processor first (if in same context as WebSocket server)
  const processor = globalThis.__broadcastProcessor
  if (processor) {
    console.log(`[Broadcast] Direct: ${action} ${entityType} ${id}`)
    processor(message)
    return
  }

  // Fall back to internal HTTP request
  // Use fire-and-forget pattern - don't await
  console.log(`[Broadcast] HTTP: ${action} ${entityType} ${id}`)

  fetch(getBroadcastUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Broadcast': 'true',
      'X-Broadcast-Secret': process.env.NEXTAUTH_SECRET || '',
    },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(5000), // 5s timeout
  }).catch((err) => {
    // Log error but don't throw - broadcast failures shouldn't break API routes
    console.error('[Broadcast] HTTP request failed:', err.message)
  })
}

// Action mapping: broadcast past-tense → activity log present-tense
const broadcastToActivityAction: Record<string, ActivityAction> = {
  created: 'create',
  updated: 'update',
  deleted: 'delete',
}

interface LogAndBroadcastOptions {
  userId?: string | null
  entityName?: string
  activityAction?: ActivityAction
  metadata?: Record<string, unknown>
  description?: string
}

/**
 * Combined broadcast + activity logging (drop-in replacement for broadcastChange).
 * Broadcasts immediately, then fire-and-forget logs the activity via RLS-scoped INSERT.
 */
export function logAndBroadcast(
  tenantId: string,
  entityType: EntityType,
  action: 'created' | 'updated' | 'deleted',
  id: string,
  options?: LogAndBroadcastOptions,
  data?: Record<string, unknown>
) {
  // 1. Broadcast immediately (unchanged behavior)
  broadcastChange(tenantId, entityType, action, id, data)

  // 2. Fire-and-forget activity log
  const activityAction = options?.activityAction || broadcastToActivityAction[action] || 'update'
  const storageEntityType = entityType.replace(/-/g, '_')

  // Lazy import to avoid circular dependency
  import('@/lib/utils/activity-log').then(({ logActivity }) => {
    logActivity({
      tenantId,
      userId: options?.userId || undefined,
      action: activityAction,
      entityType: storageEntityType,
      entityId: id === 'bulk' ? undefined : id,
      entityName: options?.entityName,
      description: options?.description,
      metadata: options?.metadata,
    })
  }).catch((err) => {
    console.error('[LogAndBroadcast] Activity log failed:', err?.message || err)
  })
}

/**
 * Broadcast a data change to all connected clients for a specific user (account-level).
 * Used for cross-tenant events like notifications, wallet, subscriptions.
 *
 * @example
 * broadcastAccountChange(userId, 'account-notification', 'created', notification.id)
 */
export function broadcastAccountChange(
  userId: string,
  entityType: EntityType,
  action: 'created' | 'updated' | 'deleted',
  id: string,
  data?: Record<string, unknown>
) {
  const message: AccountBroadcastMessage = {
    userId,
    entityType,
    action,
    id,
    data,
  }

  // Try direct processor first (if in same context as WebSocket server)
  const processor = globalThis.__accountBroadcastProcessor
  if (processor) {
    console.log(`[Broadcast] Account direct: ${action} ${entityType} ${id}`)
    processor(message)
    return
  }

  // Fall back to internal HTTP request (only works with custom server via `npm run dev`)
  console.log(`[Broadcast] Account HTTP fallback: ${action} ${entityType} ${id}`)

  fetch(getAccountBroadcastUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Broadcast': 'account',
      'X-Broadcast-Secret': process.env.NEXTAUTH_SECRET || '',
    },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(5000), // 5s timeout
  }).catch((err) => {
    console.warn('[Broadcast] Account broadcast not delivered (custom server not running?). Real-time updates require `npm run dev`.', err.message)
  })
}

/**
 * Get the internal account broadcast URL
 */
function getAccountBroadcastUrl(): string {
  const port = process.env.PORT || '3000'
  return `http://127.0.0.1:${port}/_internal/account-broadcast`
}
