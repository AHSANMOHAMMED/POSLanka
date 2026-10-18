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

async function main() {
  const client = new Client({
    connectionString: 'postgresql://postgres:postgres@localhost:5432/retail_smart_pos'
  });

  try {
    await client.connect();
    console.log('Connected to local database');

    // Get migration files
    const migrationDir = path.join(__dirname, 'drizzle');
    const migrationFiles = fs.readdirSync(migrationDir)
      .filter(f => f.endsWith('.sql') && !f.includes('rls_comprehensive') && !f.includes('triggers'))
      .sort();

    console.log(`Found ${migrationFiles.length} migration files`);

    // Compute hashes
    const fileHashes = new Map();
    for (const file of migrationFiles) {
      const filePath = path.join(migrationDir, file);
      const hash = computeFileHash(filePath);
      fileHashes.set(hash, file);
      console.log(`  ${file}: ${hash}`);
    }

    // Get migration table entries
    const result = await client.query(`
      SELECT id, hash, created_at
      FROM drizzle.__drizzle_migrations
      ORDER BY id
    `);

    console.log(`\nMigration table has ${result.rowCount} entries`);

    let allMatch = true;
    for (const row of result.rows) {
      const file = fileHashes.get(row.hash);
      if (file) {
        console.log(`  ID ${row.id}: matches ${file}`);
      } else {
        console.log(`  ID ${row.id}: hash ${row.hash} - NO MATCHING FILE`);
        allMatch = false;
      }
    }

    if (allMatch) {
      console.log('\n✅ All migration table entries match existing files.');
    } else {
      console.log('\n❌ Some hashes do not match any file.');
      console.log('   Run: node rebuild-migration-table.js');
    }

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await client.end();
  }
}

main().catch(console.error);