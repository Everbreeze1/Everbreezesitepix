import { chromium } from "playwright";

const BASE = "http://localhost:8080";
const SHOT = process.env.SHOT_DIR;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();

const errs = [];
page.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 200)));
page.on("pageerror", (e) => errs.push("PAGEERR " + String(e).slice(0, 200)));

const shot = async (n) => {
  if (SHOT) {
    await page.screenshot({ path: `${SHOT}/${n}.png` });
    console.log("  shot:", n);
  }
};
const body = async () =>
  (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();

// --- login ---
await page.goto(BASE + "/login", { waitUntil: "networkidle", timeout: 60000 });
await page.fill('input[type="email"]', process.env.APP_EMAIL);
await page.fill('input[type="password"]', process.env.APP_PASS);
await page.click('button[type="submit"]');
for (let i = 0; i < 40 && page.url().includes("/login"); i++) await page.waitForTimeout(1000);
await page.waitForTimeout(3000);

// --- Workflows tab ---
await page.goto(BASE + "/templates", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(3000);
await page.locator("[role=tab]", { hasText: "Workflows" }).first().click({ timeout: 15000 }).catch(async () => { await page.getByText("Workflows", { exact: true }).first().click(); });
await page.waitForTimeout(3000);
console.log("=== Workflows tab ===");
console.log((await body()).slice(300, 1000));
await shot("20-workflows-tab");

// Create a workflow if the editor isn't present
const hasEditor = (await page.getByText(/Add phase/i).count()) > 0;
console.log("editor present:", hasEditor);

if (!hasEditor) {
  const newBtn = page.getByRole("button", { name: /New workflow|New template|Create/i }).first();
  if ((await newBtn.count()) > 0) {
    await newBtn.click();
    await page.waitForTimeout(1500);
    const nameInput = page.locator('input[placeholder*="name" i], input').first();
    await nameInput.fill("AUTOSAVE PROBE");
    await page.waitForTimeout(400);
    const submit = page.getByRole("button", { name: /^Create|Add|Save/i }).last();
    await submit.click();
    await page.waitForTimeout(4000);
    console.log("created workflow");
    await shot("21-after-create");
  }
}

console.log("\n=== state after create attempt ===");
console.log((await body()).slice(300, 1100));
await shot("22-editor");

if (errs.length) console.log("\nERR:\n  " + [...new Set(errs)].slice(0, 8).join("\n  "));
await browser.close();
