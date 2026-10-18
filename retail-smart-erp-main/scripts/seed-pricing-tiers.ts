import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

async function seedPricingTiers() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  console.log('Seeding pricing tiers...');

  try {
    // Check if pricing tiers already exist
    const { rows } = await pool.query(`SELECT COUNT(*) FROM pricing_tiers`);
    if (parseInt(rows[0].count) > 0) {
      console.log('Pricing tiers already exist, skipping seed.');
      return;
    }

    // Insert pricing tiers
    await pool.query(`
      INSERT INTO pricing_tiers (name, display_name, price_monthly, price_yearly, max_users, max_sales_monthly, features, is_active, sort_order)
      VALUES
        ('trial', 'Free Trial', 0, 0, 3, 100, '{"pos": true, "inventory": true, "reports": false, "multiLocation": false}', true, 0),
        ('starter', 'Starter', 19.99, 199.99, 5, 500, '{"pos": true, "inventory": true, "reports": true, "multiLocation": false}', true, 1),
        ('professional', 'Professional', 49.99, 499.99, 15, 2000, '{"pos": true, "inventory": true, "reports": true, "multiLocation": true}', true, 2),
        ('enterprise', 'Enterprise', 99.99, 999.99, NULL, NULL, '{"pos": true, "inventory": true, "reports": true, "multiLocation": true, "api": true, "support": "priority"}', true, 3)
    `);

    console.log('Pricing tiers seeded successfully!');
  } finally {
    await pool.end();
  }
}

seedPricingTiers().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
