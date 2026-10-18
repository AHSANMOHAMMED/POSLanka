// WebSocket library exports

// Event types
export type {
  EntityType,
  ActionType,
  DataChangeEvent,
  PresenceEvent,
  SubscribeMessage,
  UnsubscribeMessage,
  ClientMessage,
  ServerMessage,
} from './events'

export { tableToEntityMap } from './events'

// Channel utilities
export {
  getTenantChannel,
  getTenantNotificationsChannel,
  getWorkOrderChannel,
  getEstimateChannel,
  parseChannel,
  canSubscribe,
  getDefaultTenantChannels,
} from './channels'

// Client (browser-side)
export type {
  ConnectionStatus,
  MessageHandler,
  DataChangeHandler,
  PresenceHandler,
  StatusChangeHandler,
  WebSocketClientOptions,
} from './client'

export { WebSocketClient } from './client'

// Broadcast helper (for API routes)
export { broadcastChange } from './broadcast'
