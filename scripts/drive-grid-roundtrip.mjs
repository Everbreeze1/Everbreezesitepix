/**
 * Does the photo grid survive an actual edit and save?
 *
 * The whole reason the grid is built from nested InfoPanels rather than bare
 * divs is that Tiptap drops elements it does not recognise on parse - so a grid
 * that renders from stored HTML could still be flattened the first time the
 * report is edited and saved. Rendering proves parse; this proves serialize.
 *
 * Seeds a grid page, opens it in the editor, makes a real edit, waits for the
 * autosave, then reads the stored content_html back and checks the nested
 * photogrid/photocell structure is still there. Deletes the page after.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const BASE = "http://localhost:8080";
const env = (f) =>
  Object.fromEntries(
    readFileSync(f, "utf8")
      .split(/\r?\n/)
      .map((l) => l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/))
      .filter(Boolean)
      .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]),
  );
const cfg = { ...env("apps/api/.env"), ...env(".env") };
const SVC = {
  apikey: cfg.EVERLUMEN_SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${cfg.EVERLUMEN_SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};
const PROJECT = "ea044896-a2c8-4204-8356-f0ca4e7f67ca";
const api = (path, init) =>
  fetch(`${cfg.EVERLUMEN_SUPABASE_URL}/rest/v1/${path}`, { headers: SVC, ...init });

const [{ id: pid }] = await (
  await api(`photos?select=id&project_id=eq.${PROJECT}&deleted_at=is.null&limit=1`)
).json();
const cell = (n, text) =>
  `<div data-panel="photocell"><p><img data-photo-id="${pid}" src="" width="100%" height="190"></p>` +
  `<p><span class="panel-caption">Photo ${n}</span> ${text}</p></div>`;
const BODY =
  `<h2>Photographic record</h2><div data-panel="photogrid2">` +
  cell(1, "First caption.") +
  cell(2, "Second caption.") +
  cell(3, "Third caption.") +
  cell(4, "Fourth caption.") +
  `</div>`;

const [{ created_by }] = await (await api(`projects?select=created_by&id=eq.${PROJECT}`)).json();
const [{ id: pageId }] = await (
  await api("project_pages", {
    method: "POST",
    headers: { ...SVC, Prefer: "return=representation" },
    body: JSON.stringify({
      project_id: PROJECT,
      created_by,
      title: "TEMP grid roundtrip",
      content_html: BODY,
      source_template: "report",
    }),
  })
).json();
console.log(`seeded ${pageId}`);

const R = [];
const check = (n, p, d = "") => {
  R.push(p);
  console.log(`${p ? "  ok  " : " FAIL "} ${n}${d ? ` - ${d}` : ""}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
try {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.waitForSelector('button[type="submit"]', { state: "visible" });
  for (let i = 0; i < 4; i++) {
    await page.fill('input[type="email"]', "");
    await page.fill('input[type="password"]', "");
    await page.locator('input[type="email"]').pressSequentially(cfg.email, { delay: 10 });
    await page.locator('input[type="password"]').pressSequentially(cfg.password, { delay: 10 });
    await page.waitForTimeout(2000);
    if ((await page.inputValue('input[type="email"]')) === cfg.email) break;
  }
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(4000);

  await page.goto(`${BASE}/projects/${PROJECT}/pages/${pageId}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".tiptap", { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(6000);
  check(
    "renders 4 cells before editing",
    (await page.locator('.tiptap [data-panel="photocell"]').count()) === 4,
  );

  // A real edit: click into the last caption and type. This dirties the doc and
  // triggers the editor's autosave, which serialises the doc back to HTML.
  const lastCap = page.locator('.tiptap [data-panel="photocell"] p').last();
  await lastCap.click();
  await page.keyboard.type(" EDITED");
  // Autosave debounces (~1.2s for the body); wait well past it.
  await page.waitForTimeout(6000);

  // Read the stored HTML straight from the DB - the source of truth after save.
  const [row] = await (await api(`project_pages?select=content_html&id=eq.${pageId}`)).json();
  const html = row.content_html ?? "";
  const cells = (html.match(/data-panel="photocell"/g) ?? []).length;
  const grids = (html.match(/data-panel="photogrid/g) ?? []).length;
  const imgs = (html.match(/data-photo-id=/g) ?? []).length;

  check("the edit was actually saved", /EDITED/.test(html), "otherwise this proves nothing");
  check("the photogrid container survived the save", grids >= 1, `${grids} grid(s)`);
  check("all four photocells survived the save", cells === 4, `${cells} cell(s)`);
  check("all four images survived the save", imgs === 4, `${imgs} image(s)`);
  check("captions still paired in cells", /photocell"><p><img[^>]*><\/p><p>/.test(html), "");

  // And re-render from the saved HTML to be sure it still displays as a grid.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".tiptap", { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(6000);
  check(
    "still 4 cells after reload",
    (await page.locator('.tiptap [data-panel="photocell"]').count()) === 4,
  );
  const disp = await page
    .locator('.tiptap [data-panel^="photogrid"]')
    .first()
    .evaluate((el) => getComputedStyle(el).display)
    .catch(() => "none");
  check("still laid out as a grid after reload", disp === "grid", disp);

  if (!R.every(Boolean)) console.log("\nSTORED HTML:\n" + html.slice(0, 900));
  const failed = R.filter((x) => !x).length;
  console.log(`\n${R.length - failed}/${R.length} checks passed`);
  if (failed) process.exitCode = 1;
} finally {
  await browser.close();
  await api(`project_pages?id=eq.${pageId}`, { method: "DELETE" });
  console.log(`deleted ${pageId}`);
}
