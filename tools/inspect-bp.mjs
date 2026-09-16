import fs from 'fs';
const base = 'c:/Freelance/Everbreezesitepix';
const p = base + '/apps/web/src/features/settings/pages/TemplatesPage.tsx';
const s = fs.readFileSync(p, 'utf8');
const i103 = s.indexOf('pane !== "contents"');
const divOpen = s.indexOf('<div', i103 - 120);
const afterPane = s.indexOf('flex shrink-0', i103);
console.log('pane !== contents @', i103, '| divOpen @', divOpen, '| flex-shrink-0 @', afterPane);
console.log('\n=== pane div + eyebrow start ===\n');
console.log(s.slice(divOpen, afterPane + 180));

const pickOpen = s.indexOf('Add section', afterPane);
const pickClose = s.indexOf('</DropdownMenuContent>', pickOpen);
const menuClose = s.indexOf('</DropdownMenu>', pickClose);
const pickerDivEnd = s.indexOf('</div>', menuClose + 20);
console.log('\nAdd section @', pickOpen, '| DropContent @', pickClose, '| DropMenu @', menuClose, '| pickerDivEnd @', pickerDivEnd);
console.log('\n=== picker end + after ===\n');
console.log(s.slice(pickClose - 120, pickerDivEnd + 80));

// The eyebrow block start = afterPane ; the picker end = pickerDivEnd
// Confirm what's between pickerDivEnd and the next 'Applied to' comment
const appliedIdx = s.indexOf('Applied to.', pickerDivEnd);
console.log('\n"Applied to." @', appliedIdx);
console.log('\n=== between picker end and Applied-to comment ===\n');
console.log(s.slice(pickerDivEnd, Math.min(appliedIdx, pickerDivEnd + 220)));
