import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { workOrders, workOrderParts, workOrderServices, customers, vehicles } from '@/lib/db/schema'
import { eq, and, sql, gte, lte } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'

export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'viewReports')
    if (permError) return permError

    if (session.user.businessType !== 'auto_service' && session.user.businessType !== 'dealership') {
      return NextResponse.json({ error: 'This report is only available for service-capable businesses' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const fromDate = searchParams.get('fromDate')
    const toDate = searchParams.get('toDate')

    if (!fromDate || !toDate) {
      return NextResponse.json({ error: 'fromDate and toDate are required' }, { status: 400 })
    }

    return await withTenant(session.user.tenantId, async (db) => {
      // Get work orders with aggregated parts cost and services revenue
      const woData = await db.select({
        id: workOrders.id,
        orderNo: workOrders.orderNo,
        customerName: sql<string>`COALESCE(${workOrders.customerName}, ${customers.name}, 'Walk-in')`,
        vehicleDescription: sql<string>`COALESCE(${workOrders.vehicleDescription}, CONCAT(${vehicles.year}, ' ', ${vehicles.make}, ' ', ${vehicles.model}), '')`,
        vehiclePlate: sql<string>`COALESCE(${workOrders.vehiclePlate}, ${vehicles.licensePlate}, '')`,
        status: workOrders.status,
        total: workOrders.total,
        createdAt: workOrders.createdAt,
      })
        .from(workOrders)
        .leftJoin(customers, eq(workOrders.customerId, customers.id))
        .leftJoin(vehicles, eq(workOrders.vehicleId, vehicles.id))
        .where(and(
          eq(workOrders.tenantId, session.user.tenantId),
          gte(workOrders.createdAt, new Date(fromDate)),
          lte(workOrders.createdAt, new Date(toDate + 'T23:59:59')),
          sql`${workOrders.status} NOT IN ('draft', 'cancelled')`,
        ))
        .orderBy(sql`${workOrders.createdAt} DESC`)

      // Get parts cost per work order
      const partsCosts = await db.select({
        workOrderId: workOrderParts.workOrderId,
        totalPartsCost: sql<string>`COALESCE(SUM(CAST(${workOrderParts.total} AS numeric)), 0)`,
      })
        .from(workOrderParts)
        .innerJoin(workOrders, eq(workOrderParts.workOrderId, workOrders.id))
        .where(and(
          eq(workOrderParts.tenantId, session.user.tenantId),
          gte(workOrders.createdAt, new Date(fromDate)),
          lte(workOrders.createdAt, new Date(toDate + 'T23:59:59')),
          sql`${workOrders.status} NOT IN ('draft', 'cancelled')`,
        ))
        .groupBy(workOrderParts.workOrderId)

      // Get services revenue per work order
      const serviceRevenues = await db.select({
        workOrderId: workOrderServices.workOrderId,
        totalServiceRevenue: sql<string>`COALESCE(SUM(CAST(${workOrderServices.amount} AS numeric)), 0)`,
      })
        .from(workOrderServices)
        .innerJoin(workOrders, eq(workOrderServices.workOrderId, workOrders.id))
        .where(and(
          eq(workOrderServices.tenantId, session.user.tenantId),
          gte(workOrders.createdAt, new Date(fromDate)),
          lte(workOrders.createdAt, new Date(toDate + 'T23:59:59')),
          sql`${workOrders.status} NOT IN ('draft', 'cancelled')`,
        ))
        .groupBy(workOrderServices.workOrderId)

      // Build lookup maps
      const partsMap = new Map<string, number>()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const row of partsCosts as any[]) {
        partsMap.set(row.workOrderId, Number(row.totalPartsCost))
      }

      const servicesMap = new Map<string, number>()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const row of serviceRevenues as any[]) {
        servicesMap.set(row.workOrderId, Number(row.totalServiceRevenue))
      }

      let totalRevenue = 0
      let totalCost = 0

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = woData.map((wo: any) => {
        const totalBilled = Number(wo.total)
        const partsCost = partsMap.get(wo.id) || 0
        const laborRevenue = servicesMap.get(wo.id) || 0
        const profit = totalBilled - partsCost
        const margin = totalBilled > 0 ? (profit / totalBilled) * 100 : 0

        totalRevenue += totalBilled
        totalCost += partsCost

        const vehicleInfo = [wo.vehicleDescription, wo.vehiclePlate].filter(Boolean).join(' - ')

        return {
          id: wo.id,
          workOrderNo: wo.orderNo,
          customerName: wo.customerName,
          vehicleInfo: vehicleInfo || '-',
          status: wo.status,
          partsCost: Math.round(partsCost * 100) / 100,
          laborRevenue: Math.round(laborRevenue * 100) / 100,
          totalBilled: Math.round(totalBilled * 100) / 100,
          profit: Math.round(profit * 100) / 100,
          margin: Math.round(margin * 100) / 100,
        }
      })

      const totalProfit = totalRevenue - totalCost
      const avgMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0

      return NextResponse.json({
        summary: {
          totalRevenue: Math.round(totalRevenue * 100) / 100,
          totalCost: Math.round(totalCost * 100) / 100,
          totalProfit: Math.round(totalProfit * 100) / 100,
          avgMargin: Math.round(avgMargin * 100) / 100,
          jobCount: data.length,
        },
        data,
      })
    })
  } catch (error) {
    logError('api/reports/job-card-profitability', error)
    return NextResponse.json({ error: 'Failed to generate job card profitability report' }, { status: 500 })
  }
}
