const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function computeFileHash(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const normalized = content
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

async function rebuildMigrations(connectionString, label) {
  const client = new Client({
    connectionString,
    ssl: connectionString.includes('railway') ? { rejectUnauthorized: false } : undefined
  });

  try {
    await client.connect();
    console.log(`\n=== ${label} ===`);

    // Get current migration files sorted by name
    const migrationDir = path.join(__dirname, 'drizzle');
    const migrationFiles = fs.readdirSync(migrationDir)
      .filter(f => f.endsWith('.sql') && !f.includes('rls_comprehensive') && !f.includes('triggers'))
      .sort();

    console.log(`Found ${migrationFiles.length} migration files`);

    // Compute hashes in order
    const migrations = [];
    for (const file of migrationFiles) {
      const filePath = path.join(migrationDir, file);
      const hash = computeFileHash(filePath);
      migrations.push({ file, hash });
      console.log(`  ${file}: ${hash}`);
    }

    // Delete existing rows and insert new ones
    await client.query('BEGIN');

    // Delete all rows
    const deleteResult = await client.query('DELETE FROM drizzle.__drizzle_migrations');
    console.log(`Deleted ${deleteResult.rowCount} rows`);

    // Insert new rows with sequential IDs
    const now = Date.now();
    for (let i = 0; i < migrations.length; i++) {
      const mig = migrations[i];
      await client.query(
        'INSERT INTO drizzle.__drizzle_migrations (id, hash, created_at) VALUES ($1, $2, $3)',
        [i + 1, mig.hash, now + i]
      );
    }

    await client.query('COMMIT');
    console.log(`Inserted ${migrations.length} rows`);
    console.log('✅ Migration table rebuilt successfully.');

  } catch (error) {
    console.error(`Error:`, error.message);
    try {
      await client.query('ROLLBACK');
    } catch {}
    throw error;
  } finally {
    await client.end();
  }
}

async function main() {
  console.log('Rebuilding drizzle.__drizzle_migrations table');
  console.log('This will DELETE and REINSERT all migration records.');
  console.log('Make sure all migrations have been applied successfully.');

  // Rebuild local
  await rebuildMigrations(
    'postgresql://postgres:postgres@localhost:5432/retail_smart_pos',
    'Local Database'
  );

  // Rebuild Railway
  await rebuildMigrations(
    'postgresql://postgres:GscoHkXwSOTswMQdTxxUFjanduCKHaDV@gondola.proxy.rlwy.net:31245/railway',
    'Railway Database'
  );

  console.log('\n✅ All migration tables rebuilt successfully.');
  console.log('\nNext steps:');
  console.log('1. Run: npm run db:migrate to verify migrations are recognized');
  console.log('2. Start dev server to verify application works');
}

main().catch(console.error);