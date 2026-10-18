const fs = require('fs');
const path = require('path');

const journalPath = path.join(__dirname, '..', 'drizzle', 'meta', '_journal.json');
const migrationDir = path.join(__dirname, '..', 'drizzle');

function main() {
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  const migrationFiles = fs.readdirSync(migrationDir)
    .filter(f => f.endsWith('.sql') && !f.includes('rls_comprehensive') && !f.includes('triggers'))
    .sort();

  const migrationTags = migrationFiles.map(f => f.replace('.sql', ''));

  console.log('Verifying journal consistency...');
  console.log(`Migration files: ${migrationFiles.length}, Journal entries: ${journal.entries.length}`);

  let errors = 0;
  let idx = 0;
  for (const entry of journal.entries) {
    if (entry.tag === 'rls_comprehensive' || entry.tag === 'triggers') {
      continue;
    }
    const expectedTag = migrationTags[idx];
    if (entry.tag !== expectedTag) {
      console.error(`❌ Mismatch at idx ${entry.idx}: journal tag "${entry.tag}" != file "${expectedTag}"`);
      errors++;
    }
    idx++;
  }

  if (errors === 0) {
    console.log('✅ Journal is consistent with migration files.');
  } else {
    console.error(`❌ Found ${errors} mismatches.`);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
});