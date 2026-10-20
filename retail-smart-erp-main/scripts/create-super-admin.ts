import dotenv from 'dotenv';
import pg from 'pg';
import bcrypt from 'bcryptjs';

// Load .env.local first, then .env as fallback
dotenv.config({ path: '.env.local' });
dotenv.config();

const { Pool } = pg;

async function createSuperAdmin() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  console.log('Creating super admin...');

  try {
    const adminEmail = (process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
    const adminPassword = process.env.SUPER_ADMIN_PASSWORD || '';
    if (!adminEmail || adminPassword.length < 12) {
      console.error('Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD (min 12 characters) before running db:seed-admin');
      process.exit(1);
    }
    const passwordHash = await bcrypt.hash(adminPassword, 12);

    const result = await pool.query(`
      INSERT INTO super_admins (email, password_hash, full_name, is_active)
      VALUES ($1, $2, $3, true)
      ON CONFLICT (email) DO NOTHING
      RETURNING id
    `, [adminEmail, passwordHash, process.env.SUPER_ADMIN_NAME || 'Super Admin']);

    if (result.rowCount && result.rowCount > 0) {
      console.log('Super admin created successfully!');
      console.log('Email: ravindu2012@hotmail.com');
      console.log(`Email: ${adminEmail}`);
    } else {
      console.log('Super admin already exists, skipping.');
    }
  } finally {
    await pool.end();
  }
}

createSuperAdmin().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
