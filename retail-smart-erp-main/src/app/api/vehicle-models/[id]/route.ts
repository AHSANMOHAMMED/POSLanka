import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { vehicleModels } from '@/lib/db/schema'
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

    const model = await db.query.vehicleModels.findFirst({
      where: eq(vehicleModels.id, id),
      with: { make: true },
    })

    if (!model) {
      return NextResponse.json({ error: 'Vehicle model not found' }, { status: 404 })
    }

    return NextResponse.json(model)
  } catch (error) {
    logError('api/vehicle-models/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch vehicle model' }, { status: 500 })
  }
}

export async function PUT(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Vehicle models are one list shared by every business: a vendor may add new ones, but editing
  // or switching one off would change it for all vendors. Platform staff maintain the list.
  void params
  return NextResponse.json({ error: 'Vehicle models are shared by all businesses and can only be changed by skyERPOS support. Add a new one instead.', code: 'SHARED_CATALOG' }, { status: 403 })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Vehicle models are one list shared by every business: a vendor may add new ones, but editing
  // or switching one off would change it for all vendors. Platform staff maintain the list.
  void params
  return NextResponse.json({ error: 'Vehicle models are shared by all businesses and can only be changed by skyERPOS support. Add a new one instead.', code: 'SHARED_CATALOG' }, { status: 403 })
}
