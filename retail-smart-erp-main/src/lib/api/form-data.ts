import { NextResponse } from 'next/server'

/**
 * Parse a multipart/form-data (or urlencoded) body. A request with another content type or a
 * malformed body gets a 400 instead of an unhandled exception (500).
 */
export async function readFormData(request: Request): Promise<FormData | NextResponse> {
  const type = request.headers.get('content-type') || ''
  if (!/multipart\/form-data|application\/x-www-form-urlencoded/i.test(type)) {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }
  try {
    return await request.formData()
  } catch {
    return NextResponse.json({ error: 'Malformed form data' }, { status: 400 })
  }
}
