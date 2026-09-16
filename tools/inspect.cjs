const fs = require('fs');
const base = 'c:\\Freelance\\Everbreezesitepix';
[
  'apps/web/src/app/layout.tsx',
  'apps/web/src/components/MainLayout/MainLayout.tsx',
  'apps/web/src/styles/globals.css',
  'apps/web/src/app/page.tsx',
  'apps/web/src/app/globals.css',
].forEach(f => {
  const p = base + '\\' + f;
  if (fs.existsSync(p)) {
    console.log('==== ' + f + ' ====\n' + fs.readFileSync(p, 'utf8'));
  } else {
    console.log('MISSING ' + f);
  }
});
