// Cascade delete all tenant data in FK-safe order
// Shared between company DELETE route and enforce-subscriptions cron

import { db } from '@/lib/db'
import {
  tenants, accountTenants, subscriptions, users, tenantUsage,
  inspectionPhotos, inspectionDamageMarks, inspectionResponses, vehicleInspections,
  inspectionChecklistItems, inspectionCategories, inspectionTemplates,
  insuranceEstimateAttachments, insuranceEstimateRevisions, insuranceEstimateItems, insuranceEstimates,
  insuranceAssessors, insuranceCompanies,
  activityLogs, estimateTemplates,
  commissions, commissionRates, commissionPayouts,
  loyaltyTransactions, loyaltyTiers, giftCardTransactions, giftCards,
  layawayPayments, layawayItems, layaways,
  reservations, kitchenOrderItems, kitchenOrders, restaurantOrderItems, restaurantOrders,
  modifiers, modifierGroups, restaurantTables,
  dayEndSessions,
  purchaseItems, purchases, suppliers,
  heldSales,
  payments, saleItems, sales,
  workOrderAssignmentHistory, workOrderParts, workOrderServices, workOrders,
  coreReturns,
  vehicleOwnershipHistory, vehicles, vehicleTypeDiagramViews, vehicleTypes,
  appointments,
  laborGuides, serviceTypes, serviceTypeGroups,
  partCompatibility, stockMovements, items, categories,
  customerCreditTransactions, customers,
  settings,
  lockoutEvents, storageAlerts,
} from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'

export async function cascadeDeleteTenant(tenantId: string): Promise<void> {
  await db.transaction(async (tx) => {
    // 1. Inspection data
    await tx.delete(inspectionPhotos).where(
      sql`${inspectionPhotos.inspectionId} IN (SELECT id FROM ${vehicleInspections} WHERE tenant_id = ${tenantId})`
    )
    await tx.delete(inspectionDamageMarks).where(
      sql`${inspectionDamageMarks.inspectionId} IN (SELECT id FROM ${vehicleInspections} WHERE tenant_id = ${tenantId})`
    )
    await tx.delete(inspectionResponses).where(
      sql`${inspectionResponses.inspectionId} IN (SELECT id FROM ${vehicleInspections} WHERE tenant_id = ${tenantId})`
    )
    await tx.delete(vehicleInspections).where(eq(vehicleInspections.tenantId, tenantId))
    await tx.delete(inspectionChecklistItems).where(
      sql`${inspectionChecklistItems.categoryId} IN (SELECT id FROM ${inspectionCategories} WHERE template_id IN (SELECT id FROM ${inspectionTemplates} WHERE tenant_id = ${tenantId}))`
    )
    await tx.delete(inspectionCategories).where(
      sql`${inspectionCategories.templateId} IN (SELECT id FROM ${inspectionTemplates} WHERE tenant_id = ${tenantId})`
    )
    await tx.delete(inspectionTemplates).where(eq(inspectionTemplates.tenantId, tenantId))

    // 2. Insurance estimates
    await tx.delete(insuranceEstimateAttachments).where(eq(insuranceEstimateAttachments.tenantId, tenantId))
    await tx.delete(insuranceEstimateRevisions).where(eq(insuranceEstimateRevisions.tenantId, tenantId))
    await tx.delete(insuranceEstimateItems).where(eq(insuranceEstimateItems.tenantId, tenantId))
    await tx.delete(insuranceEstimates).where(eq(insuranceEstimates.tenantId, tenantId))
    await tx.delete(insuranceAssessors).where(eq(insuranceAssessors.tenantId, tenantId))
    await tx.delete(insuranceCompanies).where(eq(insuranceCompanies.tenantId, tenantId))

    // 3. Activity logs & templates
    await tx.delete(activityLogs).where(eq(activityLogs.tenantId, tenantId))
    await tx.delete(estimateTemplates).where(eq(estimateTemplates.tenantId, tenantId))

    // 4. Commissions
    await tx.delete(commissions).where(eq(commissions.tenantId, tenantId))
    await tx.delete(commissionRates).where(eq(commissionRates.tenantId, tenantId))
    await tx.delete(commissionPayouts).where(eq(commissionPayouts.tenantId, tenantId))

    // 5. Loyalty & Gift cards
    await tx.delete(loyaltyTransactions).where(eq(loyaltyTransactions.tenantId, tenantId))
    await tx.delete(loyaltyTiers).where(eq(loyaltyTiers.tenantId, tenantId))
    await tx.delete(giftCardTransactions).where(eq(giftCardTransactions.tenantId, tenantId))
    await tx.delete(giftCards).where(eq(giftCards.tenantId, tenantId))

    // 6. Layaways
    await tx.delete(layawayPayments).where(eq(layawayPayments.tenantId, tenantId))
    await tx.delete(layawayItems).where(eq(layawayItems.tenantId, tenantId))
    await tx.delete(layaways).where(eq(layaways.tenantId, tenantId))

    // 7. Restaurant data
    await tx.delete(reservations).where(eq(reservations.tenantId, tenantId))
    await tx.delete(kitchenOrderItems).where(eq(kitchenOrderItems.tenantId, tenantId))
    await tx.delete(kitchenOrders).where(eq(kitchenOrders.tenantId, tenantId))
    await tx.delete(restaurantOrderItems).where(eq(restaurantOrderItems.tenantId, tenantId))
    await tx.delete(restaurantOrders).where(eq(restaurantOrders.tenantId, tenantId))
    await tx.delete(modifiers).where(eq(modifiers.tenantId, tenantId))
    await tx.delete(modifierGroups).where(eq(modifierGroups.tenantId, tenantId))
    await tx.delete(restaurantTables).where(eq(restaurantTables.tenantId, tenantId))

    // 8. Day end sessions
    await tx.delete(dayEndSessions).where(eq(dayEndSessions.tenantId, tenantId))

    // 9. Purchases & Suppliers
    await tx.delete(purchaseItems).where(eq(purchaseItems.tenantId, tenantId))
    await tx.delete(purchases).where(eq(purchases.tenantId, tenantId))
    await tx.delete(suppliers).where(eq(suppliers.tenantId, tenantId))

    // 10. Held sales
    await tx.delete(heldSales).where(eq(heldSales.tenantId, tenantId))

    // 11. Payments, sale items, sales
    await tx.delete(payments).where(eq(payments.tenantId, tenantId))
    await tx.delete(saleItems).where(eq(saleItems.tenantId, tenantId))
    await tx.delete(sales).where(eq(sales.tenantId, tenantId))

    // 12. Work order data
    await tx.delete(workOrderAssignmentHistory).where(eq(workOrderAssignmentHistory.tenantId, tenantId))
    await tx.delete(workOrderParts).where(eq(workOrderParts.tenantId, tenantId))
    await tx.delete(workOrderServices).where(eq(workOrderServices.tenantId, tenantId))
    await tx.delete(workOrders).where(eq(workOrders.tenantId, tenantId))

    // 13. Core returns
    await tx.delete(coreReturns).where(eq(coreReturns.tenantId, tenantId))

    // 14. Vehicles
    await tx.delete(vehicleOwnershipHistory).where(eq(vehicleOwnershipHistory.tenantId, tenantId))
    await tx.delete(vehicles).where(eq(vehicles.tenantId, tenantId))
    await tx.delete(vehicleTypeDiagramViews).where(
      sql`${vehicleTypeDiagramViews.vehicleTypeId} IN (SELECT id FROM ${vehicleTypes} WHERE tenant_id = ${tenantId})`
    )
    await tx.delete(vehicleTypes).where(eq(vehicleTypes.tenantId, tenantId))

    // 15. Appointments
    await tx.delete(appointments).where(eq(appointments.tenantId, tenantId))

    // 16. Services
    await tx.delete(laborGuides).where(eq(laborGuides.tenantId, tenantId))
    await tx.delete(serviceTypes).where(eq(serviceTypes.tenantId, tenantId))
    await tx.delete(serviceTypeGroups).where(eq(serviceTypeGroups.tenantId, tenantId))

    // 17. Items & Categories
    await tx.delete(partCompatibility).where(eq(partCompatibility.tenantId, tenantId))
    await tx.delete(stockMovements).where(eq(stockMovements.tenantId, tenantId))
    await tx.delete(items).where(eq(items.tenantId, tenantId))
    await tx.delete(categories).where(eq(categories.tenantId, tenantId))

    // 18. Customers
    await tx.delete(customerCreditTransactions).where(eq(customerCreditTransactions.tenantId, tenantId))
    await tx.delete(customers).where(eq(customers.tenantId, tenantId))

    // 19. Settings
    await tx.delete(settings).where(eq(settings.tenantId, tenantId))

    // 20. Storage alerts & lockout events
    await tx.delete(storageAlerts).where(eq(storageAlerts.tenantId, tenantId))
    await tx.delete(lockoutEvents).where(eq(lockoutEvents.tenantId, tenantId))

    // 21. Users
    await tx.delete(users).where(eq(users.tenantId, tenantId))

    // 22. Tenant usage
    await tx.delete(tenantUsage).where(eq(tenantUsage.tenantId, tenantId))

    // 23. PayHere transactions referencing subscriptions (clear subscription_id)
    await tx.execute(sql`UPDATE payhere_transactions SET subscription_id = NULL WHERE subscription_id IN (SELECT id FROM subscriptions WHERE tenant_id = ${tenantId})`)

    // 24. Subscriptions
    await tx.delete(subscriptions).where(eq(subscriptions.tenantId, tenantId))

    // 25. Account-tenant memberships
    await tx.delete(accountTenants).where(eq(accountTenants.tenantId, tenantId))

    // 26. Finally delete the tenant
    await tx.delete(tenants).where(eq(tenants.id, tenantId))
  })
}
