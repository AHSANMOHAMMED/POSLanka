import { z } from 'zod'

export const updateRolePermissionsSchema = z.object({
  role: z.string().min(1, 'Role is required'),
  overrides: z.record(z.string(), z.boolean()),
})

export const resetRolePermissionsSchema = z.object({
  role: z.string().min(1, 'Role is required'),
})

export const createCustomRoleSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  baseRole: z.string().min(1, 'Base role is required'),
  description: z.string().max(500).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Invalid hex color').optional(),
  permissions: z.record(z.string(), z.boolean()).optional(),
})

export const updateCustomRoleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  baseRole: z.string().min(1).optional(),
  description: z.string().max(500).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  isActive: z.boolean().optional(),
  permissions: z.record(z.string(), z.boolean()).optional(),
})
