/**
 * Page-break guides, and whether the Fields panel is readable.
 *
 * The client, on the same pass:
 *
 *   "the contrast on the form filing on the right side is too little. its
 *    hiding alot of text."
 *
 *   "we need a clear indication of where the page break is when we Edit these
 *    templates. when I edit them I export and the page breaks the paragraph or
 *    photo set up. it should be clearly visible on Edit page for that Template."
 *
 * Neither is answerable from source. The first is a contrast ratio against
 * whatever the panel actually resolves to in dark mode, and the second is only
 * worth anything if the line lands where the printer really cuts - so this
 * measures the paper against the export's own page box rather than trusting
 * that the constants were wired up.
 *
 * What it writes: on an all-examples library, opening the editor inserts a copy
 * that Back deletes again. Card counts are checked before and after.
 *
 * Run with: node scripts/drive-template-page-breaks.mjs
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const THEME = process.env.THEME === "light" ? "light" : "dark";
const SHOTS = `artifacts/template-page-breaks${THEME === "light" ? "-light" : ""}`;
mkdirSync(SHOTS, { recursive: true });

function env() {
  const out = {};
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

function luminance([r, g, b]) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** Computed colours come back as oklab(...); let the browser rasterise them. */
const TO_RGB = (colour) =>
  `(() => {
    const c = new OffscreenCanvas(1, 1).getContext("2d", { willReadFrequently: true });
    c.clearRect(0, 0, 1, 1);
    c.fillStyle = ${JSON.stringify(colour)};
    c.fillRect(0, 0, 1, 1);
    return [...c.getImageData(0, 0, 1, 1).data];
  })()`;

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` - ${detail}` : ""}`);
};

const run = async () => {
  const { email, password } = env();
  if (!email || !password) throw new Error("email/password missing from .env");

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 950 },
    colorScheme: THEME,
  });
  const page = await ctx.newPage();

  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.waitForSelector('button[type="submit"]', { state: "visible" });
  for (let i = 0; i < 5; i += 1) {
    await page.locator('input[type="email"]').fill("");
    await page.locator('input[type="email"]').pressSequentially(email, { delay: 8 });
    await page.locator('input[type="password"]').fill("");
    await page.locator('input[type="password"]').pressSequentially(password, { delay: 8 });
    await page.waitForTimeout(2000);
    if ((await page.locator('input[type="email"]').inputValue()) === email) break;
  }
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(5000);
  if (/\/login/.test(new URL(page.url()).pathname)) throw new Error("login failed");
  console.log(`login OK (${THEME})\n`);

  await page.evaluate((theme) => {
    localStorage.setItem("theme", theme);
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, THEME);

  await page.goto(`${BASE}/templates?tab=documents`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Use in a project", { timeout: 90000 });
  await page.waitForTimeout(1500);
  await page.evaluate(
    (theme) => document.documentElement.classList.toggle("dark", theme === "dark"),
    THEME,
  );
  const cardsBefore = await page.getByRole("button", { name: "Use in a project" }).count();

  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await page.waitForSelector("text=Save template", { timeout: 60000 });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${SHOTS}/01-editor.png` });

  const rgba = (colour) => page.evaluate(TO_RGB(colour));
  const over = (bgStack) => {
    // Composite the panel's own background over the dialog's, front to back.
    let out = [255, 255, 255];
    for (let i = bgStack.length - 1; i >= 0; i -= 1) {
      const layer = bgStack[i];
      const a = layer[3] / 255;
      if (a <= 0) continue;
      out = [0, 1, 2].map((k) => Math.round(layer[k] * a + out[k] * (1 - a)));
    }
    return out;
  };

  // ---------- the Fields panel ----------
  console.log("Fields panel contrast");
  const panel = await page.evaluate(() => {
    const aside = document.querySelector("aside");
    if (!aside) return null;
    const surface = getComputedStyle(aside).backgroundColor;
    const input = aside.querySelector("input");
    const label = aside.querySelector("label");
    const chip = aside.querySelector("button[title^='Insert']");
    const cs = input ? getComputedStyle(input) : null;
    return {
      surface,
      inputBg: cs?.backgroundColor ?? null,
      inputColor: cs?.color ?? null,
      // The placeholder is what almost every box on this panel is showing.
      placeholderColor: input ? getComputedStyle(input, "::placeholder").color || cs.color : null,
      labelColor: label ? getComputedStyle(label).color : null,
      chipColor: chip ? getComputedStyle(chip).color : null,
      chipBg: chip ? getComputedStyle(chip).backgroundColor : null,
      inputHeight: input ? Math.round(input.getBoundingClientRect().height) : 0,
    };
  });
  if (!panel) throw new Error("no fields panel on screen");

  const surfaceRgb = over([await rgba(panel.surface)]);
  const inputBgRgb = over([await rgba(panel.inputBg), await rgba(panel.surface)]);
  const ratios = {
    "typed value": contrast((await rgba(panel.inputColor)).slice(0, 3), inputBgRgb),
    "placeholder / sample value": contrast(
      (await rgba(panel.placeholderColor)).slice(0, 3),
      inputBgRgb,
    ),
    "field label": contrast((await rgba(panel.labelColor)).slice(0, 3), surfaceRgb),
    "placeholder chip": contrast(
      (await rgba(panel.chipColor)).slice(0, 3),
      over([await rgba(panel.chipBg), await rgba(panel.surface)]),
    ),
  };
  for (const [what, ratio] of Object.entries(ratios)) {
    check(`${what} reaches 4.5:1`, ratio >= 4.5, `${ratio.toFixed(2)}:1`);
  }

  // ---------- the page guides ----------
  console.log("\nPage break guides");
  const geometry = await page.evaluate(() => {
    const paper = document.querySelector(".doc-page");
    const body = paper?.querySelector(".ProseMirror");
    const guides = [...document.querySelectorAll(".doc-page-break-guide")];
    if (!paper || !body) return null;
    const paperBox = paper.getBoundingClientRect();
    const bodyBox = body.getBoundingClientRect();
    /*
     * The printable box, measured at its padding edge - NOT at the top of the
     * ProseMirror element.
     *
     * They differ by the first heading's own top margin (17.8px at these
     * sizes), which the printer lays inside page one just as the editor does.
     * Measuring from the text meant expecting the guides to be that much
     * lower than the page boundary actually is.
     */
    const box = body.closest(".flow-root");
    const boxRect = box.getBoundingClientRect();
    const contentTop = boxRect.top + parseFloat(getComputedStyle(box).paddingTop);
    return {
      paperWidth: paperBox.width,
      bodyWidth: bodyBox.width,
      bodyHeight: bodyBox.height,
      contentTop,
      fontSize: getComputedStyle(body).fontSize,
      lineHeight: getComputedStyle(body).lineHeight,
      guides: guides.map((g) => ({
        top: g.getBoundingClientRect().top - contentTop,
        label: g.getAttribute("data-label"),
      })),
    };
  });
  if (!geometry) throw new Error("no paper on screen");

  const PX = 96;
  console.log(
    `  paper ${(geometry.paperWidth / PX).toFixed(2)}in wide, column ${(
      geometry.bodyWidth / PX
    ).toFixed(2)}in, text ${geometry.fontSize}/${geometry.lineHeight}, content ${(
      geometry.bodyHeight / PX
    ).toFixed(2)}in`,
  );

  check("the paper is a Letter page", Math.abs(geometry.paperWidth - 8.5 * PX) < 2);
  check(
    "the column matches the export's printable width (7in)",
    Math.abs(geometry.bodyWidth - 7 * PX) < 2,
  );
  check("the body is set at the export's 12pt", geometry.fontSize === "16px");

  const expected = Math.max(0, Math.ceil(geometry.bodyHeight / (9.5 * PX) - 0.001) - 1);
  check(
    `one guide per page boundary (${expected})`,
    geometry.guides.length === expected,
    `${geometry.guides.length} drawn`,
  );
  const drift = geometry.guides.map((g, i) => (g.top - (i + 1) * 9.5 * PX).toFixed(1));
  // Sub-pixel only: the guides are laid out in CSS inches, same as the @page.
  const misplaced = geometry.guides.filter(
    (g, i) => Math.abs(g.top - (i + 1) * 9.5 * PX) > 2 || g.label !== `Page ${i + 2}`,
  );
  check(
    "each one sits exactly one printable page below the last",
    misplaced.length === 0,
    `drift px: ${drift.join(", ")}`,
  );

  if (geometry.guides.length) {
    const first = geometry.guides[0];
    await page.evaluate((y) => {
      const body = document.querySelector(".doc-page .ProseMirror");
      const top = body.getBoundingClientRect().top + window.scrollY + y;
      document.querySelector(".flex-1.overflow-y-auto")?.scrollTo({ top: y - 200 });
    }, first.top);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${SHOTS}/02-guide.png` });
  }

  // ---------- leave clean ----------
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.waitForTimeout(1200);
  await page
    .getByRole("button", { name: /^Discard/ })
    .click()
    .catch(() => {});
  await page.waitForTimeout(4000);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Use in a project", { timeout: 90000 });
  await page.waitForTimeout(2000);
  const cardsAfter = await page.getByRole("button", { name: "Use in a project" }).count();
  check(`library back to ${cardsBefore} cards`, cardsAfter === cardsBefore, `${cardsAfter} now`);

  const failed = results.filter((r) => !r.pass);
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed${
      failed.length ? ` - FAILED: ${failed.map((f) => f.name).join("; ")}` : ""
    }`,
  );
  await browser.close();
  if (failed.length) process.exit(1);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
