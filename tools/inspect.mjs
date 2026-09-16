import fs from 'fs';
const base = 'c:/Freelance/Everbreezesitepix';
const p = base + '/apps/web/src/features/settings/pages/TemplatesPage.tsx';
const s = fs.readFileSync(p, 'utf8');
const needles = [
  'Contents',
  'mt-3">Contents',
  'pane !== "contents"',
  'pane !== \'contents\'',
  'Lands in',
  'Add section',
  'onPickKind',
  'previewItems.map',
  'sections.map',
];
needles.forEach(n => {
  const i = s.indexOf(n);
  console.log(`needle ${JSON.stringify(n)} at char ${i}`);
});
// print a small anchor around the contents pane heading
const h2 = s.indexOf('Contents</h2>');
console.log('\n--- anchor around Contents heading ---\n');
console.log(s.slice(Math.max(0, h2 - 400), h2 + 200));
