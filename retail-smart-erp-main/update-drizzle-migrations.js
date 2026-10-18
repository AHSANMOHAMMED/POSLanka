const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function computeFileHash(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  // Drizzle kit normalizes the SQL: removes whitespace, comments, etc.
  // For simplicity, we'll compute hash of normalized content
  const normalized = content
    .replace(/\r\n/g, '\n')  // Normalize line endings
    .replace(/\s+/g, ' ')    // Collapse whitespace
    .trim();
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

async function updateMigrations(connectionString, label, dryRun = true) {
  const client = new Client({
    connectionString,
    ssl: connectionString.includes('railway') ? { rejectUnauthorized: false } : undefined
  });

  try {
    await client.connect();
    console.log(`\n=== ${label} ${dryRun ? '(DRY RUN)' : ''} ===`);

    // Get current migration files
    const migrationDir = path.join(__dirname, 'drizzle');
    const migrationFiles = fs.readdirSync(migrationDir)
      .filter(f => f.endsWith('.sql') && !f.includes('rls_comprehensive') && !f.includes('triggers'))
      .sort();

    console.log(`Found ${migrationFiles.length} migration files`);

    // Compute hashes
    const migrations = [];
    for (const file of migrationFiles) {
      const filePath = path.join(migrationDir, file);
      const hash = computeFileHash(filePath);
      migrations.push({ file, hash });
      console.log(`  ${file}: ${hash}`);
    }

    // Get current applied migrations
    const currentResult = await client.query(`
      SELECT id, hash, created_at
      FROM drizzle.__drizzle_migrations
      ORDER BY id
    `);

    console.log(`\nCurrent applied migrations: ${currentResult.rowCount}`);
    if (currentResult.rowCount > 0) {
      console.log('Current hashes:');
      currentResult.rows.forEach(row => {
        console.log(`  ID ${row.id}: ${row.hash} (created_at: ${row.created_at})`);
      });
    }

    // Check which hashes match
    const currentHashes = currentResult.rows.map(r => r.hash);
    let matched = 0;
    for (const mig of migrations) {
      if (currentHashes.includes(mig.hash)) {
        matched++;
      }
    }
    console.log(`\nMatching hashes: ${matched}/${migrations.length}`);

    if (matched === migrations.length && currentResult.rowCount === migrations.length) {
      console.log('✅ Migration state is already correct. No changes needed.');
      return;
    }

    // Plan update
    console.log('\nPlanning to:');
    console.log('  1. DELETE all rows from drizzle.__drizzle_migrations');
    console.log('  2. INSERT new rows for each migration file');

    if (dryRun) {
      console.log('\n⚠️  DRY RUN - no changes will be made');
      console.log('   To apply changes, run with dryRun: false');
      return;
    }

    // Perform update
    await client.query('BEGIN');

    // Delete existing rows
    const deleteResult = await client.query('DELETE FROM drizzle.__drizzle_migrations');
    console.log(`\nDeleted ${deleteResult.rowCount} rows`);

    // Insert new rows
    const now = Date.now();
    for (let i = 0; i < migrations.length; i++) {
      const mig = migrations[i];
      await client.query(
        'INSERT INTO drizzle.__drizzle_migrations (id, hash, created_at) VALUES ($1, $2, $3)',
        [i + 1, mig.hash, now + i] // Slightly offset timestamps to maintain order
      );
    }

    await client.query('COMMIT');
    console.log(`Inserted ${migrations.length} rows`);
    console.log('✅ Migration table updated successfully.');

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
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--apply');

  console.log('Updating drizzle.__drizzle_migrations table');
  console.log(`Mode: ${dryRun ? 'DRY RUN (add --apply to execute)' : 'APPLY CHANGES'}`);

  // Update local
  await updateMigrations(
    'postgresql://postgres:postgres@localhost:5432/retail_smart_pos',
    'Local Database',
    dryRun
  );

  // Update Railway
  await updateMigrations(
    'postgresql://postgres:GscoHkXwSOTswMQdTxxUFjanduCKHaDV@gondola.proxy.rlwy.net:31245/railway',
    'Railway Database',
    dryRun
  );

  if (dryRun) {
    console.log('\n⚠️  This was a dry run. To apply changes, run:');
    console.log('   node update-drizzle-migrations.js --apply');
  } else {
    console.log('\n✅ All updates applied successfully.');
  }
}

main().catch(console.error);