import fs from 'fs';
const base = 'c:/Freelance/Everbreezesitepix';
const p = base + '/apps/web/src/features/settings/pages/WorkflowTemplatesPage.tsx';
const s = fs.readFileSync(p, 'utf8');
const i = s.indexOf('phase_type');
console.log('phase_type at', i);
if (i >= 0) console.log('\n=== around phase_type ===\n' + s.slice(Math.max(0, i - 500), i + 1200));
else console.log('\n(no phase_type; tail)\n' + s.slice(-1600));
