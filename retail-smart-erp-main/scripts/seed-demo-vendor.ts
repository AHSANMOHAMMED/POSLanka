import dotenv from 'dotenv'
import pg from 'pg'
import bcrypt from 'bcryptjs'

dotenv.config({ path: '.env.local' })
dotenv.config()

const { Pool } = pg

async function seedDemoVendor() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error('DATABASE_URL is not set')
    process.exit(1)
  }

  const pool = new Pool({
    connectionString,
    ssl: connectionString.includes('sslmode=disable') ? false : (connectionString.includes('localhost') || connectionString.includes('127.0.0.1') ? false : { rejectUnauthorized: false }),
  })

  console.log('Seeding demo vendor for POSLanka...')

  try {
    // 1. Check or create tenant
    const slug = 'demo-retail'
    let tenantResult = await pool.query('SELECT * FROM tenants WHERE slug = $1', [slug])
    let tenantId: string

    const defaultFlags = {
      accounting: true,
      purchase: true,
      credit_customer: true,
      loyalty: true,
      multi_warehouse: true,
      advanced_reports: true,
      whatsapp: true,
      quotation: true,
    }

    const settingsObj = {
      tin: '102938475-7000',
      brn: 'PV-99482',
      lankaQrMid: 'MID-LK-77401',
      payhereMerchantId: '1210001',
      featureFlags: defaultFlags,
    }

    if (tenantResult.rows.length === 0) {
      const insertTenant = await pool.query(
        `
        INSERT INTO tenants (
          name, slug, email, phone, address, business_type, country, currency,
          plan, status, settings
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
        ) RETURNING id
      `,
        [
          'Lanka Smart Supermarket & Retail',
          slug,
          'contact@demo.poslanka.lk',
          '+94 11 234 5678',
          'No. 42, Galle Road, Colombo 03, Sri Lanka',
          'supermarket',
          'LK',
          'LKR',
          'premium',
          'active',
          JSON.stringify(settingsObj),
        ]
      )
      tenantId = insertTenant.rows[0].id
      console.log('Created tenant:', slug, tenantId)
    } else {
      tenantId = tenantResult.rows[0].id
      await pool.query(
        `UPDATE tenants SET settings = $1, status = 'active', plan = 'premium' WHERE id = $2`,
        [JSON.stringify(settingsObj), tenantId]
      )
      console.log('Found existing tenant:', slug, tenantId)
    }

    // 2. Create Default Warehouse
    let whResult = await pool.query('SELECT id FROM warehouses WHERE tenant_id = $1 AND code = $2', [
      tenantId,
      'MAIN',
    ])
    let warehouseId: string
    if (whResult.rows.length === 0) {
      const whInsert = await pool.query(
        `
        INSERT INTO warehouses (tenant_id, name, code, address, is_default, is_active)
        VALUES ($1, $2, $3, $4, true, true)
        RETURNING id
      `,
        [tenantId, 'Colombo Central Main Store', 'MAIN', 'No. 42, Galle Road, Colombo 03']
      )
      warehouseId = whInsert.rows[0].id
      console.log('Created main warehouse:', warehouseId)
    } else {
      warehouseId = whResult.rows[0].id
    }

    // 3. Create Default POS Profile
    let posResult = await pool.query('SELECT id FROM pos_profiles WHERE tenant_id = $1 AND code = $2', [
      tenantId,
      'TILL-01',
    ])
    let posProfileId: string
    if (posResult.rows.length === 0) {
      const posInsert = await pool.query(
        `
        INSERT INTO pos_profiles (
          tenant_id, name, code, is_default, warehouse_id,
          allow_rate_change, allow_discount_change, allow_credit_sale, status
        ) VALUES (
          $1, $2, $3, true, $4, true, true, true, 'active'
        ) RETURNING id
      `,
        [tenantId, 'Express Checkout Counter 01', 'TILL-01', warehouseId]
      )
      posProfileId = posInsert.rows[0].id
      console.log('Created POS Profile:', posProfileId)
    } else {
      posProfileId = posResult.rows[0].id
    }

    // 4. Create Account and Users (Admin & Cashier)
    const adminPassHash = await bcrypt.hash('Admin@123456', 10)
    const cashierPassHash = await bcrypt.hash('Cashier@123456', 10)
    const adminPinHash = await bcrypt.hash('1234', 10)
    const cashierPinHash = await bcrypt.hash('5678', 10)

    // Admin account
    let adminAccount = await pool.query('SELECT id FROM accounts WHERE email = $1', [
      'admin@demo.poslanka.lk',
    ])
    let adminAccountId: string
    if (adminAccount.rows.length === 0) {
      const acc = await pool.query(
        `
        INSERT INTO accounts (email, full_name, password_hash, email_verified, phone)
        VALUES ($1, $2, $3, true, $4)
        RETURNING id
      `,
        ['admin@demo.poslanka.lk', 'Nimal Perera (Store Director)', adminPassHash, '+94 77 123 4567']
      )
      adminAccountId = acc.rows[0].id
    } else {
      adminAccountId = adminAccount.rows[0].id
    }

    // Admin user in tenant
    let adminUserId: string
    const existingAdminUser = await pool.query(
      'SELECT id FROM users WHERE tenant_id = $1 AND lower(email) = lower($2)',
      [tenantId, 'admin@demo.poslanka.lk']
    )
    if (existingAdminUser.rows.length === 0) {
      const res = await pool.query(
        `
        INSERT INTO users (
          tenant_id, account_id, email, full_name, role, pin_hash, password_hash, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, true)
        RETURNING id
      `,
        [
          tenantId,
          adminAccountId,
          'admin@demo.poslanka.lk',
          'Nimal Perera',
          'owner',
          adminPinHash,
          adminPassHash,
        ]
      )
      adminUserId = res.rows[0].id
    } else {
      adminUserId = existingAdminUser.rows[0].id
      await pool.query(
        `UPDATE users SET password_hash = $1, pin_hash = $2, role = 'owner', is_active = true WHERE id = $3`,
        [adminPassHash, adminPinHash, adminUserId]
      )
    }

    // Cashier user in tenant
    let cashierUserId: string
    const existingCashierUser = await pool.query(
      'SELECT id FROM users WHERE tenant_id = $1 AND lower(email) = lower($2)',
      [tenantId, 'cashier@demo.poslanka.lk']
    )
    if (existingCashierUser.rows.length === 0) {
      const res = await pool.query(
        `
        INSERT INTO users (
          tenant_id, email, full_name, role, pin_hash, password_hash, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, true)
        RETURNING id
      `,
        [
          tenantId,
          'cashier@demo.poslanka.lk',
          'Kavindi Silva (Lead Cashier)',
          'cashier',
          cashierPinHash,
          cashierPassHash,
        ]
      )
      cashierUserId = res.rows[0].id
    } else {
      cashierUserId = existingCashierUser.rows[0].id
      await pool.query(
        `UPDATE users SET password_hash = $1, pin_hash = $2, role = 'cashier', is_active = true WHERE id = $3`,
        [cashierPassHash, cashierPinHash, cashierUserId]
      )
    }

    // Link account to tenant
    const existingAT = await pool.query(
      'SELECT id FROM account_tenants WHERE account_id = $1 AND tenant_id = $2',
      [adminAccountId, tenantId]
    )
    if (existingAT.rows.length === 0) {
      await pool.query(
        `
        INSERT INTO account_tenants (account_id, tenant_id, role, is_owner, is_active)
        VALUES ($1, $2, 'owner', true, true)
      `,
        [adminAccountId, tenantId]
      )
    }

    // Assign both users to the POS profile
    for (const uid of [adminUserId, cashierUserId]) {
      const assigned = await pool.query(
        'SELECT id FROM pos_profile_users WHERE pos_profile_id = $1 AND user_id = $2',
        [posProfileId, uid]
      )
      if (assigned.rows.length === 0) {
        await pool.query(
          `INSERT INTO pos_profile_users (tenant_id, pos_profile_id, user_id, is_default)
           VALUES ($1, $2, $3, true)`,
          [tenantId, posProfileId, uid]
        )
      }
    }
    console.log('Admin and Cashier users seeded and assigned to POS profile.')

    // 5. Seed Categories
    const categoriesData = [
      'Beverages',
      'Dairy & Chilled',
      'Bakery & Biscuits',
      'Grains & Staples',
      'Household & Personal',
    ]

    const catMap: Record<string, string> = {}
    for (const name of categoriesData) {
      let cat = await pool.query('SELECT id FROM categories WHERE tenant_id = $1 AND name = $2', [
        tenantId,
        name,
      ])
      if (cat.rows.length === 0) {
        const res = await pool.query(
          `
          INSERT INTO categories (tenant_id, name, is_active)
          VALUES ($1, $2, true)
          RETURNING id
        `,
          [tenantId, name]
        )
        catMap[name] = res.rows[0].id
      } else {
        catMap[name] = cat.rows[0].id
      }
    }

    // 6. Seed Items & Stock
    const demoItems = [
      {
        name: 'Munchee Super Cream Cracker 490g',
        sku: 'MCH-SCC-490',
        barcode: '4791012345671',
        itemCode: 'ITM-000001',
        cost: 410,
        price: 480,
        category: 'Bakery & Biscuits',
        stock: 150,
      },
      {
        name: 'Dilmah Premium Ceylon Tea 400g',
        sku: 'DLM-TEA-400',
        barcode: '4791012345672',
        itemCode: 'ITM-000002',
        cost: 780,
        price: 950,
        category: 'Beverages',
        stock: 85,
      },
      {
        name: 'Highland Full Cream Milk Powder 400g',
        sku: 'HLD-MILK-400',
        barcode: '4791012345673',
        itemCode: 'ITM-000003',
        cost: 980,
        price: 1120,
        category: 'Dairy & Chilled',
        stock: 60,
      },
      {
        name: 'Anchor Salted Butter 227g',
        sku: 'ANC-BUT-227',
        barcode: '4791012345674',
        itemCode: 'ITM-000004',
        cost: 750,
        price: 890,
        category: 'Dairy & Chilled',
        stock: 45,
      },
      {
        name: 'Keells Keeri Samba Rice 5kg',
        sku: 'KEE-SMB-5KG',
        barcode: '4791012345675',
        itemCode: 'ITM-000005',
        cost: 1280,
        price: 1450,
        category: 'Grains & Staples',
        stock: 90,
      },
      {
        name: 'Maliban Smart Cream Cracker 500g',
        sku: 'MLB-SCC-500',
        barcode: '4791012345676',
        itemCode: 'ITM-000006',
        cost: 420,
        price: 490,
        category: 'Bakery & Biscuits',
        stock: 110,
      },
      {
        name: 'Elephant House Cream Soda 1.5L',
        sku: 'EH-CS-15L',
        barcode: '4791012345677',
        itemCode: 'ITM-000007',
        cost: 290,
        price: 360,
        category: 'Beverages',
        stock: 120,
      },
      {
        name: 'Kotmale Fresh Milk 1L',
        sku: 'KTM-FM-1L',
        barcode: '4791012345678',
        itemCode: 'ITM-000008',
        cost: 370,
        price: 450,
        category: 'Dairy & Chilled',
        stock: 80,
      },
      {
        name: 'Sunlight Lemon Laundry Bar 115g',
        sku: 'SUN-SOAP-115',
        barcode: '4791012345679',
        itemCode: 'ITM-000009',
        cost: 115,
        price: 140,
        category: 'Household & Personal',
        stock: 200,
      },
    ]

    for (const item of demoItems) {
      let itemRecord = await pool.query('SELECT id FROM items WHERE tenant_id = $1 AND sku = $2', [
        tenantId,
        item.sku,
      ])
      let itemId: string

      if (itemRecord.rows.length === 0) {
        const itemRes = await pool.query(
          `
          INSERT INTO items (
            tenant_id, name, sku, barcode, item_code, cost_price, selling_price,
            category_id, track_stock, is_active
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, true, true
          ) RETURNING id
        `,
          [
            tenantId,
            item.name,
            item.sku,
            item.barcode,
            item.itemCode,
            item.cost,
            item.price,
            catMap[item.category],
          ]
        )
        itemId = itemRes.rows[0].id
      } else {
        itemId = itemRecord.rows[0].id
        await pool.query(
          `UPDATE items SET name = $1, selling_price = $2, cost_price = $3, barcode = $4 WHERE id = $5`,
          [item.name, item.price, item.cost, item.barcode, itemId]
        )
      }

      await pool.query(
        `
        INSERT INTO warehouse_stock (tenant_id, warehouse_id, item_id, current_stock)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (warehouse_id, item_id, tenant_id) DO UPDATE SET current_stock = $4
      `,
        [tenantId, warehouseId, itemId, item.stock]
      )
    }
    console.log(`Seeded ${demoItems.length} products with warehouse stock.`)

    // 7. Seed Initial Sample Completed Sales for Analytics
    const existingSales = await pool.query('SELECT count(*) FROM sales WHERE tenant_id = $1', [
      tenantId,
    ])
    if (parseInt(existingSales.rows[0].count) === 0) {
      console.log('Seeding sample sales for dashboard metrics...')

      for (let i = 1; i <= 8; i++) {
        const saleTotal = 1500 + i * 420
        const invNo = `INV-2026-${1000 + i}`
        const method = i % 2 === 0 ? 'cash' : 'card'
        const saleRes = await pool.query(
          `
          INSERT INTO sales (
            tenant_id, warehouse_id, invoice_no, subtotal, tax_amount,
            discount_amount, total, paid_amount, status, payment_method, created_by
          ) VALUES (
            $1, $2, $3, $4, 0, 0, $4, $4, 'completed', $5, $6
          ) RETURNING id
        `,
          [tenantId, warehouseId, invNo, saleTotal, method, cashierUserId || adminUserId]
        )
        const saleId = saleRes.rows[0].id

        // Insert payment
        await pool.query(
          `
          INSERT INTO payments (
            tenant_id, sale_id, amount, method, received_by
          ) VALUES ($1, $2, $3, $4, $5)
        `,
          [tenantId, saleId, saleTotal, method, cashierUserId || adminUserId]
        )
      }
      console.log('Sample sales generated successfully.')
    }

    console.log('\n======================================================')
    console.log('✅ DEMO VENDOR SEED COMPLETE!')
    console.log('------------------------------------------------------')
    console.log('Tenant Slug:       demo-retail')
    console.log('Super Admin:       superadmin@poslanka.lk / Admin@123456')
    console.log('Vendor Admin:      admin@demo.poslanka.lk / Admin@123456 (PIN: 1234)')
    console.log('Vendor Cashier:    cashier@demo.poslanka.lk / Cashier@123456 (PIN: 5678)')
    console.log('POS Terminal URL:  /c/demo-retail/pos')
    console.log('Customer Display:  /c/demo-retail/pos/display')
    console.log('Kitchen Display:   /c/demo-retail/kds')
    console.log('Self-Kiosk:        /c/demo-retail/kiosk')
    console.log('Super Admin URL:   /sys-control')
    console.log('======================================================\n')
  } finally {
    await pool.end()
  }
}

seedDemoVendor().catch((e) => {
  console.error('Seed error:', e)
  process.exit(1)
})
