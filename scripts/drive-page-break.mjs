/**
 * Renders a page break in the real editor.
 *
 * The node, its CSS and the Insert entry had all been written and none had been
 * seen. The PDF half is proven in tests/page-break-pdf.test.ts; this is the
 * other half - whether an author can tell the break landed.
 *
 * Creates one temporary page and deletes it before exiting.
 *
 *   node scripts/drive-page-break.mjs <projectId>
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const SHOTS = "artifacts/page-break";
mkdirSync(SHOTS, { recursive: true });

const PROJECT_ID = process.argv[2];
if (!PROJECT_ID) throw new Error("usage: node scripts/drive-page-break.mjs <projectId>");

function env(file) {
  const out = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
const cfg = { ...env("apps/api/.env"), ...env(".env") };
const SVC = {
  apikey: cfg.SITEPIX_SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${cfg.SITEPIX_SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};

const results = [];
const check = (n, pass, d = "") => {
  results.push(pass);
  console.log(`${pass ? "  ok  " : " FAIL "} ${n}${d ? ` - ${d}` : ""}`);
};

const BODY =
  "<h2>Section one</h2><p>Text before the break.</p>" +
  '<div data-page-break="true"></div>' +
  "<h2>Section two</h2><p>Text after the break.</p>";

const run = async () => {
  // Seed a page directly, so this exercises the editor rather than creation.
  const owner = await (
    await fetch(
      `${cfg.SITEPIX_SUPABASE_URL}/rest/v1/projects?select=created_by&id=eq.${PROJECT_ID}`,
      { headers: SVC },
    )
  ).json();
  const created = await (
    await fetch(`${cfg.SITEPIX_SUPABASE_URL}/rest/v1/project_pages`, {
      method: "POST",
      headers: { ...SVC, Prefer: "return=representation" },
      body: JSON.stringify({
        project_id: PROJECT_ID,
        created_by: owner[0].created_by,
        title: "TEMP page break check",
        content_html: BODY,
        source_template: null,
      }),
    })
  ).json();
  const pageId = created[0].id;
  console.log(`seeded temp page ${pageId}\n`);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  page.on("console", (m) => {
    if (m.type() === "error" && !/DevTools|vite|favicon/i.test(m.text()))
      errors.push(m.text().slice(0, 200));
  });

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

    await page.goto(`${BASE}/projects/${PROJECT_ID}/pages/${pageId}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector(".tiptap", { timeout: 90000 }).catch(() => {});
    await page.waitForTimeout(6000);

    // 1. The node survived being parsed back out of stored HTML.
    const count = await page.locator(".tiptap [data-page-break]").count();
    check("the break survives the HTML round trip", count === 1, `${count} in the document`);

    // 2. It is visible. A node with no content and no styling is a blank line
    //    the author cannot tell landed.
    const box = await page.locator(".tiptap [data-page-break]").first().boundingBox();
    check(
      "it occupies the full column width",
      !!box && box.width > 300,
      box ? `${Math.round(box.width)}px wide` : "no box",
    );

    const style = await page
      .locator(".tiptap [data-page-break]")
      .first()
      .evaluate((el) => {
        const cs = getComputedStyle(el);
        const after = getComputedStyle(el, "::after");
        return {
          borderTopStyle: cs.borderTopStyle,
          borderTopWidth: cs.borderTopWidth,
          label: after.content,
        };
      });
    check(
      "drawn as a dashed rule",
      style.borderTopStyle === "dashed",
      `${style.borderTopStyle} ${style.borderTopWidth}`,
    );
    check("labelled so it reads as a break", /Page break/i.test(style.label), style.label);

    // 3. The content on either side is still there and in order.
    const text = await page.locator(".tiptap").innerText();
    check(
      "content on both sides is intact and in order",
      text.indexOf("Text before the break.") < text.indexOf("Text after the break."),
    );

    await page.screenshot({ path: `${SHOTS}/1-editor.png`, fullPage: true });

    // 4. An author can insert one.
    await page
      .getByRole("button", { name: /^Insert$/ })
      .first()
      .click();
    await page.waitForTimeout(1500);
    const menu = await page
      .locator('[role="menu"]')
      .first()
      .innerText()
      .catch(() => "");
    check("Insert offers a Page break", /Page break/i.test(menu));
    await page.screenshot({ path: `${SHOTS}/2-insert-menu.png` });

    await page
      .getByRole("menuitem", { name: /Page break/i })
      .first()
      .click();
    await page.waitForTimeout(2500);
    const after = await page.locator(".tiptap [data-page-break]").count();
    check("inserting adds one", after === 2, `${after} in the document`);
    await page.screenshot({ path: `${SHOTS}/3-after-insert.png`, fullPage: true });

    console.log("\n--- browser errors ---");
    console.log(errors.length ? [...new Set(errors)].join("\n") : "  none");
    const failed = results.filter((r) => !r).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed`);
    if (failed || errors.length) process.exitCode = 1;
  } finally {
    await browser.close();
    await fetch(`${cfg.SITEPIX_SUPABASE_URL}/rest/v1/project_pages?id=eq.${pageId}`, {
      method: "DELETE",
      headers: SVC,
    });
    console.log(`deleted temp page ${pageId}`);
  }
};

run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
