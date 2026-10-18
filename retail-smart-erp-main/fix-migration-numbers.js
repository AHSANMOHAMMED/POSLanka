const fs = require('fs');
const path = require('path');

const drizzleDir = path.join(__dirname, 'drizzle');

// Read all SQL files
const files = fs.readdirSync(drizzleDir)
  .filter(f => f.endsWith('.sql') && !f.includes('rls_comprehensive') && !f.includes('triggers'))
  .sort();

console.log(`Found ${files.length} migration files`);

// Analyze current numbering
const numberMap = new Map();
const duplicates = [];

for (const file of files) {
  const num = file.substring(0, 4);
  if (numberMap.has(num)) {
    duplicates.push({ num, file1: numberMap.get(num), file2: file });
  } else {
    numberMap.set(num, file);
  }
}

console.log('\nDuplicate migrations found:');
for (const dup of duplicates) {
  console.log(`  ${dup.num}: ${dup.file1} and ${dup.file2}`);
}

if (duplicates.length === 0) {
  console.log('No duplicates found. Exiting.');
  process.exit(0);
}

// Plan renames
const renames = [];

// Handle 0019 duplicates
const dup0019 = duplicates.find(d => d.num === '0019');
if (dup0019) {
  // Rename first one to 0018 (since 0018 is missing)
  // Alphabetically: "0019_add_restaurant_order_id_to_sales.sql" comes before "0019_purchase_workflow.sql"
  const firstFile = dup0019.file1; // add_restaurant_order_id_to_sales.sql
  const newName = firstFile.replace('0019_', '0018_');
  renames.push({ old: firstFile, new: newName });
  console.log(`\nWill rename: ${firstFile} -> ${newName}`);
  // Second file stays as 0019_purchase_workflow.sql
}

// Handle 0022 duplicates
const dup0022 = duplicates.find(d => d.num === '0022');
if (dup0022) {
  // notification_system.sql should stay as 0022
  // sms_generic_params.sql should become 0023
  // Then shift all files from 0023 upward by +1

  // Alphabetically: "0022_notification_system.sql" comes before "0022_sms_generic_params.sql"
  const secondFile = dup0022.file2; // sms_generic_params.sql
  const newName = secondFile.replace('0022_', '0023_');

  // First, shift all files from 0023 to 0057 up by 1 (to make room for sms_generic_params at 0023)
  // Process in DESCENDING order to avoid conflicts
  const shiftingRenames = [];
  for (let i = 57; i >= 23; i--) {
    const oldNum = i.toString().padStart(4, '0');
    const newNum = (i + 1).toString().padStart(4, '0');

    // Find file with this number
    const oldFile = files.find(f => f.startsWith(oldNum + '_'));
    if (oldFile) {
      const newFile = oldFile.replace(`${oldNum}_`, `${newNum}_`);
      shiftingRenames.push({ old: oldFile, new: newFile });
    }
  }

  // Add shifting renames first, then the sms_generic_params rename
  renames.push(...shiftingRenames);
  renames.push({ old: secondFile, new: newName });
  console.log(`\nWill rename: ${secondFile} -> ${newName}`);
  console.log(`Will shift ${shiftingRenames.length} files upward by 1`);
}

console.log(`\nTotal renames planned: ${renames.length}`);

// Ask for confirmation
console.log('\n=== DRY RUN ===');
console.log('To execute renames, run with --apply flag');
console.log('Example: node fix-migration-numbers.js --apply');

if (process.argv.includes('--apply')) {
  console.log('\n=== APPLYING CHANGES ===');
  let successCount = 0;
  let errorCount = 0;

  for (const rename of renames) {
    try {
      const oldPath = path.join(drizzleDir, rename.old);
      const newPath = path.join(drizzleDir, rename.new);

      if (!fs.existsSync(oldPath)) {
        console.log(`  SKIP: ${rename.old} does not exist`);
        continue;
      }

      if (fs.existsSync(newPath)) {
        console.log(`  ERROR: ${rename.new} already exists`);
        errorCount++;
        continue;
      }

      fs.renameSync(oldPath, newPath);
      console.log(`  OK: ${rename.old} -> ${rename.new}`);
      successCount++;
    } catch (error) {
      console.log(`  ERROR: ${rename.old} -> ${rename.new}: ${error.message}`);
      errorCount++;
    }
  }

  console.log(`\nResults: ${successCount} successful, ${errorCount} errors`);

  // Verify no duplicates remain
  const newFiles = fs.readdirSync(drizzleDir)
    .filter(f => f.endsWith('.sql') && !f.includes('rls_comprehensive') && !f.includes('triggers'))
    .sort();

  const newNumberMap = new Map();
  const newDuplicates = [];

  for (const file of newFiles) {
    const num = file.substring(0, 4);
    if (newNumberMap.has(num)) {
      newDuplicates.push({ num, file1: newNumberMap.get(num), file2: file });
    } else {
      newNumberMap.set(num, file);
    }
  }

  if (newDuplicates.length === 0) {
    console.log('✅ No duplicate migration numbers remain');
  } else {
    console.log('❌ Still have duplicates:');
    for (const dup of newDuplicates) {
      console.log(`  ${dup.num}: ${dup.file1} and ${dup.file2}`);
    }
  }
}