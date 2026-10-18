import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { customers, customerCreditTransactions } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { customerCreditSchema } from '@/lib/validation/schemas/customers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { postCustomerCreditToGL } from '@/lib/accounting/auto-post'

// GET credit history for a customer
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id: customerId } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Get customer with balance (RLS scopes to tenant)
      const customer = await db.query.customers.findFirst({
        where: eq(customers.id, customerId),
      })

      if (!customer) {
        return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
      }

      // Get credit transactions (RLS scopes to tenant)
      const transactions = await db.query.customerCreditTransactions.findMany({
        where: eq(customerCreditTransactions.customerId, customerId),
        with: {
          createdByUser: true,
        },
        orderBy: [desc(customerCreditTransactions.createdAt)],
        limit: 50,
      })

      return NextResponse.json({
        customerId: customer.id,
        customerName: customer.name,
        balance: customer.balance,
        transactions: transactions.map(t => {
          const createdByUser = Array.isArray(t.createdByUser) ? t.createdByUser[0] : t.createdByUser
          return {
            id: t.id,
            type: t.type,
            amount: t.amount,
            balanceAfter: t.balanceAfter,
            referenceType: t.referenceType,
            referenceId: t.referenceId,
            notes: t.notes,
            createdBy: createdByUser?.fullName || null,
            createdAt: t.createdAt,
          }
        }),
      })
    })
  } catch (error) {
    logError('api/customers/[id]/credit', error)
    return NextResponse.json({ error: 'Failed to fetch credit history' }, { status: 500 })
  }
}

// POST add credit to customer
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageCustomerCredit')
    if (permError) return permError

    const quotaError = await requireQuota(session!.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id: customerId } = paramsParsed.data
    const parsed = await validateBody(request, customerCreditSchema)
    if (!parsed.success) return parsed.response
    const { amount, type, notes, referenceType, referenceId } = parsed.data

    const transactionAmount = amount

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      // Create transaction with row-level locking to prevent race conditions
      const result = await db.transaction(async (tx) => {
        // Lock customer row and get current balance (RLS scopes to tenant)
        const [customer] = await tx
          .select()
          .from(customers)
          .where(eq(customers.id, customerId))
          .for('update') // Row-level lock prevents concurrent balance modifications

        if (!customer) {
          throw new Error('Customer not found')
        }

        const currentBalance = parseFloat(customer.balance)

        // Calculate new balance based on type (using locked row's balance)
        let newBalance: number
        if (type === 'add' || type === 'refund' || type === 'overpayment') {
          newBalance = currentBalance + Math.abs(transactionAmount)
        } else if (type === 'use') {
          if (Math.abs(transactionAmount) > currentBalance) {
            throw new Error('Insufficient credit balance')
          }
          newBalance = currentBalance - Math.abs(transactionAmount)
        } else {
          // type === 'adjustment'
          newBalance = currentBalance + transactionAmount // Can be positive or negative
        }

        // Update customer balance
        await tx.update(customers)
          .set({
            balance: String(newBalance),
            updatedAt: new Date(),
          })
          .where(eq(customers.id, customerId))

        // Create credit transaction record
        const [transaction] = await tx.insert(customerCreditTransactions).values({
          tenantId: session!.user.tenantId,
          customerId,
          type,
          amount: String(Math.abs(transactionAmount)),
          balanceAfter: String(newBalance),
          referenceType,
          referenceId: referenceId || null,
          notes: notes || null,
          createdBy: session!.user.id,
        }).returning()

        // Post GL entry for manual credit operations
        try {
          await postCustomerCreditToGL(tx, session!.user.tenantId, {
            transactionId: transaction.id,
            customerId,
            type: type as 'add' | 'refund' | 'overpayment' | 'use' | 'adjustment',
            amount: transactionAmount,
            notes: notes || undefined,
          })
        } catch (glErr) {
          console.warn('[GL] Failed to post customer credit GL entry:', glErr)
        }

        return { transaction, newBalance }
      })

      // Broadcast the change
      logAndBroadcast(session!.user.tenantId, 'customer', 'updated', customerId)

      return NextResponse.json({
        transaction: result.transaction,
        newBalance: String(result.newBalance),
      })
    })
  } catch (error) {
    logError('api/customers/[id]/credit', error)
    const message = error instanceof Error ? error.message : 'Failed to add credit'
    // Return specific error messages for known errors
    if (message === 'Customer not found') {
      return NextResponse.json({ error: message }, { status: 404 })
    }
    if (message === 'Insufficient credit balance') {
      return NextResponse.json({ error: message }, { status: 400 })
    }
    return NextResponse.json({ error: 'Failed to add credit' }, { status: 500 })
  }
}
