// Channel name helpers for WebSocket subscriptions

import type { EntityType } from './events'

/**
 * Get the tenant-wide channel for a specific entity type
 */
export function getTenantChannel(tenantId: string, entityType: EntityType): string {
  return `tenant:${tenantId}:${entityType}s`
}

/**
 * Get the tenant notifications channel
 */
export function getTenantNotificationsChannel(tenantId: string): string {
  return `tenant:${tenantId}:notifications`
}

/**
 * Get a specific work order channel for collaborative editing
 */
export function getWorkOrderChannel(workOrderId: string): string {
  return `work-order:${workOrderId}`
}

/**
 * Get a specific estimate channel for collaborative editing
 */
export function getEstimateChannel(estimateId: string): string {
  return `estimate:${estimateId}`
}

/**
 * Get a staff chat conversation channel for real-time messages
 */
export function getStaffChatChannel(conversationId: string): string {
  return `staff-chat:${conversationId}`
}

/**
 * Get the account-level channel for a user (cross-tenant events)
 */
export function getAccountChannel(userId: string): string {
  return `account:${userId}`
}

/**
 * Parse a channel name to extract its components
 */
export function parseChannel(channel: string): {
  type: 'tenant' | 'account' | 'work-order' | 'estimate' | 'staff-chat' | 'unknown'
  tenantId?: string
  userId?: string
  entityType?: string
  resourceId?: string
} {
  const parts = channel.split(':')

  if (parts[0] === 'tenant' && parts.length >= 3) {
    return {
      type: 'tenant',
      tenantId: parts[1],
      entityType: parts[2],
    }
  }

  if (parts[0] === 'account' && parts.length === 2) {
    return {
      type: 'account',
      userId: parts[1],
    }
  }

  if (parts[0] === 'work-order' && parts.length === 2) {
    return {
      type: 'work-order',
      resourceId: parts[1],
    }
  }

  if (parts[0] === 'estimate' && parts.length === 2) {
    return {
      type: 'estimate',
      resourceId: parts[1],
    }
  }

  if (parts[0] === 'staff-chat' && parts.length === 2) {
    return {
      type: 'staff-chat',
      resourceId: parts[1],
    }
  }

  return { type: 'unknown' }
}

/**
 * Check if a user can subscribe to a channel
 */
export function canSubscribe(
  channel: string,
  userTenantId: string,
  userId?: string,
  resourceTenantId?: string
): boolean {
  const parsed = parseChannel(channel)

  switch (parsed.type) {
    case 'tenant':
      // Users can only subscribe to their own tenant channels
      return parsed.tenantId === userTenantId

    case 'account':
      // Users can only subscribe to their own account channel
      return !!userId && parsed.userId === userId

    case 'work-order':
    case 'estimate':
    case 'staff-chat':
      // Resource-specific channels require tenant ownership verification.
      // resourceTenantId MUST be provided by the server after DB lookup.
      // Never allow subscription without verified tenant ownership.
      if (!resourceTenantId) return false
      return resourceTenantId === userTenantId

    default:
      return false
  }
}

/**
 * Get all default channels for a tenant (for auto-subscription)
 */
export function getDefaultTenantChannels(tenantId: string): string[] {
  return [
    // Core entities
    getTenantChannel(tenantId, 'item'),
    getTenantChannel(tenantId, 'service'),
    getTenantChannel(tenantId, 'service-type'),
    getTenantChannel(tenantId, 'service-type-group'),
    getTenantChannel(tenantId, 'category'),
    getTenantChannel(tenantId, 'customer'),
    getTenantChannel(tenantId, 'vehicle'),
    getTenantChannel(tenantId, 'vehicle-type'),
    // Sales & orders
    getTenantChannel(tenantId, 'sale'),
    getTenantChannel(tenantId, 'held-sale'),
    getTenantChannel(tenantId, 'work-order'),
    getTenantChannel(tenantId, 'appointment'),
    // Insurance
    getTenantChannel(tenantId, 'estimate'),
    getTenantChannel(tenantId, 'insurance-company'),
    getTenantChannel(tenantId, 'insurance-assessor'),
    getTenantChannel(tenantId, 'estimate-template'),
    getTenantChannel(tenantId, 'inspection-template'),
    // Inventory
    getTenantChannel(tenantId, 'supplier'),
    getTenantChannel(tenantId, 'purchase'),
    // Warehouses
    getTenantChannel(tenantId, 'warehouse'),
    getTenantChannel(tenantId, 'warehouse-stock'),
    getTenantChannel(tenantId, 'stock-transfer'),
    getTenantChannel(tenantId, 'pos-profile'),
    // Restaurant (if applicable)
    getTenantChannel(tenantId, 'table'),
    getTenantChannel(tenantId, 'reservation'),
    // System
    getTenantChannel(tenantId, 'user'),
    getTenantChannel(tenantId, 'settings'),
    getTenantNotificationsChannel(tenantId),
    // Staff chat
    getTenantChannel(tenantId, 'staff-chat'),
  ]
}
