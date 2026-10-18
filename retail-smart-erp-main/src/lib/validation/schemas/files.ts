import { z } from 'zod'
import {
  uuidSchema, optionalUuid, paginationSchema,
  shortTextSchema,
} from './common'

// ==================== COLLECTIONS ====================

// GET /api/collections
export const collectionsListSchema = z.object({
  search: z.string().max(200).optional().default(''),
})

// POST /api/collections
export const createCollectionSchema = z.object({
  name: shortTextSchema,
  description: z.string().max(1000).nullish(),
  color: z.string().max(50).nullish(),
  icon: z.string().max(100).nullish(),
})

// GET /api/collections/[id]
export const collectionDetailSchema = paginationSchema

// PUT /api/collections/[id]
export const updateCollectionSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  description: z.string().max(1000).nullish(),
  color: z.string().max(50).nullish(),
  icon: z.string().max(100).nullish(),
})

// POST /api/collections/[id]/files
export const addFilesToCollectionSchema = z.object({
  fileIds: z.array(uuidSchema).min(1, 'At least one file ID is required').max(200),
})

// DELETE /api/collections/[id]/files
export const removeFileFromCollectionParamsSchema = z.object({
  fileId: uuidSchema,
})

// ==================== FILES ====================

// GET /api/files
export const filesListSchema = paginationSchema.extend({
  folderId: z.string().uuid().optional(),
  attachedToType: z.string().max(100).optional(),
  attachedToId: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
  type: z.enum(['image', 'document']).optional(),
  starred: z.string().optional().transform(v => v === 'true'),
  collectionId: z.string().uuid().optional(),
})

// PUT /api/files/[id]
export const updateFileSchema = z.object({
  fileName: z.string().trim().min(1).max(500).optional(),
  folderId: optionalUuid,
  description: z.string().max(2000).nullish(),
  category: z.string().max(100).nullish(),
  isPrivate: z.boolean().optional(),
})

// GET /api/files/[id]/audit
export const fileAuditListSchema = paginationSchema

// GET /api/files/search
export const fileSearchSchema = paginationSchema.extend({
  q: z.string().max(200).optional().default(''),
  tags: z.string().max(500).optional(),
  type: z.enum(['image', 'document', 'video']).optional(),
  starred: z.string().optional().transform(v => v === 'true' ? 'true' : v === 'false' ? 'false' : undefined),
})

// POST /api/files/bulk
const bulkActionSchema = z.enum(['delete', 'move', 'star', 'unstar', 'addTags', 'removeTags'])

export const bulkFileOperationSchema = z.object({
  action: bulkActionSchema,
  fileIds: z.array(uuidSchema).min(1, 'At least one file ID is required').max(100, 'Maximum 100 files per bulk operation'),
  targetFolderId: optionalUuid,
  tags: z.array(z.string().max(100)).optional(),
}).refine(
  (data) => {
    if (data.action === 'move' && data.targetFolderId === undefined) return true // validated later in handler
    return true
  },
  { message: 'Invalid bulk operation parameters' }
)

// POST /api/files/bulk-copy
export const bulkCopySchema = z.object({
  fileIds: z.array(uuidSchema).min(1, 'At least one file ID is required').max(100, 'Maximum 100 files per copy operation'),
  targetFolderId: z.string().uuid().nullable(),
})

// POST /api/files/folder
export const createFolderSchema = z.object({
  name: z.string().trim().min(1, 'Folder name is required').max(255)
    .refine(v => !v.includes('/') && !v.includes('\\') && !v.includes('..'), 'Invalid folder name'),
  folderId: optionalUuid,
})
