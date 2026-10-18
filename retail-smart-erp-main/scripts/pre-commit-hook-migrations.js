#!/usr/bin/env node

/**
 * Git pre-commit hook for validating migration numbering
 * To install, copy to .git/hooks/pre-commit (or add as a Husky hook)
 */

const { execSync } = require('child_process');
const path = require('path');

console.log('🔍 Checking migration file numbering...');

try {
  // Run the validation script
  const validateScript = path.join(__dirname, 'validate-migration-numbers.js');
  execSync(`node "${validateScript}"`, { stdio: 'inherit' });
  console.log('✅ Migration numbering is valid.');
} catch (error) {
  console.error('\n❌ Migration validation failed. Please fix before committing.');
  console.error('   Run: npm run validate:migrations');
  console.error('   Fix: node fix-migration-numbers.js --apply');
  process.exit(1);
}