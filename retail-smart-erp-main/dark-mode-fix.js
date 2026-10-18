const fs = require('fs');
const path = require('path');
const basePath = __dirname;
const files = [
  'src/app/sys-control/(protected)/page.tsx',
  'src/app/sys-control/(protected)/payments/page.tsx',
  'src/app/sys-control/(protected)/subscriptions/page.tsx',
  'src/app/sys-control/(protected)/users/page.tsx',
  'src/app/sys-control/(protected)/audit-logs/page.tsx',
  'src/app/sys-control/(protected)/notifications/page.tsx',
  'src/app/sys-control/(protected)/pricing/page.tsx',
  'src/app/sys-control/(protected)/settings/page.tsx',
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
  ['bg-black/50', 'dark:bg-black/70'],
  ['bg-black/60', 'dark:bg-black/70'],
];
let totalIssues = 0;
for (const file of files) {
  const fp = path.join(basePath, file);
  const content = fs.readFileSync(fp, 'utf8');
  const lines = content.split('\n');
  const issues = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const allTokens = line.split(/[\s"'`{}]+/).filter(Boolean);
    for (const [light, dark] of rules) {
      const hasLight = allTokens.some(function(t) { return t === light; });
      const hasDark = allTokens.some(function(t) { return t === dark; });
      if (hasLight && !hasDark) {
        if (light === 'border-gray-200' && allTokens.includes('dark:border-gray-600')) continue;
        issues.push({ line: i + 1, light: light, dark: dark, text: line.trim().substring(0, 140) });
      }
    }
  }
  if (issues.length > 0) {
    console.log('\n=== ' + file + ' (' + issues.length + ' issues) ===');
    issues.forEach(function(iss) {
      console.log('  L' + iss.line + ': MISSING ' + iss.dark + ' for ' + iss.light);
      console.log('    ' + iss.text);
    });
    totalIssues += issues.length;
  } else {
    console.log(file + ': COMPLETE');
  }
}
console.log('\nTotal issues: ' + totalIssues);
