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
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

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

/*
 * Which templates the team OWNS, by name.
 *
 * The card count cannot answer "did this run leave a row behind": a copy of an
 * example records `copiedFrom` and shadows the example it came from, so the
 * library is exactly the same length with the stray row as without it. A run
 * that stranded a copy reported "30 before, 30 after (clean)" and was believed.
 *
 * The "..." menu renders only under `canManage && !isExample`, so its labels
 * are a precise list of the rows this account can create - and therefore of the
 * rows a driver can leave behind.
 */
async function ownedTemplates(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('button[aria-label^="More actions for"]')]
      .map((b) => b.getAttribute("aria-label").replace("More actions for ", ""))
      .sort(),
  );
}

/**
 * Delete any team-owned template that was not there when this run started.
 *
 * Opening the editor on an example INSERTS a copy, and only leaving the editor
 * cleanly deletes it again - so any crash between those two points strands a
 * row in a database shared with production. That has now happened twice, both
 * times because the network to Supabase went flaky mid-run, and both times it
 * went unnoticed because the card count is blind to it (a copy shadows the
 * example it was made from).
 *
 * Called from a `finally`, so a timeout cleans up after itself. Best effort by
 * design: it reports what it could not remove rather than throwing over it.
 */
async function deleteStranded(page, ownedBefore, base) {
  try {
    await page.goto(`${base}/templates?tab=documents`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("text=Use in a project", { timeout: 60000 });
    await page.waitForTimeout(2000);
    const stranded = (await ownedTemplates(page)).filter((n) => !ownedBefore.includes(n));
    if (!stranded.length) return;
    console.log(`\ncleaning up ${stranded.length} stranded row(s): ${stranded.join(", ")}`);
    for (const name of stranded) {
      await page.locator(`button[aria-label="More actions for ${name}"]`).first().click();
      await page.waitForTimeout(500);
      await page.getByRole("menuitem", { name: /Delete/ }).click();
      await page.waitForTimeout(700);
      // confirm() is called without a confirmText, so the button says Continue.
      await page
        .locator('[role="alertdialog"] button')
        .filter({ hasText: /^Continue$/ })
        .first()
        .click();
      await page.waitForTimeout(2500);
    }
    const left = (await ownedTemplates(page)).filter((n) => !ownedBefore.includes(n));
    console.log(
      left.length
        ? `STILL STRANDED: ${left.join(", ")} - run scripts/cleanup-stray-template-copy.mjs`
        : "cleaned up",
    );
  } catch (e) {
    console.log(
      `cleanup could not run (${e.message.split("\n")[0]}) - run scripts/cleanup-stray-template-copy.mjs`,
    );
  }
}

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
  const ownedBefore = await ownedTemplates(page);

  try {
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

    // =========================================================================
    // The export itself - the half a guide is a promise about
    // =========================================================================
    //
    // Measuring the editor only proves the editor is self-consistent. The claim
    // being made is about the PDF: that the line drawn under page one is where
    // page one actually ends. So take the export, print it, and count.
    console.log("\nThe exported PDF");
    const popupPromise = page.waitForEvent("popup", { timeout: 30000 });
    await page.getByRole("button", { name: "Export PDF" }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState("domcontentloaded").catch(() => {});
    // window.print() is a no-op in headless Chromium, but stub it anyway so a
    // change of engine cannot hang the run on a dialog.
    await popup.evaluate(() => {
      window.print = () => {};
    });
    await popup.waitForTimeout(1500);

    const pdf = await popup.pdf({ format: "Letter", printBackground: true });
    writeFileSync(`${SHOTS}/03-export.pdf`, pdf);
    // Page objects in the PDF body. Good enough to count sheets, and it needs no
    // parser: pdf-lib is an API dependency, not a script one.
    const pdfPages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    console.log(`  exported ${pdfPages} pages; the editor said ${geometry.guides.length + 1}`);
    check(
      "the PDF has exactly the number of pages the editor drew",
      pdfPages === geometry.guides.length + 1,
    );

    /*
     * Does the anti-slicing actually reach the document?
     *
     * There is no way to ask the DOM where the printer put a break - pagination
     * is not exposed to script - and no PDF text extractor in this repo, so
     * "look at the pages and see" is not available either. Two things that ARE
     * checkable, and together are enough:
     *
     *   1. the rules resolve onto the elements, under print media;
     *   2. taking them away changes the PDF.
     *
     * The second is the one that matters. A rule can be present and inert; a
     * rule that moves content is doing work.
     */
    await popup.emulateMedia({ media: "print" });
    const applied = await popup.evaluate(() => {
      const styleOf = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const cs = getComputedStyle(el);
        return { inside: cs.breakInside, after: cs.breakAfter };
      };
      return {
        table: styleOf("table"),
        quote: styleOf("blockquote"),
        heading: styleOf("h2"),
        image: styleOf("img"),
        // The photo strip: several slots sharing one paragraph, which is how
        // every seeded template lays photos out. This is the "photo set up" the
        // client watched get cut in half, and it is a <p> - so without the
        // :has() rule it is the one block the plain element selectors miss.
        photoRow: styleOf("p:has(> img)"),
      };
    });
    check("tables carry break-inside: avoid when printing", applied.table?.inside === "avoid");
    check("headings carry break-after: avoid", applied.heading?.after === "avoid");
    if (applied.image) {
      check("photos carry break-inside: avoid", applied.image.inside === "avoid");
    }
    if (applied.photoRow) {
      check("a photo row is kept whole", applied.photoRow.inside === "avoid");
    } else {
      console.log("  NOTE: this template has no photo row, so that rule is unexercised here");
    }
    await popup.emulateMedia({ media: null });

    // The A/B: same document, anti-slicing stripped out.
    await popup.addStyleTag({
      content:
        "table, tr, img, blockquote, li, p { break-inside: auto !important; page-break-inside: auto !important; }" +
        "h1, h2, h3 { break-after: auto !important; page-break-after: auto !important; }",
    });
    await popup.waitForTimeout(600);
    const loosePdf = await popup.pdf({ format: "Letter", printBackground: true });
    writeFileSync(`${SHOTS}/04-export-without-avoid.pdf`, loosePdf);
    /*
     * Compared on where the content lands, not on the bytes.
     *
     * The first version of this asserted the two PDFs differ at all, and it
     * "passed" on a five-byte delta out of ninety-four thousand - which is a
     * timestamp, not a page break. A byte comparison cannot tell a layout change
     * from metadata, so it was proving nothing while looking like proof.
     *
     * Page count is the observable that means something here: a block too big to
     * finish on the current page is pushed whole onto the next one, which moves
     * everything after it.
     */
    const loosePages = (loosePdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    console.log(
      `  with the rules ${pdfPages} pages / ${pdf.length} bytes; without them ${loosePages} pages / ${loosePdf.length} bytes`,
    );
    if (pdfPages === loosePages && Math.abs(pdf.length - loosePdf.length) < 200) {
      console.log(
        "  NOTE: this document paginates the same either way, so the A/B says nothing" +
          " about the rules - the computed-style checks above are what stand.",
      );
    } else {
      check("the anti-slicing rules move content off a boundary", true);
    }
    await popup.close();

    // ---------- leave clean ----------
    console.log("\nA window narrower than the paper");
    await page.setViewportSize({ width: 820, height: 900 });
    await page.waitForTimeout(1200);
    const narrow = await page.evaluate(
      () => document.querySelector(".doc-page").getBoundingClientRect().width,
    );
    check(
      "the sheet keeps its size instead of squeezing the guides out of true",
      Math.abs(narrow - 8.5 * PX) < 2,
      `${(narrow / PX).toFixed(2)}in`,
    );
    await page.setViewportSize({ width: 1600, height: 950 });
    await page.waitForTimeout(1000);

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
    const ownedAfter = await ownedTemplates(page);
    check(`library back to ${cardsBefore} cards`, cardsAfter === cardsBefore, `${cardsAfter} now`);
    const stranded = ownedAfter.filter((n) => !ownedBefore.includes(n));
    check(
      "no template row left behind",
      stranded.length === 0,
      stranded.length ? `stranded: ${stranded.join(", ")}` : "",
    );

    const failed = results.filter((r) => !r.pass);
    console.log(
      `\n${results.length - failed.length}/${results.length} checks passed${
        failed.length ? ` - FAILED: ${failed.map((f) => f.name).join("; ")}` : ""
      }`,
    );
  } finally {
    await deleteStranded(page, ownedBefore, BASE);
  }

  await browser.close();
  // Recomputed from `results` rather than reusing `failed`: that is declared
  // inside the try block the cleanup handler wrapped around this run.
  if (results.some((r) => !r.pass)) process.exit(1);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
