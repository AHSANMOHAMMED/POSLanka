/**
 * Data Migration Script: Migrate to Multi-Warehouse System
 *
 * Run this AFTER the schema migration (0013_warehouses.sql) is applied.
 *
 * Usage: npx tsx scripts/migrate-warehouse-data.ts
 *
 * This script:
 * 1. Creates a default warehouse per tenant ("Main Warehouse", code: "MAIN")
 * 2. Migrates items.currentStock to warehouseStock for the default warehouse
 * 3. Assigns all existing users to the default warehouse
 * 4. Sets warehouseId on existing sales, work orders, purchases, held sales, estimates
 * 5. Creates POS profiles for cashiers/managers/owners with default warehouse
 */

import 'dotenv/config'
import { db } from '../src/lib/db'
import {
  tenants,
  users,
  warehouses,
  userWarehouses,
  warehouseStock,
  posProfiles,
  posProfileUsers,
  sales,
  workOrders,
  purchases,
  heldSales,
  insuranceEstimates,
  stockMovements,
} from '../src/lib/db/schema'
import { eq, sql, isNull, and } from 'drizzle-orm'

async function migrateToWarehouseSystem() {
  console.log('Starting warehouse system migration...\n')

  // Step 1: Create default warehouse for each tenant
  console.log('Step 1: Creating default warehouses for each tenant...')

  const allTenants = await db.select().from(tenants)
  let warehousesCreated = 0
  const tenantToWarehouseId: Record<string, string> = {}

  for (const tenant of allTenants) {
    // Check if tenant already has a default warehouse
    const existingWarehouse = await db.query.warehouses.findFirst({
      where: and(
        eq(warehouses.tenantId, tenant.id),
        eq(warehouses.isDefault, true)
      )
    })

    if (existingWarehouse) {
      tenantToWarehouseId[tenant.id] = existingWarehouse.id
      console.log(`  Tenant "${tenant.name}" already has default warehouse: ${existingWarehouse.name}`)
      continue
    }

    // Create default warehouse
    const [newWarehouse] = await db.insert(warehouses).values({
      tenantId: tenant.id,
      name: 'Main Warehouse',
      code: 'MAIN',
      address: tenant.address,
      phone: tenant.phone,
      email: tenant.email,
      isDefault: true,
      isActive: true,
    }).returning()

    tenantToWarehouseId[tenant.id] = newWarehouse.id
    warehousesCreated++
    console.log(`  Created default warehouse for tenant "${tenant.name}"`)
  }

  console.log(`  Total warehouses created: ${warehousesCreated}`)

  // Step 2: Migrate items.currentStock to warehouseStock
  console.log('\nStep 2: Migrating item stock to warehouse stock...')

  // Note: The items table still has currentStock column for backward compatibility
  // We need to copy the data to warehouseStock table
  const allItems = await db.execute(sql`
    SELECT id, tenant_id, current_stock, min_stock, reorder_qty, bin_location
    FROM items
    WHERE track_stock = true
  `)

  let stockRecordsCreated = 0

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const item of allItems.rows as any[]) {
    const warehouseId = tenantToWarehouseId[item.tenant_id]
    if (!warehouseId) {
      console.log(`  Warning: No warehouse found for tenant ${item.tenant_id}, skipping item ${item.id}`)
      continue
    }

    // Check if stock record already exists
    const existingStock = await db.query.warehouseStock.findFirst({
      where: and(
        eq(warehouseStock.warehouseId, warehouseId),
        eq(warehouseStock.itemId, item.id)
      )
    })

    if (existingStock) {
      continue
    }

    // Create warehouse stock record
    await db.insert(warehouseStock).values({
      tenantId: item.tenant_id,
      warehouseId: warehouseId,
      itemId: item.id,
      currentStock: item.current_stock || '0',
      minStock: item.min_stock || '0',
      reorderQty: item.reorder_qty,
      binLocation: item.bin_location,
    })

    stockRecordsCreated++
  }

  console.log(`  Migrated ${stockRecordsCreated} item stock records to warehouse stock`)

  // Step 3: Assign all users to default warehouse
  console.log('\nStep 3: Assigning users to default warehouses...')

  const allUsers = await db.select().from(users)
  let userAssignmentsCreated = 0

  for (const user of allUsers) {
    const warehouseId = tenantToWarehouseId[user.tenantId]
    if (!warehouseId) continue

    // Check if user already has warehouse assignment
    const existingAssignment = await db.query.userWarehouses.findFirst({
      where: and(
        eq(userWarehouses.userId, user.id),
        eq(userWarehouses.warehouseId, warehouseId)
      )
    })

    if (existingAssignment) continue

    // Create user-warehouse assignment
    await db.insert(userWarehouses).values({
      tenantId: user.tenantId,
      userId: user.id,
      warehouseId: warehouseId,
      isActive: true,
    })

    userAssignmentsCreated++
  }

  console.log(`  Assigned ${userAssignmentsCreated} users to warehouses`)

  // Step 4: Set warehouseId on existing records
  console.log('\nStep 4: Setting warehouseId on existing records...')

  // Update sales
  let salesUpdated = 0
  for (const tenant of allTenants) {
    const warehouseId = tenantToWarehouseId[tenant.id]
    if (!warehouseId) continue

    const result = await db.update(sales)
      .set({ warehouseId })
      .where(and(
        eq(sales.tenantId, tenant.id),
        isNull(sales.warehouseId)
      ))

    salesUpdated += result.rowCount || 0
  }
  console.log(`  Updated ${salesUpdated} sales records`)

  // Update work orders
  let workOrdersUpdated = 0
  for (const tenant of allTenants) {
    const warehouseId = tenantToWarehouseId[tenant.id]
    if (!warehouseId) continue

    const result = await db.update(workOrders)
      .set({ warehouseId })
      .where(and(
        eq(workOrders.tenantId, tenant.id),
        isNull(workOrders.warehouseId)
      ))

    workOrdersUpdated += result.rowCount || 0
  }
  console.log(`  Updated ${workOrdersUpdated} work order records`)

  // Update purchases
  let purchasesUpdated = 0
  for (const tenant of allTenants) {
    const warehouseId = tenantToWarehouseId[tenant.id]
    if (!warehouseId) continue

    const result = await db.update(purchases)
      .set({ warehouseId })
      .where(and(
        eq(purchases.tenantId, tenant.id),
        isNull(purchases.warehouseId)
      ))

    purchasesUpdated += result.rowCount || 0
  }
  console.log(`  Updated ${purchasesUpdated} purchase records`)

  // Update held sales
  let heldSalesUpdated = 0
  for (const tenant of allTenants) {
    const warehouseId = tenantToWarehouseId[tenant.id]
    if (!warehouseId) continue

    const result = await db.update(heldSales)
      .set({ warehouseId })
      .where(and(
        eq(heldSales.tenantId, tenant.id),
        isNull(heldSales.warehouseId)
      ))

    heldSalesUpdated += result.rowCount || 0
  }
  console.log(`  Updated ${heldSalesUpdated} held sale records`)

  // Update insurance estimates
  let estimatesUpdated = 0
  for (const tenant of allTenants) {
    const warehouseId = tenantToWarehouseId[tenant.id]
    if (!warehouseId) continue

    const result = await db.update(insuranceEstimates)
      .set({ warehouseId })
      .where(and(
        eq(insuranceEstimates.tenantId, tenant.id),
        isNull(insuranceEstimates.warehouseId)
      ))

    estimatesUpdated += result.rowCount || 0
  }
  console.log(`  Updated ${estimatesUpdated} insurance estimate records`)

  // Update stock movements
  let stockMovementsUpdated = 0
  for (const tenant of allTenants) {
    const warehouseId = tenantToWarehouseId[tenant.id]
    if (!warehouseId) continue

    const result = await db.update(stockMovements)
      .set({ warehouseId })
      .where(and(
        eq(stockMovements.tenantId, tenant.id),
        isNull(stockMovements.warehouseId)
      ))

    stockMovementsUpdated += result.rowCount || 0
  }
  console.log(`  Updated ${stockMovementsUpdated} stock movement records`)

  // Step 5: Create POS profiles for eligible users
  console.log('\nStep 5: Creating POS profiles...')

  const eligibleUsers = await db.select().from(users).where(
    sql`role IN ('owner', 'manager', 'cashier') AND is_active = true`
  )

  let posProfilesCreated = 0

  // Group users by tenant to create one profile per tenant
  const usersByTenant: Record<string, typeof eligibleUsers> = {}
  for (const user of eligibleUsers) {
    if (!usersByTenant[user.tenantId]) {
      usersByTenant[user.tenantId] = []
    }
    usersByTenant[user.tenantId].push(user)
  }

  for (const [tid, tenantUsers] of Object.entries(usersByTenant)) {
    const warehouseId = tenantToWarehouseId[tid]
    if (!warehouseId) continue

    // Check if default profile already exists for this tenant
    const existingProfile = await db.query.posProfiles.findFirst({
      where: and(
        eq(posProfiles.tenantId, tid),
        eq(posProfiles.isDefault, true)
      )
    })

    let profileId: string

    if (existingProfile) {
      profileId = existingProfile.id
    } else {
      // Create default POS profile for tenant
      const [newProfile] = await db.insert(posProfiles).values({
        tenantId: tid,
        name: 'Default Profile',
        warehouseId: warehouseId,
        isDefault: true,
        status: 'active',
      }).returning()
      profileId = newProfile.id
      posProfilesCreated++
    }

    // Assign all eligible users to the profile
    for (const user of tenantUsers) {
      // Check if user already assigned
      const existingAssignment = await db.query.posProfileUsers.findFirst({
        where: and(
          eq(posProfileUsers.posProfileId, profileId),
          eq(posProfileUsers.userId, user.id)
        )
      })

      if (!existingAssignment) {
        await db.insert(posProfileUsers).values({
          tenantId: tid,
          posProfileId: profileId,
          userId: user.id,
          isDefault: true,
        })
      }
    }
  }

  console.log(`  Created ${posProfilesCreated} POS profiles`)

  // Summary
  console.log('\n' + '='.repeat(50))
  console.log('Migration completed successfully!')
  console.log('='.repeat(50))
  console.log('\nSummary:')
  console.log(`  - Default warehouses created: ${warehousesCreated}`)
  console.log(`  - Stock records migrated: ${stockRecordsCreated}`)
  console.log(`  - User-warehouse assignments: ${userAssignmentsCreated}`)
  console.log(`  - Sales updated: ${salesUpdated}`)
  console.log(`  - Work orders updated: ${workOrdersUpdated}`)
  console.log(`  - Purchases updated: ${purchasesUpdated}`)
  console.log(`  - Held sales updated: ${heldSalesUpdated}`)
  console.log(`  - Insurance estimates updated: ${estimatesUpdated}`)
  console.log(`  - Stock movements updated: ${stockMovementsUpdated}`)
  console.log(`  - POS profiles created: ${posProfilesCreated}`)
  console.log('')
  console.log('Note: The items table still contains currentStock, minStock, reorderQty,')
  console.log('and binLocation columns for backward compatibility. These can be removed')
  console.log('in a future migration once all code is updated to use warehouseStock.')
}

// Run migration
migrateToWarehouseSystem()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Migration failed:', error)
    process.exit(1)
  })
