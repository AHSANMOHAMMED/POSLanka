import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { getEntityConfig, getImportFields } from '@/lib/import-export/entity-config'
import { generateTemplate } from '@/lib/import-export/export-utils'
import { logError } from '@/lib/ai/error-logger'

export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const entityName = searchParams.get('entity')
    const format = (searchParams.get('format') || 'csv') as 'csv' | 'xlsx'
    const withSampleData = searchParams.get('withSampleData') !== 'false'

    if (!entityName) {
      return NextResponse.json({ error: 'Entity parameter is required' }, { status: 400 })
    }

    const entityConfig = getEntityConfig(entityName)
    if (!entityConfig) {
      return NextResponse.json({ error: `Unknown entity: ${entityName}` }, { status: 400 })
    }

    if (!entityConfig.importable) {
      return NextResponse.json({ error: `Import templates not available for: ${entityName}` }, { status: 400 })
    }

    // Check permission
    const permError = requirePermission(session, entityConfig.permission as Parameters<typeof requirePermission>[1])
    if (permError) return permError

    const businessType = session.user.businessType || undefined
    const importFields = getImportFields(entityConfig, businessType)
    const templateData = await generateTemplate(importFields, format, entityConfig.label, withSampleData)

    const dateStr = new Date().toISOString().split('T')[0]

    if (format === 'xlsx') {
      return new NextResponse(new Uint8Array(templateData as Buffer), {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${entityName}_template_${dateStr}.xlsx"`,
        },
      })
    }

    return new NextResponse(templateData as string, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${entityName}_template_${dateStr}.csv"`,
      },
    })
  } catch (error) {
    logError('api/export/template', error)
    return NextResponse.json({ error: 'Template generation failed' }, { status: 500 })
  }
}
