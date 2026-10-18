const fs = require('fs');
const path = require('path');

const basePath = 'src/app/sys-control/(protected)';
const files = [
  'page.tsx',
  'payments/page.tsx',
  'subscriptions/page.tsx',
  'users/page.tsx',
  'audit-logs/page.tsx',
  'notifications/page.tsx',
  'pricing/page.tsx',
  'settings/page.tsx',
];

const rules = [
  ['text-gray-900', 'dark:text-white'],
  ['text-gray-700', 'dark:text-gray-300'],
  ['text-gray-600', 'dark:text-gray-400'],
  ['text-gray-500', 'dark:text-gray-400'],
  ['bg-white', 'dark:bg-gray-800'],
  ['bg-gray-50', 'dark:bg-gray-700/50'],
  ['bg-gray-100', 'dark:bg-gray-700'],
  ['border-gray-100', 'dark:border-gray-700'],
  ['border-gray-200', 'dark:border-gray-700'],
  ['border-gray-300', 'dark:border-gray-600'],
  ['placeholder-gray-400', 'dark:placeholder-gray-500'],
  ['hover:bg-gray-50', 'dark:hover:bg-gray-700'],
  ['hover:bg-gray-100', 'dark:hover:bg-gray-700'],
  ['divide-gray-200', 'dark:divide-gray-700'],
  ['bg-black/50', 'dark:bg-black/70'],
  ['bg-black/60', 'dark:bg-black/70'],
];

let totalMissing = 0;
const changes = [];

for (const file of files) {
  const filePath = path.join(basePath, file);
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  let fileChanges = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const [pattern, darkClass] of rules) {
      if (!line.includes(pattern)) continue;
      if (line.includes(darkClass)) continue;
      
      let pos = 0;
      while (true) {
        const idx = line.indexOf(pattern, pos);
        if (idx === -1) break;
        pos = idx + 1;
        
        // Check not preceded by colon (hover:, dark:, etc.)
        if (idx > 0 && line[idx - 1] === ':') continue;
        // Check not preceded by alphanumeric/dash
        if (idx > 0 && /[a-zA-Z0-9_-]/.test(line[idx - 1])) continue;
        
        // Check not followed by digit (bg-gray-50 vs bg-gray-500)
        const afterIdx = idx + pattern.length;
        if (afterIdx < line.length) {
          const afterChar = line[afterIdx];
          if (pattern === 'bg-white' && afterChar === '/') continue;
          if (/[0-9]/.test(afterChar)) continue;
        }
        
        totalMissing++;
        fileChanges++;
        changes.push({
          file,
          line: i + 1,
          pattern,
          darkClass,
          context: line.trim().substring(0, 160),
        });
        break;
      }
    }
  }
  
  if (fileChanges > 0) {
    console.log(file + ': ' + fileChanges + ' missing');
  } else {
    console.log(file + ': all good');
  }
}

console.log('\nTotal missing: ' + totalMissing);
if (changes.length > 0) {
  console.log('\nDetails:');
  for (const c of changes) {
    console.log('  ' + c.file + ':' + c.line + ' [' + c.pattern + '] -> add ' + c.darkClass);
    console.log('    ' + c.context);
    console.log('');
  }
}
