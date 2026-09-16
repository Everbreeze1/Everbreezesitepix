import fs from 'fs';
const base = 'c:/Freelance/Everbreezesitepix';
const want = [
  'apps/web/src/features/settings/components/workflow-starters.ts',
  'apps/web/src/features/settings/components/install-blueprint-starter.ts',
  'apps/web/src/features/settings/components/blueprint-starters.ts',
];
for (const f of want) {
  const p = base + '/' + f;
  if (!fs.existsSync(p)) { console.log('MISSING ' + f); continue; }
  const s = fs.readFileSync(p, 'utf8');
  // look for phase-related table names / inserts
  const re = /workflow_template_phases|project_workflow_phases|phases/i;
  let acc = '';
  for (let i = 0; i < s.length; i++) {
    if (re.test(s[i])) {
      acc += '@' + i + ':' + s.slice(Math.max(0, i - 40), i + 80).replace(/\s+/g, ' ') + '\n';
      if (acc.split('\n').length > 30) break;
    }
  }
  console.log('==== ' + f + ' (chars=' + s.length + ') ====\n' + (acc || '(no phase refs)'));

  // also print the "creates a workflow" block
  const wf = s.indexOf('createWorkflow');
  if (wf >= 0) console.log('\n--- createWorkflow block ---\n' + s.slice(wf, wf + 1200));
}
