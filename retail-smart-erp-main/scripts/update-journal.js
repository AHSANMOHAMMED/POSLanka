const fs = require('fs');
const path = require('path');

const journalPath = path.join(__dirname, 'drizzle', 'meta', '_journal.json');
const migrationDir = path.join(__dirname, 'drizzle');

function main() {
  console.log('Reading journal file...');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));

  // Get migration files (excluding rls_comprehensive and triggers)
  const migrationFiles = fs.readdirSync(migrationDir)
    .filter(f => f.endsWith('.sql') && !f.includes('rls_comprehensive') && !f.includes('triggers'))
    .sort();

  console.log(`Found ${migrationFiles.length} migration files`);

  // Map idx to tag (without .sql)
  const idxToTag = new Map();
  for (let i = 0; i < migrationFiles.length; i++) {
    const tag = migrationFiles[i].replace('.sql', '');
    idxToTag.set(i, tag);
  }

  // Update entries
  const updatedEntries = [];
  let specialIdx = migrationFiles.length; // indices for special entries

  for (const entry of journal.entries) {
    if (entry.tag === 'rls_comprehensive' || entry.tag === 'triggers') {
      // Keep special entries as-is
      updatedEntries.push(entry);
      specialIdx++;
    } else {
      // Migration entry - update tag based on idx
      const newTag = idxToTag.get(entry.idx);
      if (!newTag) {
        console.error(`Error: No migration file for idx ${entry.idx}`);
        process.exit(1);
      }
      updatedEntries.push({
        ...entry,
        tag: newTag
      });
    }
  }

  // Verify count
  if (updatedEntries.length !== journal.entries.length) {
    console.error('Entry count mismatch');
    process.exit(1);
  }

  // Write updated journal
  const updatedJournal = {
    ...journal,
    entries: updatedEntries
  };

  // Backup original
  const backupPath = journalPath + '.backup';
  fs.copyFileSync(journalPath, backupPath);
  console.log(`Backup created at ${backupPath}`);

  fs.writeFileSync(journalPath, JSON.stringify(updatedJournal, null, 2));
  console.log('Journal updated successfully.');

  // Print changes
  console.log('\nChanges made:');
  for (let i = 0; i < journal.entries.length; i++) {
    const oldTag = journal.entries[i].tag;
    const newTag = updatedEntries[i].tag;
    if (oldTag !== newTag) {
      console.log(`  idx ${journal.entries[i].idx}: ${oldTag} -> ${newTag}`);
    }
  }
}

main().catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
});