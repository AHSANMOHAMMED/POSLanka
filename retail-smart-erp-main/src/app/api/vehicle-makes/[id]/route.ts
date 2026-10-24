import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { vehicleMakes } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    const make = await db.query.vehicleMakes.findFirst({
      where: eq(vehicleMakes.id, id),
    })

    if (!make) {
      return NextResponse.json({ error: 'Vehicle make not found' }, { status: 404 })
    }

    return NextResponse.json(make)
  } catch (error) {
    logError('api/vehicle-makes/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch vehicle make' }, { status: 500 })
  }
}

export async function PUT(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Vehicle makes are one list shared by every business: a vendor may add new ones, but editing
  // or switching one off would change it for all vendors. Platform staff maintain the list.
  void params
  return NextResponse.json({ error: 'Vehicle makes are shared by all businesses and can only be changed by skyERPOS support. Add a new one instead.', code: 'SHARED_CATALOG' }, { status: 403 })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Vehicle makes are one list shared by every business: a vendor may add new ones, but editing
  // or switching one off would change it for all vendors. Platform staff maintain the list.
  void params
  return NextResponse.json({ error: 'Vehicle makes are shared by all businesses and can only be changed by skyERPOS support. Add a new one instead.', code: 'SHARED_CATALOG' }, { status: 403 })
}
