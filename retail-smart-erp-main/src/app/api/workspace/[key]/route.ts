import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { workspaceConfigs } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { getDefaultWorkspace } from '@/lib/workspace/defaults'
import type { WorkspaceBlock, WorkspaceConfig } from '@/lib/workspace/types'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation/helpers'
import { updateWorkspaceSchema } from '@/lib/validation/schemas/settings'

/**
 * Resolve relative hrefs in workspace blocks by prepending the tenant base path.
 * Only modifies href values that start with '/' and don't already have the basePath prefix.
 */
function resolveBlockHrefs(blocks: WorkspaceBlock[], basePath: string): WorkspaceBlock[] {
  const resolve = (href: string) =>
    href.startsWith('/') && !href.startsWith(basePath) ? `${basePath}${href}` : href

  return blocks.map((block) => {
    switch (block.type) {
      case 'number_card':
        return { ...block, data: { ...block.data, href: resolve(block.data.href) } }
      case 'shortcut':
        return {
          ...block,
          data: {
            ...block.data,
            shortcuts: block.data.shortcuts.map((s) => ({ ...s, href: resolve(s.href) })),
          },
        }
      case 'quick_list':
        return { ...block, data: { ...block.data, href: resolve(block.data.href) } }
      case 'card':
        return {
          ...block,
          data: {
            ...block.data,
            links: block.data.links.map((link) => ({ ...link, href: resolve(link.href) })),
          },
        }
      default:
        return block
    }
  })
}

// GET workspace config for a given key
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { key } = await params
    const basePath = `/c/${session.user.tenantSlug}`

    // Try to load user's custom config from DB
    let existing: { blocks: unknown } | undefined
    try {
      existing = await withTenant(session.user.tenantId, async (db) => {
        return db.query.workspaceConfigs.findFirst({
          where: and(
            eq(workspaceConfigs.userId, session.user.id),
            eq(workspaceConfigs.workspaceKey, key),
          ),
        })
      })
    } catch {
      // Table may not exist yet (migration not run) - fall back to defaults
    }

    if (existing) {
      const blocks = resolveBlockHrefs(existing.blocks as WorkspaceBlock[], basePath)
      const defaultConfig = getDefaultWorkspace(key, session.user.businessType)
      const config: WorkspaceConfig = {
        key,
        title: defaultConfig?.title || key,
        description: defaultConfig?.description || '',
        icon: defaultConfig?.icon || 'LayoutDashboard',
        colorScheme: defaultConfig?.colorScheme || 'blue',
        blocks,
      }
      return NextResponse.json({ config })
    }

    // Fall back to default workspace
    const defaultConfig = getDefaultWorkspace(key, session.user.businessType)
    if (!defaultConfig) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    const config: WorkspaceConfig = {
      ...defaultConfig,
      blocks: resolveBlockHrefs(defaultConfig.blocks, basePath),
    }
    return NextResponse.json({ config })
  } catch (error) {
    logError('api/workspace/[key]', error)
    return NextResponse.json({ error: 'Failed to fetch workspace config' }, { status: 500 })
  }
}

// PUT save user's custom workspace config
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { key } = await params
    const parsed = await validateBody(request, updateWorkspaceSchema)
    if (!parsed.success) return parsed.response
    const blocks = parsed.data.blocks as unknown as WorkspaceBlock[]

    return await withTenant(session.user.tenantId, async (db) => {
      const now = new Date()

      const [upserted] = await db
        .insert(workspaceConfigs)
        .values({
          tenantId: session.user.tenantId,
          userId: session.user.id,
          workspaceKey: key,
          blocks,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [workspaceConfigs.tenantId, workspaceConfigs.userId, workspaceConfigs.workspaceKey],
          set: {
            blocks,
            updatedAt: now,
          },
        })
        .returning()

      logAndBroadcast(session.user.tenantId, 'workspace', 'updated', upserted.id)

      const basePath = `/c/${session.user.tenantSlug}`
      const defaultConfig = getDefaultWorkspace(key, session.user.businessType)
      const config: WorkspaceConfig = {
        key,
        title: defaultConfig?.title || key,
        description: defaultConfig?.description || '',
        icon: defaultConfig?.icon || 'LayoutDashboard',
        colorScheme: defaultConfig?.colorScheme || 'blue',
        blocks: resolveBlockHrefs(upserted.blocks as WorkspaceBlock[], basePath),
      }

      return NextResponse.json({ config })
    })
  } catch (error) {
    logError('api/workspace/[key]', error)
    return NextResponse.json({ error: 'Failed to save workspace config' }, { status: 500 })
  }
}

// DELETE remove user's custom config (revert to default)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { key } = await params

    return await withTenant(session.user.tenantId, async (db) => {
      await db
        .delete(workspaceConfigs)
        .where(
          and(
            eq(workspaceConfigs.userId, session.user.id),
            eq(workspaceConfigs.workspaceKey, key),
          ),
        )

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/workspace/[key]', error)
    return NextResponse.json({ error: 'Failed to delete workspace config' }, { status: 500 })
  }
}
