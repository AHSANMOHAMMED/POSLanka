import dotenv from 'dotenv'
import pg from 'pg'
import bcrypt from 'bcryptjs'

dotenv.config({ path: '.env.local' })
dotenv.config()

const { Pool } = pg

const BUSINESS_TEMPLATES = [
  {
    slug: 'demo-retail',
    name: 'Lanka Smart Retail Mart',
    businessType: 'retail',
    adminEmail: 'retail.owner@poslanka.lk',
    cashierEmail: 'retail.cashier@poslanka.lk',
    adminPhone: '0770000001',
    cashierPhone: '0770000002',
    warehouse: 'Colombo Retail Store',
    counter: 'Counter 01',
    items: [
      { name: 'Sony Bluetooth Headphones WH-1000', sku: 'RET-001', barcode: '890123456701', sellingPrice: '45000', costPrice: '38000', stock: '15' },
      { name: 'Samsung 4K Smart TV 55 Inch', sku: 'RET-002', barcode: '890123456702', sellingPrice: '195000', costPrice: '165000', stock: '8' },
      { name: 'Wireless Ergonomic Keyboard', sku: 'RET-003', barcode: '890123456703', sellingPrice: '8500', costPrice: '6200', stock: '35' },
    ],
  },
  {
    slug: 'demo-restaurant',
    name: 'Ceylon Spice Bistro & Dining',
    businessType: 'restaurant',
    adminEmail: 'restaurant.owner@poslanka.lk',
    cashierEmail: 'restaurant.waiter@poslanka.lk',
    adminPhone: '0770000003',
    cashierPhone: '0770000004',
    warehouse: 'Main Kitchen & Bar',
    counter: 'Bar POS Till 01',
    items: [
      { name: 'Chicken Kottu Roti (Full)', sku: 'REST-001', barcode: '890223456701', sellingPrice: '1800', costPrice: '900', stock: '100' },
      { name: 'Ceylon Black Pork Curry with Rice', sku: 'REST-002', barcode: '890223456702', sellingPrice: '2200', costPrice: '1100', stock: '80' },
      { name: 'Passion Fruit Mojito Cooler', sku: 'REST-003', barcode: '890223456703', sellingPrice: '950', costPrice: '350', stock: '150' },
    ],
  },
  {
    slug: 'demo-supermarket',
    name: 'Lanka Fresh Supermarket',
    businessType: 'supermarket',
    adminEmail: 'supermarket.owner@poslanka.lk',
    cashierEmail: 'supermarket.cashier@poslanka.lk',
    adminPhone: '0770000005',
    cashierPhone: '0770000006',
    warehouse: 'Supermarket Main Floor',
    counter: 'Fast-Track POS 01',
    items: [
      { name: 'Keells Full Cream Milk 1L', sku: 'SUP-001', barcode: '479201100101', sellingPrice: '520', costPrice: '460', stock: '200' },
      { name: 'Munchee Super Cream Cracker 490g', sku: 'SUP-002', barcode: '479201100102', sellingPrice: '380', costPrice: '330', stock: '140' },
      { name: 'Dilmah Premium Ceylon Tea 400g', sku: 'SUP-003', barcode: '479201100103', sellingPrice: '1250', costPrice: '1050', stock: '90' },
    ],
  },
  {
    slug: 'demo-auto-service',
    name: 'Colombo Auto Care & Workshop',
    businessType: 'auto_service',
    adminEmail: 'auto.owner@poslanka.lk',
    cashierEmail: 'auto.tech@poslanka.lk',
    adminPhone: '0770000007',
    cashierPhone: '0770000008',
    warehouse: 'Garage Spares & Oils Storage',
    counter: 'Service Reception Counter',
    items: [
      { name: 'Mobil 1 Fully Synthetic 5W-30 (4L)', sku: 'AUTO-001', barcode: '890323456701', sellingPrice: '28500', costPrice: '22000', stock: '40' },
      { name: 'Genuine Toyota Oil Filter C-110', sku: 'AUTO-002', barcode: '890323456702', sellingPrice: '4200', costPrice: '2800', stock: '65' },
      { name: 'Standard Full Periodic Service (Labour)', sku: 'AUTO-003', barcode: '890323456703', sellingPrice: '12000', costPrice: '4000', stock: '999' },
    ],
  },
  {
    slug: 'demo-dealership',
    name: 'Lanka Motor Dealership & Sales',
    businessType: 'dealership',
    adminEmail: 'dealership.owner@poslanka.lk',
    cashierEmail: 'dealership.sales@poslanka.lk',
    adminPhone: '0770000009',
    cashierPhone: '0770000010',
    warehouse: 'Vehicle Showroom Lot A',
    counter: 'Sales Executive Counter 01',
    items: [
      { name: 'Honda Vezel e:HEV Z Grade (2024)', sku: 'VEH-001', barcode: '890423456701', sellingPrice: '18500000', costPrice: '16800000', stock: '3' },
      { name: 'Toyota Raize G Grade Turbo (2023)', sku: 'VEH-002', barcode: '890423456702', sellingPrice: '13800000', costPrice: '12400000', stock: '2' },
      { name: 'Comprehensive Vehicle Inspection Package', sku: 'VEH-003', barcode: '890423456703', sellingPrice: '35000', costPrice: '10000', stock: '500' },
    ],
  },
]

async function seedAllBusinessTypes() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error('DATABASE_URL is not set')
    process.exit(1)
  }

  const pool = new Pool({
    connectionString,
    ssl: connectionString.includes('sslmode=disable') ? false : (connectionString.includes('localhost') || connectionString.includes('127.0.0.1') ? false : { rejectUnauthorized: false }),
  })

  console.log('Seeding demo environments for all 5 business types...')

  const defaultPasswordHash = await bcrypt.hash('Admin@123456', 10)
  const defaultCashierHash = await bcrypt.hash('Cashier@123456', 10)
  const adminPinHash = await bcrypt.hash('1234', 10)
  const cashierPinHash = await bcrypt.hash('5678', 10)

  try {
    for (const b of BUSINESS_TEMPLATES) {
      console.log(`\nConfiguring ${b.name} (${b.businessType} -> /c/${b.slug})...`)

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

      // 1. Tenant
      let tenantRes = await pool.query('SELECT id, business_id FROM tenants WHERE slug = $1', [b.slug])
      let tenantId: string
      let businessId: string

      if (tenantRes.rows.length === 0) {
        const ins = await pool.query(
          `INSERT INTO tenants (name, slug, email, phone, business_type, plan, currency, country, status, settings)
           VALUES ($1, $2, $3, $4, $5, 'premium', 'LKR', 'LK', 'active', $6)
           RETURNING id, business_id`,
          [b.name, b.slug, b.adminEmail, b.adminPhone, b.businessType, JSON.stringify(settingsObj)]
        )
        tenantId = ins.rows[0].id
        businessId = ins.rows[0].business_id
      } else {
        tenantId = tenantRes.rows[0].id
        businessId = tenantRes.rows[0].business_id
        await pool.query(
          `UPDATE tenants SET name = $1, business_type = $2, status = 'active', settings = $3 WHERE id = $4`,
          [b.name, b.businessType, JSON.stringify(settingsObj), tenantId]
        )
      }

      // 2. Warehouse
      let whRes = await pool.query('SELECT id FROM warehouses WHERE tenant_id = $1 AND code = $2', [tenantId, 'MAIN'])
      let warehouseId: string
      if (whRes.rows.length === 0) {
        const insWh = await pool.query(
          `INSERT INTO warehouses (tenant_id, name, code, is_default, is_active)
           VALUES ($1, $2, 'MAIN', true, true) RETURNING id`,
          [tenantId, b.warehouse]
        )
        warehouseId = insWh.rows[0].id
      } else {
        warehouseId = whRes.rows[0].id
      }

      // 3. POS Profile
      let posRes = await pool.query('SELECT id FROM pos_profiles WHERE tenant_id = $1 AND code = $2', [tenantId, 'TILL-01'])
      let posProfileId: string
      if (posRes.rows.length === 0) {
        const insPos = await pool.query(
          `INSERT INTO pos_profiles (tenant_id, name, code, is_default, warehouse_id, allow_rate_change, allow_discount_change, allow_credit_sale, status)
           VALUES ($1, $2, 'TILL-01', true, $3, true, true, true, 'active') RETURNING id`,
          [tenantId, b.counter, warehouseId]
        )
        posProfileId = insPos.rows[0].id
      } else {
        posProfileId = posRes.rows[0].id
      }

      // 4. Accounts & Users
      // Owner Account
      let accRes = await pool.query('SELECT id FROM accounts WHERE email = $1', [b.adminEmail])
      let accountId: string
      if (accRes.rows.length === 0) {
        const insAcc = await pool.query(
          `INSERT INTO accounts (email, password_hash, full_name, phone, is_active)
           VALUES ($1, $2, $3, $4, true) RETURNING id`,
          [b.adminEmail, defaultPasswordHash, `${b.name} Owner`, b.adminPhone]
        )
        accountId = insAcc.rows[0].id
      } else {
        accountId = accRes.rows[0].id
        await pool.query('UPDATE accounts SET password_hash = $1 WHERE id = $2', [defaultPasswordHash, accountId])
      }

      // Owner User
      let usrRes = await pool.query('SELECT id FROM users WHERE tenant_id = $1 AND email = $2', [tenantId, b.adminEmail])
      let ownerUserId: string
      if (usrRes.rows.length === 0) {
        const insUsr = await pool.query(
          `INSERT INTO users (tenant_id, account_id, email, password_hash, pin_hash, full_name, role, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, 'owner', true) RETURNING id`,
          [tenantId, accountId, b.adminEmail, defaultPasswordHash, adminPinHash, `${b.name} Owner`]
        )
        ownerUserId = insUsr.rows[0].id
      } else {
        ownerUserId = usrRes.rows[0].id
        await pool.query(
          `UPDATE users SET password_hash = $1, pin_hash = $2, is_active = true WHERE id = $3`,
          [defaultPasswordHash, adminPinHash, ownerUserId]
        )
      }

      // Link account to tenant in account_tenants
      const existingOwnerLink = await pool.query('SELECT id FROM account_tenants WHERE account_id = $1 AND tenant_id = $2', [accountId, tenantId])
      if (existingOwnerLink.rows.length === 0) {
        await pool.query(
          `INSERT INTO account_tenants (account_id, tenant_id, role, is_owner, is_active)
           VALUES ($1, $2, 'owner', true, true)`,
          [accountId, tenantId]
        )
      }

      // Cashier Account
      let cashAccRes = await pool.query('SELECT id FROM accounts WHERE email = $1', [b.cashierEmail])
      let cashierAccountId: string
      if (cashAccRes.rows.length === 0) {
        const insAcc = await pool.query(
          `INSERT INTO accounts (email, password_hash, full_name, phone, is_active)
           VALUES ($1, $2, $3, $4, true) RETURNING id`,
          [b.cashierEmail, defaultCashierHash, `${b.name} Staff`, b.cashierPhone]
        )
        cashierAccountId = insAcc.rows[0].id
      } else {
        cashierAccountId = cashAccRes.rows[0].id
        await pool.query('UPDATE accounts SET password_hash = $1 WHERE id = $2', [defaultCashierHash, cashierAccountId])
      }

      // Cashier User
      let cashUsrRes = await pool.query('SELECT id FROM users WHERE tenant_id = $1 AND email = $2', [tenantId, b.cashierEmail])
      let cashierUserId: string
      const staffRole = b.businessType === 'restaurant' ? 'waiter' : (b.businessType === 'auto_service' ? 'technician' : 'cashier')
      if (cashUsrRes.rows.length === 0) {
        const insCash = await pool.query(
          `INSERT INTO users (tenant_id, account_id, email, password_hash, pin_hash, full_name, role, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, true) RETURNING id`,
          [tenantId, cashierAccountId, b.cashierEmail, defaultCashierHash, cashierPinHash, `${b.name} Staff`, staffRole]
        )
        cashierUserId = insCash.rows[0].id
      } else {
        cashierUserId = cashUsrRes.rows[0].id
        await pool.query(
          `UPDATE users SET password_hash = $1, pin_hash = $2, is_active = true WHERE id = $3`,
          [defaultCashierHash, cashierPinHash, cashierUserId]
        )
      }

      const existingCashierLink = await pool.query('SELECT id FROM account_tenants WHERE account_id = $1 AND tenant_id = $2', [cashierAccountId, tenantId])
      if (existingCashierLink.rows.length === 0) {
        await pool.query(
          `INSERT INTO account_tenants (account_id, tenant_id, role, is_owner, is_active)
           VALUES ($1, $2, $3, false, true)`,
          [cashierAccountId, tenantId, staffRole]
        )
      }

      // Assign POS profile users
      let ppCashier = await pool.query('SELECT id FROM pos_profile_users WHERE pos_profile_id = $1 AND user_id = $2', [posProfileId, cashierUserId])
      if (ppCashier.rows.length === 0) {
        await pool.query('INSERT INTO pos_profile_users (tenant_id, pos_profile_id, user_id, is_default) VALUES ($1, $2, $3, true)', [tenantId, posProfileId, cashierUserId])
      }

      let ppOwner = await pool.query('SELECT id FROM pos_profile_users WHERE pos_profile_id = $1 AND user_id = $2', [posProfileId, ownerUserId])
      if (ppOwner.rows.length === 0) {
        await pool.query('INSERT INTO pos_profile_users (tenant_id, pos_profile_id, user_id, is_default) VALUES ($1, $2, $3, false)', [tenantId, posProfileId, ownerUserId])
      }

      // 5. Sample Products
      let itemIndex = 1
      for (const it of b.items) {
        let itRes = await pool.query('SELECT id FROM items WHERE tenant_id = $1 AND sku = $2', [tenantId, it.sku])
        let itemId: string
        if (itRes.rows.length === 0) {
          const itemCode = `ITM-${b.slug.slice(5, 8).toUpperCase()}-${String(itemIndex++).padStart(4, '0')}`
          const insIt = await pool.query(
            `INSERT INTO items (tenant_id, item_code, name, sku, barcode, selling_price, cost_price, track_stock, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, true, true) RETURNING id`,
            [tenantId, itemCode, it.name, it.sku, it.barcode, it.sellingPrice, it.costPrice]
          )
          itemId = insIt.rows[0].id
        } else {
          itemId = itRes.rows[0].id
        }

        // Warehouse Stock
        await pool.query(
          `INSERT INTO warehouse_stock (tenant_id, warehouse_id, item_id, current_stock, min_stock, reserved_stock)
           VALUES ($1, $2, $3, $4, 0, 0)
           ON CONFLICT (warehouse_id, item_id, tenant_id) DO UPDATE SET current_stock = EXCLUDED.current_stock`,
          [tenantId, warehouseId, itemId, it.stock]
        )
      }

      console.log(`✓ Setup complete for ${b.slug} (Business ID: ${businessId})`)
    }

    console.log('\nAll 5 business environments configured successfully!')
  } finally {
    await pool.end()
  }
}

seedAllBusinessTypes().catch((e) => {
  console.error('Seed failed:', e)
  process.exit(1)
})
