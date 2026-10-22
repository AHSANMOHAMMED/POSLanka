import 'dotenv/config'
import pg from 'pg'
import { pgConnectionConfig } from './pg-connection.mjs'
import jwt from 'jsonwebtoken'

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'

async function run() {
  console.log('\n🖼️ Testing Logo Upload and Serving against ' + BASE_URL)
  const directUrl = (process.env.DATABASE_URL || '').replace('-pooler.', '.')
  const dbClient = new pg.Client({
    ...pgConnectionConfig(directUrl),
    statement_timeout: 10000,
    query_timeout: 10000,
  })
  await dbClient.connect()

  let adminUser = null
  let tenant = null

  try {
    const tenantRes = await dbClient.query('SELECT * FROM tenants WHERE slug = $1', ['demo-retail'])
    tenant = tenantRes.rows[0]
    const userRes = await dbClient.query('SELECT * FROM users WHERE tenant_id = $1 AND role = $2 LIMIT 1', [tenant.id, 'owner'])
    adminUser = userRes.rows[0]
  } finally {
    await dbClient.end()
  }

  const secret = process.env.NEXTAUTH_SECRET || 'development-secret-key-poslanka-2024'
  const adminToken = jwt.sign(
    {
      type: 'mobile',
      sub: adminUser.id,
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
      role: adminUser.role,
      email: adminUser.email,
    },
    secret,
    { expiresIn: '1h' }
  )

  // 1x1 transparent PNG in base64
  const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  const pngBuffer = Buffer.from(pngBase64, 'base64')

  const formData = new FormData()
  const blob = new Blob([pngBuffer], { type: 'image/png' })
  formData.append('logo', blob, 'test-logo.png')

  console.log('1. Uploading test logo to /api/settings/logo...')
  const uploadRes = await fetch(`${BASE_URL}/api/settings/logo`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
    body: formData,
  })

  const uploadData = await uploadRes.json()
  console.log('   Upload status:', uploadRes.status, 'Response:', uploadData)

  if (uploadRes.status !== 200 || !uploadData.logoUrl) {
    throw new Error(`Logo upload failed: ${JSON.stringify(uploadData)}`)
  }

  console.log('✅ Logo upload succeeded! URL:', uploadData.logoUrl)

  // Test fetching the uploaded logo
  const fetchLogoUrl = uploadData.logoUrl.startsWith('http')
    ? uploadData.logoUrl
    : `${BASE_URL}${uploadData.logoUrl}`

  console.log('2. Fetching uploaded logo from:', fetchLogoUrl)
  const getLogoRes = await fetch(fetchLogoUrl)
  console.log('   Fetch status:', getLogoRes.status, 'Content-Type:', getLogoRes.headers.get('content-type'))

  if (getLogoRes.status !== 200) {
    throw new Error(`Failed to fetch uploaded logo: status ${getLogoRes.status}`)
  }
  console.log('✅ Uploaded logo served successfully with HTTP 200 OK!')
}

run().catch((err) => {
  console.error('❌ Logo test failed:', err)
  process.exit(1)
})
