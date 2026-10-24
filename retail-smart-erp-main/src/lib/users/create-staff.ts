import bcrypt from 'bcryptjs'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { TenantDb } from '@/lib/db'
import { accounts, customRoles, posProfiles, posProfileUsers, tenants, users, userWarehouses, warehouses } from '@/lib/db/schema'
import { canModifyUser } from '@/lib/auth/roles'
import { validatePasswordStrength } from '@/lib/utils/validation'
import { generateReadablePassword, loginLocalPart, placeholderLogin } from './generated-login'

/** Error carrying an HTTP status so routes can map it directly to a response. */
export class StaffError extends Error {
  constructor(message: string, public status: number) {
    super(message)
    this.name = 'StaffError'
  }
}

type UserRoleValue = typeof users.$inferInsert['role'] & string

/** Roles whose default POS counter is auto-assigned when only one exists. */
const POS_ROLES = new Set(['cashier', 'pos_user'])

const PIN_RE = /^\d{4,6}$/

/** Any Drizzle handle bound to a tenant context (withTenant db or a transaction). */
type Tx = Pick<TenantDb, 'select' | 'insert' | 'update' | 'delete' | 'execute'>

export interface ResolvedAssignments {
  warehouseIds: string[]
  posProfileIds: string[]
}

function uniq(ids: string[] | undefined | null): string[] {
  return Array.from(new Set((ids || []).filter(Boolean)))
}

/**
 * Validate and complete a staff member's branch (warehouse) and counter (POS profile)
 * assignments for a tenant.
 *  - All ids must belong to the tenant (otherwise 400).
 *  - Counters whose branch is not among the warehouses are auto-added to the warehouses.
 *  - No warehouses + tenant has exactly one active warehouse → that warehouse is assigned.
 *  - No counters + POS role + the (single) assigned warehouse has exactly one active
 *    counter → that counter is assigned.
 */
export async function resolveStaffAssignments(
  tx: Tx,
  tenantId: string,
  role: string,
  input: { warehouseIds?: string[] | null; posProfileIds?: string[] | null },
  options: { autoAssign?: boolean } = {},
): Promise<ResolvedAssignments> {
  const autoAssign = options.autoAssign !== false
  let warehouseIds = uniq(input.warehouseIds)
  let posProfileIds = uniq(input.posProfileIds)

  if (warehouseIds.length > 0) {
    const found = await tx.select({ id: warehouses.id }).from(warehouses)
      .where(and(eq(warehouses.tenantId, tenantId), inArray(warehouses.id, warehouseIds)))
    if (found.length !== warehouseIds.length) {
      throw new StaffError('One or more branches not found', 400)
    }
  }

  if (posProfileIds.length > 0) {
    const profiles = await tx.select({ id: posProfiles.id, warehouseId: posProfiles.warehouseId })
      .from(posProfiles)
      .where(and(eq(posProfiles.tenantId, tenantId), inArray(posProfiles.id, posProfileIds)))
    if (profiles.length !== posProfileIds.length) {
      throw new StaffError('One or more POS counters not found', 400)
    }
    for (const p of profiles) {
      if (p.warehouseId && !warehouseIds.includes(p.warehouseId)) warehouseIds.push(p.warehouseId)
    }
  }

  if (autoAssign && warehouseIds.length === 0) {
    const active = await tx.select({ id: warehouses.id }).from(warehouses)
      .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.isActive, true)))
    if (active.length === 1) warehouseIds = [active[0].id]
  }

  if (autoAssign && posProfileIds.length === 0 && POS_ROLES.has(role) && warehouseIds.length === 1) {
    const counters = await tx.select({ id: posProfiles.id }).from(posProfiles)
      .where(and(
        eq(posProfiles.tenantId, tenantId),
        eq(posProfiles.warehouseId, warehouseIds[0]),
        eq(posProfiles.status, 'active'),
      ))
    if (counters.length === 1) posProfileIds = [counters[0].id]
  }

  return { warehouseIds, posProfileIds }
}

/** Add any missing user_warehouses rows (does not remove existing ones). */
export async function addUserWarehouses(tx: Tx, tenantId: string, userId: string, warehouseIds: string[]) {
  if (warehouseIds.length === 0) return
  const existing = await tx.select({ warehouseId: userWarehouses.warehouseId }).from(userWarehouses)
    .where(and(eq(userWarehouses.tenantId, tenantId), eq(userWarehouses.userId, userId)))
  const have = new Set(existing.map(e => e.warehouseId))
  const toAdd = warehouseIds.filter(id => !have.has(id))
  if (toAdd.length > 0) {
    await tx.insert(userWarehouses).values(toAdd.map(warehouseId => ({
      tenantId, userId, warehouseId, isActive: true,
    })))
  }
}

/**
 * Replace this user's POS counter assignments (other users' rows are untouched).
 * The default counter is `defaultPosProfileId` if given, else the first one.
 */
export async function replaceUserPosProfiles(
  tx: Tx,
  tenantId: string,
  userId: string,
  posProfileIds: string[],
  defaultPosProfileId?: string | null,
) {
  const ids = uniq(posProfileIds)
  if (defaultPosProfileId && !ids.includes(defaultPosProfileId)) {
    throw new StaffError('Default counter must be one of the assigned counters', 400)
  }
  await tx.delete(posProfileUsers)
    .where(and(eq(posProfileUsers.tenantId, tenantId), eq(posProfileUsers.userId, userId)))
  if (ids.length > 0) {
    const def = defaultPosProfileId || ids[0]
    await tx.insert(posProfileUsers).values(ids.map(posProfileId => ({
      tenantId, userId, posProfileId, isDefault: posProfileId === def,
    })))
  }
}

export interface CreateStaffInput {
  tenantId: string
  actorRole: string
  /** Login email; omitted → <name>@<tenant slug>.poslanka.local (made unique in the tenant) */
  email?: string | null
  fullName: string
  role: string
  /** Custom role (validated by the caller; `role` must be its base role) */
  customRoleId?: string | null
  /** Omitted → a readable password is generated and returned once as `generatedPassword` */
  password?: string | null
  pin?: string | null
  warehouseIds?: string[] | null
  posProfileIds?: string[] | null
}

export interface CreatedStaffUser {
  id: string
  email: string
  fullName: string
  role: string
  customRoleId: string | null
  isActive: boolean
  accountId: string | null
  hasPin: boolean
  createdAt: Date
  warehouseIds: string[]
  posProfileIds: string[]
  /** Only when no password was given */
  generatedPassword: string | null
}

/**
 * Create a staff user directly with a password (and optional PIN), plus branch
 * and counter assignments. Must run inside a tenant-scoped transaction (withTenant);
 * any thrown error rolls back the whole creation.
 */
export async function createStaffUser(tx: Tx, input: CreateStaffInput): Promise<CreatedStaffUser> {
  const { tenantId, actorRole, role } = input
  const fullName = input.fullName.trim()

  if (role === 'owner') {
    throw new StaffError('Owner role can only be assigned through account management', 400)
  }
  if (!canModifyUser(actorRole, role, role)) {
    throw new StaffError('You cannot create users with this role', 403)
  }
  if (!fullName) throw new StaffError('Full name is required', 400)
  const generatedPassword = input.password ? null : generateReadablePassword()
  const password = input.password || (generatedPassword as string)
  const pwError = validatePasswordStrength(password)
  if (pwError) throw new StaffError(pwError, 400)
  if (input.pin && !PIN_RE.test(input.pin)) throw new StaffError('PIN must be 4-6 digits', 400)

  // Email as given; a plain username becomes the shop's own login (cashier1@<slug>.poslanka.local);
  // nothing → one made from the name
  const given = input.email?.trim().toLowerCase()
  const email = given
    ? given.includes('@') ? given : placeholderLogin(given, await tenantSlug(tx, tenantId))
    : await freePlaceholderLogin(tx, tenantId, fullName)

  const dup = await tx.select({ id: users.id, isActive: users.isActive }).from(users)
    .where(and(eq(users.tenantId, tenantId), sql`lower(${users.email}) = ${email}`))
    .limit(1)
  if (dup.length > 0) {
    throw new StaffError(
      dup[0].isActive
        ? 'A user with this email already exists in this company'
        : 'A deactivated user with this email exists in this company — reactivate them instead',
      409,
    )
  }

  const assignments = await resolveStaffAssignments(tx, tenantId, role, input)

  // Link to a global account if one exists (its password is never changed here)
  const [account] = await tx.select({ id: accounts.id }).from(accounts)
    .where(sql`lower(${accounts.email}) = ${email}`).limit(1)

  const passwordHash = await bcrypt.hash(password, 12)
  const pinHash = input.pin ? await bcrypt.hash(input.pin, 12) : null
  const now = new Date()

  let created
  try {
    ;[created] = await tx.insert(users).values({
      tenantId,
      accountId: account?.id ?? null,
      email,
      fullName,
      passwordHash,
      pinHash,
      role: role as UserRoleValue,
      customRoleId: input.customRoleId || null,
      isActive: true,
      passwordChangedAt: now,
    }).returning({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      role: users.role,
      customRoleId: users.customRoleId,
      isActive: users.isActive,
      accountId: users.accountId,
      createdAt: users.createdAt,
    })
  } catch (err) {
    if ((err as { code?: string; cause?: { code?: string } })?.code === '23505'
      || (err as { cause?: { code?: string } })?.cause?.code === '23505') {
      throw new StaffError('A user with this email already exists in this company', 409)
    }
    throw err
  }

  await addUserWarehouses(tx, tenantId, created.id, assignments.warehouseIds)
  await replaceUserPosProfiles(tx, tenantId, created.id, assignments.posProfileIds)

  return {
    ...created,
    role: created.role as string,
    hasPin: !!pinHash,
    warehouseIds: assignments.warehouseIds,
    posProfileIds: assignments.posProfileIds,
    generatedPassword,
  }
}

/** First unused nimal.perera@<slug>.poslanka.local, nimal.perera2@…, … in this tenant */
async function tenantSlug(tx: Tx, tenantId: string): Promise<string> {
  const [t] = await tx.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, tenantId)).limit(1)
  if (!t) throw new StaffError('Business not found', 404)
  return t.slug
}

async function freePlaceholderLogin(tx: Tx, tenantId: string, fullName: string): Promise<string> {
  const t = { slug: await tenantSlug(tx, tenantId) }
  const local = loginLocalPart(fullName)
  const taken = new Set(
    (await tx.select({ email: users.email }).from(users)
      .where(and(eq(users.tenantId, tenantId), sql`lower(${users.email}) LIKE ${`${local}%@%`}`)))
      .map((r) => r.email.toLowerCase()),
  )
  for (let n = 1; ; n++) {
    const candidate = placeholderLogin(n === 1 ? local : `${local}${n}`, t.slug)
    if (!taken.has(candidate)) return candidate
  }
}

/**
 * Loads a custom role that may be assigned to staff: it must exist in this tenant (RLS) and be
 * active. Returns its base role, which becomes the user's built-in `role`.
 */
export async function loadAssignableCustomRole(tx: Tx, customRoleId: string) {
  const [cr] = await tx.select({ id: customRoles.id, name: customRoles.name, baseRole: customRoles.baseRole, isActive: customRoles.isActive })
    .from(customRoles).where(eq(customRoles.id, customRoleId)).limit(1)
  if (!cr) throw new StaffError('Custom role not found', 400)
  if (!cr.isActive) throw new StaffError('This custom role is inactive', 400)
  if (cr.baseRole === 'owner') throw new StaffError('Owner role can only be assigned through account management', 400)
  return cr
}
