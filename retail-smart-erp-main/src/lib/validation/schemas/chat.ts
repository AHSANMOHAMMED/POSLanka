import { z } from 'zod'
import { uuidSchema } from './common'

// ==================== CONVERSATIONS ====================

// POST /api/chat/conversations
export const createConversationSchema = z.object({
  type: z.enum(['direct', 'group']),
  participantIds: z.array(uuidSchema).min(1, 'At least one participant is required').max(50),
  name: z.string().trim().max(255).optional(),
  description: z.string().trim().max(1000).optional(),
  avatarColor: z.string().max(50).optional(),
})

// PUT /api/chat/conversations/[id]
export const updateConversationSchema = z.object({
  name: z.string().trim().max(255).optional(),
  description: z.string().trim().max(1000).optional(),
  isMuted: z.boolean().optional(),
})

// ==================== MESSAGES ====================

// POST /api/chat/conversations/[id]/messages
export const sendMessageSchema = z.object({
  content: z.string().trim().min(1, 'Message content is required').max(5000),
})

// ==================== PARTICIPANTS ====================

// POST /api/chat/conversations/[id]/participants
export const addParticipantsSchema = z.object({
  userIds: z.array(uuidSchema).min(1, 'At least one user ID is required').max(50),
})

// DELETE /api/chat/conversations/[id]/participants
export const removeParticipantSchema = z.object({
  userId: uuidSchema,
})
