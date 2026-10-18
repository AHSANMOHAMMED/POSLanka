/**
 * Data Migration Script: Migrate to Multi-Company Support
 *
 * Run this AFTER the schema migration (0009_tough_micromacro.sql) is applied.
 *
 * Usage: npx tsx scripts/migrate-to-multi-company.ts
 *
 * This script:
 * 1. Creates `accounts` from unique user emails (using most recent password)
 * 2. Links `users.accountId` to matching accounts
 * 3. Creates `accountTenants` records from existing users
 * 4. Sets `tenants.primaryOwnerId` from owner users
 * 5. Seeds `pricingTiers` with default tiers
 */

import 'dotenv/config'
import { db } from '../src/lib/db'
import {
  accounts,
  users,
  tenants,
  accountTenants,
  pricingTiers,
  subscriptions
} from '../src/lib/db/schema'
import { eq, sql, desc } from 'drizzle-orm'

async function migrateToMultiCompany() {
  console.log('Starting multi-company migration...\n')

  // Step 1: Seed pricing tiers
  console.log('Step 1: Seeding pricing tiers...')
  const existingTiers = await db.select().from(pricingTiers)

  if (existingTiers.length === 0) {
    await db.insert(pricingTiers).values([
      {
        name: 'trial',
        displayName: 'Free Trial',
        priceMonthly: '0.00',
        priceYearly: '0.00',
        maxUsers: 2,
        maxSalesMonthly: 100,
        features: {
          basicPOS: true,
          inventory: true,
          reports: false,
          multiLocation: false,
        },
        sortOrder: 0,
      },
      {
        name: 'starter',
        displayName: 'Starter',
        priceMonthly: '19.00',
        priceYearly: '190.00',
        maxUsers: 5,
        maxSalesMonthly: 1000,
        features: {
          basicPOS: true,
          inventory: true,
          reports: true,
          multiLocation: false,
          workOrders: true,
        },
        sortOrder: 1,
      },
      {
        name: 'pro',
        displayName: 'Professional',
        priceMonthly: '49.00',
        priceYearly: '490.00',
        maxUsers: null, // Unlimited
        maxSalesMonthly: null, // Unlimited
        features: {
          basicPOS: true,
          inventory: true,
          reports: true,
          multiLocation: true,
          workOrders: true,
          insuranceEstimates: true,
          advancedReports: true,
        },
        sortOrder: 2,
      },
    ])
    console.log('  Created 3 pricing tiers: Trial, Starter, Pro')
  } else {
    console.log('  Pricing tiers already exist, skipping...')
  }

  // Step 2: Get all existing users grouped by email
  console.log('\nStep 2: Creating accounts from users...')

  // Get unique emails with the most recent user data
  const uniqueEmails = await db.execute(sql`
    SELECT DISTINCT ON (LOWER(email))
      id, email, password_hash, full_name, tenant_id, role, created_at
    FROM users
    WHERE is_active = true
    ORDER BY LOWER(email), created_at DESC
  `)

  let accountsCreated = 0
  const emailToAccountId: Record<string, string> = {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const user of uniqueEmails.rows as any[]) {
    const email = user.email.toLowerCase()

    // Check if account already exists
    const existingAccount = await db.query.accounts.findFirst({
      where: eq(accounts.email, email)
    })

    if (existingAccount) {
      emailToAccountId[email] = existingAccount.id
      continue
    }

    // Create new account
    const [newAccount] = await db.insert(accounts).values({
      email: email,
      passwordHash: user.password_hash,
      fullName: user.full_name,
      phone: user.phone || `MIGRATE_${email}`,
    }).returning()

    emailToAccountId[email] = newAccount.id
    accountsCreated++
  }

  console.log(`  Created ${accountsCreated} new accounts`)

  // Step 3: Link users to accounts
  console.log('\nStep 3: Linking users to accounts...')

  const allUsers = await db.select().from(users)
  let usersLinked = 0

  for (const user of allUsers) {
    const accountId = emailToAccountId[user.email.toLowerCase()]
    if (accountId && !user.accountId) {
      await db.update(users)
        .set({ accountId })
        .where(eq(users.id, user.id))
      usersLinked++
    }
  }

  console.log(`  Linked ${usersLinked} users to accounts`)

  // Step 4: Create accountTenants records
  console.log('\nStep 4: Creating account-tenant memberships...')

  const usersWithAccounts = await db.select().from(users).where(sql`account_id IS NOT NULL`)
  let membershipsCreated = 0

  for (const user of usersWithAccounts) {
    // Check if membership already exists
    const existingMembership = await db.query.accountTenants.findFirst({
      where: sql`account_id = ${user.accountId} AND tenant_id = ${user.tenantId}`
    })

    if (!existingMembership) {
      await db.insert(accountTenants).values({
        accountId: user.accountId!,
        tenantId: user.tenantId,
        role: user.role,
        isOwner: user.role === 'owner',
        isActive: user.isActive,
        acceptedAt: user.createdAt,
      })
      membershipsCreated++
    }
  }

  console.log(`  Created ${membershipsCreated} account-tenant memberships`)

  // Step 5: Set tenant primaryOwnerId
  console.log('\nStep 5: Setting tenant primary owners...')

  const allTenants = await db.select().from(tenants)
  let ownersSet = 0

  for (const tenant of allTenants) {
    if (tenant.primaryOwnerId) continue

    // Find the owner user for this tenant
    const ownerUser = await db.query.users.findFirst({
      where: sql`tenant_id = ${tenant.id} AND role = 'owner' AND account_id IS NOT NULL`,
      orderBy: [desc(users.createdAt)]
    })

    if (ownerUser?.accountId) {
      await db.update(tenants)
        .set({ primaryOwnerId: ownerUser.accountId })
        .where(eq(tenants.id, tenant.id))
      ownersSet++
    }
  }

  console.log(`  Set primary owner for ${ownersSet} tenants`)

  // Step 6: Create subscriptions for existing tenants
  console.log('\nStep 6: Creating subscriptions for existing tenants...')

  const trialTier = await db.query.pricingTiers.findFirst({
    where: eq(pricingTiers.name, 'trial')
  })

  if (trialTier) {
    let subscriptionsCreated = 0

    for (const tenant of allTenants) {
      // Check if subscription already exists
      const existingSub = await db.query.subscriptions.findFirst({
        where: eq(subscriptions.tenantId, tenant.id)
      })

      if (!existingSub && tenant.primaryOwnerId) {
        const trialEnds = new Date()
        trialEnds.setDate(trialEnds.getDate() + 14) // 14-day trial

        await db.insert(subscriptions).values({
          tenantId: tenant.id,
          billingAccountId: tenant.primaryOwnerId,
          tierId: trialTier.id,
          status: 'trial',
          trialEndsAt: trialEnds,
        })
        subscriptionsCreated++
      }
    }

    console.log(`  Created ${subscriptionsCreated} subscriptions`)
  }

  console.log('\n✅ Migration completed successfully!')
  console.log('\nSummary:')
  console.log(`  - Accounts created: ${accountsCreated}`)
  console.log(`  - Users linked: ${usersLinked}`)
  console.log(`  - Memberships created: ${membershipsCreated}`)
  console.log(`  - Primary owners set: ${ownersSet}`)
}

// Run migration
migrateToMultiCompany()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Migration failed:', error)
    process.exit(1)
  })
