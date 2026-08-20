/**
 * Read-only look at the document template editor, in dark mode.
 *
 * The client's report was about how the editor reads, not about what it does:
 * "the Edit sections and Insert placeholder toolbar buttons render as dark navy
 * pills on a dark background", "most of the rich-text formatting icons look
 * grayed-out/disabled by default". Neither of those is visible from the source,
 * because the surface is a hardcoded-white page of paper wearing app chrome
 * that follows the theme - so this opens the real thing and measures the
 * contrast between each toolbar control and the surface behind it.
 *
 * What it writes, said up front: nothing, if the team owns a template. Edit on
 * a team template is `openForEdit`, a read. If the library is all examples -
 * which it is on the dev account - Edit is `copyForEditing`, which INSERTS a
 * row so there is something the team is allowed to change. This leaves through
 * Back without touching the body, which is the path `closeEditor` deletes that
 * row on, and then counts the cards again to prove the library came back the
 * same length. The database is shared with production, so the count is checked
 * rather than assumed.
 *
 * Run with: node scripts/drive-template-editor-polish.mjs
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
/*
 * Dark is the mode the bug was reported in, so it is the default. Light matters
 * too: the paper pins the light palette by redefining the theme variables to
 * the values :root already holds, so light mode should be untouched - and
 * "should be" is worth one run of THEME=light to confirm.
 */
const THEME = process.env.THEME === "light" ? "light" : "dark";
const SHOTS = `artifacts/template-editor-polish${THEME === "light" ? "-light" : ""}`;
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

/** sRGB relative luminance, for a WCAG contrast ratio. */
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
/**
 * Chromium serialises a computed colour in whatever space it was authored in,
 * so this app's variables come back as `oklab(0.22 ...)` and a naive rgb()
 * parse returns null for every single control - which reads as "nothing to
 * report" rather than "nothing was measured". Painting the colour onto a 1x1
 * canvas makes the browser do the conversion.
 */
const TO_RGB = (colour) =>
  `(() => {
    const c = new OffscreenCanvas(1, 1).getContext("2d", { willReadFrequently: true });
    c.clearRect(0, 0, 1, 1);
    c.fillStyle = ${JSON.stringify(colour)};
    c.fillRect(0, 0, 1, 1);
    return [...c.getImageData(0, 0, 1, 1).data];
  })()`;

const run = async () => {
  const { email, password } = env();
  if (!email || !password) throw new Error("email/password missing from .env");

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: THEME,
  });
  const page = await ctx.newPage();

  // ---------- login ----------
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
  console.log("login OK");

  // ---------- force the app into the mode under test ----------
  await page.evaluate((theme) => {
    localStorage.setItem("theme", theme);
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, THEME);

  // ---------- templates -> documents ----------
  await page.goto(`${BASE}/templates?tab=documents`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Use in a project", { timeout: 90000 });
  await page.waitForTimeout(1500);
  await page.evaluate(
    (theme) => document.documentElement.classList.toggle("dark", theme === "dark"),
    THEME,
  );
  await page.screenshot({ path: `${SHOTS}/01-library.png` });

  // ---------- open one the team owns, so nothing is written ----------
  const editable = await page.evaluate(() => {
    /*
     * The card has to be one the team already owns. Editing an EXAMPLE runs
     * copyForEditing, which inserts a row into a database shared with
     * production - the first version of this script read the card text looking
     * for an "Example" badge, climbed to the wrong ancestor, and duplicated
     * one.
     *
     * The "..." menu is the reliable marker: it renders under
     * `canManage && !isExample`, so a card that has one is the team's own.
     */
    const buttons = [...document.querySelectorAll("button")].filter(
      (b) => b.textContent?.trim() === "Edit",
    );
    for (let i = 0; i < buttons.length; i += 1) {
      let el = buttons[i].parentElement;
      let more = null;
      for (let up = 0; up < 6 && el && !more; up += 1) {
        more = el.querySelector('button[aria-label^="More actions for"]');
        el = el.parentElement;
      }
      if (more) return i;
    }
    return -1;
  });
  const cardsBefore = await page.getByRole("button", { name: "Use in a project" }).count();
  const target = editable < 0 ? 0 : editable;
  if (editable < 0) {
    console.log(
      `no team-owned template: opening example #0, which writes a copy that Back deletes again (${cardsBefore} cards before)`,
    );
  }
  // `hasText: /^Edit$/` never matches: the button's textContent is " Edit",
  // with the space JSX leaves between the icon and the word.
  await page.getByRole("button", { name: "Edit", exact: true }).nth(target).click();
  await page.waitForSelector("text=Save template", { timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/02-editor.png` });

  // ---------- measure the toolbar ----------
  const report = await page.evaluate(() => {
    const chrome = document.querySelector(".doc-chrome");
    if (!chrome) return { error: "no .doc-chrome in the DOM" };
    const surface = getComputedStyle(chrome).backgroundColor;
    const rows = [];
    for (const el of chrome.querySelectorAll("button")) {
      const cs = getComputedStyle(el);
      const svg = el.querySelector("svg");
      rows.push({
        label: (el.getAttribute("aria-label") || el.textContent || "?").trim().slice(0, 28),
        color: cs.color,
        background: cs.backgroundColor,
        stroke: svg ? getComputedStyle(svg).stroke : null,
      });
    }
    return { surface, rows };
  });
  if (report.error) throw new Error(report.error);

  // The page under the toolbar is white; `bg-white/95` over it composites to
  // white, and a transparent control shows it through.
  const PAPER = [255, 255, 255];
  const rgba = (colour) => page.evaluate(TO_RGB(colour));
  const over = (fg, bg) => {
    const a = bg[3] / 255;
    if (a < 0.02) return PAPER;
    return [0, 1, 2].map((i) => Math.round(bg[i] * a + PAPER[i] * (1 - a)));
  };

  console.log(`\ntoolbar surface: ${report.surface}`);
  const weak = [];
  for (const r of report.rows) {
    const fg = await rgba(r.color);
    const bg = await rgba(r.background);
    if (fg[3] < 8) continue;
    const ratio = contrast(fg.slice(0, 3), over(fg, bg));
    const flag = ratio < 4.5 ? "  <-- LOW" : "";
    if (ratio < 4.5) weak.push(`${r.label} (${ratio.toFixed(2)}:1)`);
    console.log(`  ${ratio.toFixed(2)}:1  ${r.label}${flag}`);
  }

  console.log(
    weak.length
      ? `\n${weak.length} control(s) below 4.5:1 -> ${weak.join(", ")}`
      : "\nevery toolbar control clears 4.5:1 against the paper",
  );

  // ---------- the fields panel ----------
  const panel = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll("aside input")];
    if (!inputs.length) return null;
    const aside = document.querySelector("aside");
    return {
      panelWidth: Math.round(aside.getBoundingClientRect().width),
      inputWidth: Math.round(inputs[0].getBoundingClientRect().width),
      inputHeight: Math.round(inputs[0].getBoundingClientRect().height),
      fontSize: getComputedStyle(inputs[0]).fontSize,
      count: inputs.length,
    };
  });
  console.log("\nfields panel:", panel);

  const cells = await page.evaluate(() => {
    const th = document.querySelector(".doc-page .ProseMirror table th");
    if (!th) return null;
    const cs = getComputedStyle(th);
    return { color: cs.color, background: cs.backgroundColor, border: cs.borderTopColor };
  });
  if (cells) {
    const fg = await rgba(cells.color);
    const bg = await rgba(cells.background);
    const ratio = contrast(fg.slice(0, 3), over(fg, bg));
    console.log(
      `\ntable header: ${ratio.toFixed(2)}:1 ${ratio < 4.5 ? "<-- LOW" : "ok"} (${cells.color} on ${cells.background})`,
    );
  } else {
    console.log("\ntable header: no table in this template");
  }

  await page.screenshot({
    path: `${SHOTS}/03-editor-toolbar.png`,
    clip: { x: 240, y: 90, width: 900, height: 220 },
  });

  // ---------- leave without saving ----------
  await page
    .getByRole("button", { name: "Back", exact: true })
    .first()
    .click()
    .catch(() => {});
  await page.waitForTimeout(4000);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Use in a project", { timeout: 90000 });
  await page.waitForTimeout(2000);
  const cardsAfter = await page.getByRole("button", { name: "Use in a project" }).count();
  console.log(
    `\nlibrary: ${cardsBefore} cards before, ${cardsAfter} after ${
      cardsAfter === cardsBefore ? "(clean)" : "<-- A ROW WAS LEFT BEHIND"
    }`,
  );

  // ---------- the phone story ----------
  const phone = await ctx.newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.goto(`${BASE}/templates?tab=documents`, { waitUntil: "domcontentloaded" });
  await phone.waitForSelector("text=Use in a project", { timeout: 90000 });
  await phone.waitForTimeout(1500);
  await phone.screenshot({ path: `${SHOTS}/04-phone.png`, fullPage: false });
  const gated = await phone.evaluate(() =>
    document.body.innerText.includes("Writing and editing templates is a desktop job"),
  );
  console.log(`\nphone: desktop-only note shown = ${gated}`);

  // Tapping Edit explains itself rather than opening the editor.
  await phone.getByRole("button", { name: "Edit", exact: true }).first().click();
  await phone.waitForTimeout(1200);
  const phoneBody = await phone.locator("body").innerText();
  console.log(
    `phone: Edit toasts instead of opening = ${
      phoneBody.includes("needs a bigger screen") && !phoneBody.includes("Save template")
    }`,
  );
  await phone.screenshot({ path: `${SHOTS}/05-phone-edit-blocked.png` });

  // ...and using one still works, which is the half that has to keep working.
  await phone.getByRole("button", { name: "Use in a project" }).first().click();
  await phone.waitForTimeout(2500);
  const picker = await phone.locator("body").innerText();
  console.log(`phone: Use in a project opens = ${/Pick a project/i.test(picker)}`);
  await phone.screenshot({ path: `${SHOTS}/06-phone-use.png` });
  await phone.keyboard.press("Escape");
  await phone.waitForTimeout(800);

  await browser.close();
  console.log(`\nshots in ${SHOTS}`);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
