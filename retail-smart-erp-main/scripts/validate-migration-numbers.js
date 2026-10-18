#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const migrationDir = path.join(__dirname, '..', 'drizzle');

function validateMigrationNumbers() {
  console.log('Validating migration file numbering...');

  // Read all SQL files
  const files = fs.readdirSync(migrationDir)
    .filter(f => f.endsWith('.sql') && !f.includes('rls_comprehensive') && !f.includes('triggers'))
    .sort();

  console.log(`Found ${files.length} migration files`);

  // Extract numbers
  const numberMap = new Map();
  const duplicates = [];
  const numbers = [];

  for (const file of files) {
    const match = file.match(/^(\d{4})_/);
    if (!match) {
      console.warn(`⚠️  File "${file}" does not match migration naming pattern (should be 0000_name.sql)`);
      continue;
    }

    const num = match[1];
    const numInt = parseInt(num, 10);
    numbers.push(numInt);

    if (numberMap.has(num)) {
      duplicates.push({ num, file1: numberMap.get(num), file2: file });
    } else {
      numberMap.set(num, file);
    }
  }

  // Check for duplicates
  if (duplicates.length > 0) {
    console.error('❌ Duplicate migration numbers found:');
    for (const dup of duplicates) {
      console.error(`  ${dup.num}: ${dup.file1} and ${dup.file2}`);
    }
    console.error('\nTo fix duplicates, run: node fix-migration-numbers.js --apply');
    process.exit(1);
  }

  // Check for sequential ordering (optional, can have gaps)
  numbers.sort((a, b) => a - b);
  const min = numbers[0];
  const max = numbers[numbers.length - 1];
  const missing = [];

  for (let i = min; i <= max; i++) {
    if (!numbers.includes(i)) {
      missing.push(i.toString().padStart(4, '0'));
    }
  }

  if (missing.length > 0) {
    console.warn(`⚠️  Missing migration numbers (gaps): ${missing.join(', ')}`);
    console.warn('   Gaps are acceptable but may indicate missing or deleted migrations.');
  }

  console.log('✅ Migration numbering is valid (no duplicates).');
  console.log(`   Range: ${min.toString().padStart(4, '0')} to ${max.toString().padStart(4, '0')}`);
  console.log(`   Total: ${files.length} files`);
}

if (require.main === module) {
  try {
    validateMigrationNumbers();
  } catch (error) {
    console.error('Validation error:', error.message);
    process.exit(1);
  }
}

module.exports = validateMigrationNumbers;