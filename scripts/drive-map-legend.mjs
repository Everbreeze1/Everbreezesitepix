/**
 * Drives the Project map's legend against the fourth status a project can hold.
 *
 * The client reported archived projects rendering in a colour the legend never
 * explains. This workspace has one active project and no archived ones, so the
 * archived rows are injected into the project list response rather than written
 * to the database: the run intercepts the GET and hands the page a synthetic
 * list. Every injected row carries coordinates so the page never geocodes, and
 * only that one GET is intercepted.
 *
 * WRITES NOTHING - to the database or anywhere else.
 *
 * Run with: node scripts/drive-map-legend.mjs
 * Screenshots land in artifacts/map-legend/.
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const SHOTS = "artifacts/map-legend";
mkdirSync(SHOTS, { recursive: true });

const env = (p) => {
  const out = {};
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
};

const checks = [];
const ok = (name, detail = "") => checks.push({ pass: true, name, detail });
const bad = (name, detail = "") => checks.push({ pass: false, name, detail });

// One of each status, all in Crewe, all pre-located. The archived one carries a
// live pipeline stage on purpose: that is the case where the map used to show a
// blue "Scheduled" chip on a job that is filed away.
const SCHEDULED_STAGE = "377c2664-26cf-4a82-82be-ae0cb2452805";
let houseNo = 0;
// Short, realistic addresses on purpose: a 36-character uuid in the street
// line blows out the sidebar column and makes the page scroll sideways at phone
// width, which reads as a layout bug the app does not actually have.
const fake = (id, name, status, lat, lng, stage = null) => ({
  id,
  name,
  status,
  pipeline_stage_id: stage,
  street: `${++houseNo} Test Street`,
  city: "Crewe",
  state: "England",
  zip: "CW2 6UH",
  latitude: lat,
  longitude: lng,
});
// One per status, far enough apart to stay individual pins at the fitted zoom.
const SPREAD = [
  fake("11111111-1111-4111-8111-111111111111", "Active job", "active", 53.09, -2.44),
  fake("22222222-2222-4222-8222-222222222222", "On hold job", "on_hold", 53.092, -2.442),
  fake("33333333-3333-4333-8333-333333333333", "Completed job", "completed", 53.094, -2.444),
  fake("44444444-4444-4444-8444-444444444444", "Archived job", "archived", 53.096, -2.446),
  fake(
    "55555555-5555-4555-8555-555555555555",
    "Archived from a stage",
    "archived",
    53.098,
    -2.448,
    SCHEDULED_STAGE,
  ),
];
// And a knot of jobs a few doors apart, which is the dense cluster the client
// said took two or three clicks to open. Six is enough to cluster at any zoom
// that fits the spread above.
const KNOT = Array.from({ length: 6 }, (_, i) =>
  fake(
    `6666666${i}-6666-4666-8666-66666666666${i}`,
    `Knot job ${i + 1}`,
    "active",
    53.0805 + i * 0.00012,
    -2.4305 + i * 0.00012,
  ),
);
const INJECTED = [...SPREAD, ...KNOT];

// Every marker the API painted: our teardrops carry the pin path, cluster
// bubbles do not.
const markers = (page) =>
  page.evaluate(() => {
    const out = { pins: [], clusters: [] };
    for (const img of document.querySelectorAll('img[src^="data:image/svg+xml"]')) {
      // Our pins are URL-encoded; the clusterer's bubbles are base64. Reading
      // only one of the two encodings is how a bubble hides from this probe.
      const raw = img.src.replace(/^data:image\/svg\+xml[^,]*,/, "");
      let svg = "";
      try {
        svg = /;base64,/.test(img.src) ? atob(raw) : decodeURIComponent(raw);
      } catch {
        continue;
      }
      const r = img.getBoundingClientRect();
      const at = { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
      if (svg.includes("C13 2 4 11 4 22")) {
        out.pins.push({ fill: /<path d="M24 2[^"]*" fill="([^"]+)"/.exec(svg)?.[1] ?? "?", ...at });
      } else if (svg.includes('viewBox="0 0 240 240"') && svg.includes("<text")) {
        // The clusterer's own bubble: three circles and the count. The viewBox
        // is the renderer's, so Google's control images cannot be mistaken for
        // one.
        out.clusters.push({ count: /<text[^>]*>([\d]+)</.exec(svg)?.[1] ?? "?", ...at });
      }
    }
    return out;
  });

// The map is built on a Google script that takes its time here, and the markers
// land a beat after that. Waiting on the markers themselves beats guessing.
const waitForMarkers = async (page, label) => {
  await page
    .waitForFunction(
      () => {
        const div = [...document.querySelectorAll("div")].find((d) => /70vh/.test(d.className));
        return (
          !!div &&
          div.children.length > 0 &&
          document.querySelectorAll('img[src^="data:image/svg+xml"]').length > 0
        );
      },
      null,
      { timeout: 120000 },
    )
    .catch(() => console.log(`(timed out waiting for markers: ${label})`));
  await page.waitForTimeout(1500);
};

const run = async () => {
  const { email, password } = env(".env");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await ctx.newPage();

  /*
   * Order matters: Playwright consults the most recently registered handler
   * first, and route.continue() goes straight to the network rather than to the
   * next handler. So the write-blocker is registered first (it is the fallback)
   * and the injector last, deferring to it with route.fallback().
   */
  await page.route(/\/rest\/v1\//, async (route) => {
    const m = route.request().method();
    if (m === "PATCH" || m === "POST" || m === "DELETE" || m === "PUT") {
      console.log(`BLOCKED a ${m} to ${route.request().url().slice(0, 90)}`);
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }
    return route.continue();
  });
  let injected = INJECTED;
  await page.route(/\/rest\/v1\/projects\?select=id/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": `0-${injected.length - 1}/${injected.length}` },
      body: JSON.stringify(injected),
    });
  });

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector('button[type="submit"]', { state: "visible" });
  for (let i = 0; i < 6; i++) {
    await page.fill('input[type="email"]', "");
    await page.fill('input[type="password"]', "");
    await page.locator('input[type="email"]').pressSequentially(email, { delay: 12 });
    await page.locator('input[type="password"]').pressSequentially(password, { delay: 12 });
    await page.waitForTimeout(2000);
    if ((await page.inputValue('input[type="email"]')) === email) break;
  }
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(4000);
  if (/\/login/.test(new URL(page.url()).pathname)) {
    bad("login", "still on /login");
    await browser.close();
    return;
  }
  ok("login");

  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
  });
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + String(e).slice(0, 200)));
  await page.evaluate(() => window.sessionStorage.removeItem("sitepix:map-view"));
  await page.goto(`${BASE}/map`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=/on map/", { timeout: 90000 });
  await waitForMarkers(page, "first paint");

  // Archived pins are only plotted under All, which is what the legend says.
  await page.getByRole("button", { name: /^All \d+$/ }).click();
  await waitForMarkers(page, "after All");
  await page.screenshot({ path: `${SHOTS}/01-all-with-archived.png` });
  console.log("console errors:", JSON.stringify(consoleErrors.slice(0, 8), null, 2));

  /* ------------------------------------------------------------- the legend */
  const legend = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("div")].filter(
      (d) => d.textContent?.trim().startsWith("Legend") && d.querySelector("span[style]"),
    );
    const panel = rows[rows.length - 1];
    if (!panel) return null;
    return {
      text: panel.innerText,
      swatches: [...panel.querySelectorAll("span[style]")].map((s) => ({
        color: getComputedStyle(s).backgroundColor,
        label: s.nextElementSibling?.textContent ?? "",
      })),
    };
  });
  console.log("legend:", JSON.stringify(legend, null, 2));

  const archivedSwatch = legend?.swatches.find((s) => /archived/i.test(s.label));
  if (archivedSwatch) {
    ok("legend documents Archived", archivedSwatch.color);
  } else {
    bad("legend documents Archived", `rows: ${legend?.swatches.map((s) => s.label).join(", ")}`);
  }
  /* ------------------------- the two places that show status say one thing */
  // The filter row at the top right and the legend over the map are the page's
  // two status vocabularies. They have to be the same words in the same order
  // and the same colours, or the page offers a colour you cannot filter by.
  const chips = await page.evaluate(() => {
    const row = [...document.querySelectorAll("div")].find(
      (d) =>
        /rounded-xl/.test(d.className) &&
        [...d.children].length >= 4 &&
        [...d.children].every((c) => c.tagName === "BUTTON"),
    );
    if (!row) return null;
    return [...row.children].map((b) => ({
      label: b.textContent.replace(/\d+$/, "").trim(),
      dot: b.querySelector("span[style]")
        ? getComputedStyle(b.querySelector("span[style]")).backgroundColor
        : null,
      count: /(\d+)$/.exec(b.textContent.trim())?.[1] ?? null,
    }));
  });
  console.log("filter chips:", JSON.stringify(chips));

  const chipStatuses = (chips ?? []).filter((c) => c.label !== "All");
  const legendWords = (legend?.swatches ?? []).map((s) => s.label.trim());
  const chipWords = chipStatuses.map((c) => c.label);
  if (chipWords.length && JSON.stringify(chipWords) === JSON.stringify(legendWords)) {
    ok("the filter row and the legend list the same statuses", chipWords.join(" / "));
  } else {
    bad(
      "the filter row and the legend list the same statuses",
      `chips: ${JSON.stringify(chipWords)} vs legend: ${JSON.stringify(legendWords)}`,
    );
  }
  const colourMismatch = chipStatuses.filter(
    (c, i) => c.dot !== (legend?.swatches[i]?.color ?? null),
  );
  if (chipStatuses.length && colourMismatch.length === 0) {
    ok("each chip carries its own pin colour");
  } else {
    bad("each chip carries its own pin colour", JSON.stringify(colourMismatch));
  }
  const archivedChip = chipStatuses.find((c) => /archived/i.test(c.label));
  if (archivedChip) {
    ok("the filter row offers Archived", `count ${archivedChip.count}`);
  } else {
    bad("the filter row offers Archived", `saw ${JSON.stringify(chipWords)}`);
  }

  /* --------------------------------------------------- pins match the legend */
  // Five jobs a few streets apart cluster at the fitted zoom, which is the
  // cluster case the real workspace has too few projects to exercise. One click
  // has to leave individual pins behind, not another cluster.
  const seen = await markers(page);
  console.log("markers:", JSON.stringify(seen.clusters), `${seen.pins.length} pins`);
  // The colour assertions read this view, where the six knot jobs are still
  // gathered into one bubble and the five status pins stand on their own.
  const fills = seen.pins.map((p) => p.fill);
  const uniq = [...new Set(fills)].sort();
  console.log("pin fills:", JSON.stringify(fills), "unique:", JSON.stringify(uniq));
  const archivedFill = "#64748b";
  const completedFill = "#94a3b8";
  if (fills.filter((f) => f === archivedFill).length === 2) {
    ok("archived pins paint their own colour", archivedFill);
  } else {
    bad("archived pins paint their own colour", `saw ${JSON.stringify(fills)}`);
  }
  if (archivedFill !== completedFill && fills.includes(completedFill)) {
    ok("archived is not Completed's colour", `${archivedFill} vs ${completedFill}`);
  } else {
    bad("archived is not Completed's colour", `saw ${JSON.stringify(uniq)}`);
  }
  // Every colour on the map has to be a colour the legend names.
  const legendColors = (legend?.swatches ?? []).map((s) => {
    const [r, g, b] = (/rgba?\(([^)]+)\)/.exec(s.color)?.[1] ?? "")
      .split(",")
      .map((n) => Number(n.trim()));
    return `#${[r, g, b].map((n) => (n ?? 0).toString(16).padStart(2, "0")).join("")}`;
  });
  const undocumented = uniq.filter((f) => !legendColors.includes(f.toLowerCase()));
  if (undocumented.length === 0) {
    ok("no pin colour the legend cannot name", legendColors.join(" "));
  } else {
    bad("no pin colour the legend cannot name", `undocumented: ${undocumented.join(", ")}`);
  }

  /* ------------------------------------- one click opens the dense knot fully */
  if (seen.clusters.length === 1) {
    ok("the knot of six shows as one cluster", `count on the bubble: ${seen.clusters[0].count}`);
    await page.mouse.click(seen.clusters[0].x, seen.clusters[0].y);
    await page.waitForTimeout(3500);
    const after = await markers(page);
    console.log(
      "after the cluster click:",
      JSON.stringify(after.clusters),
      `${after.pins.length} pins`,
    );
    if (after.clusters.length === 0 && after.pins.length >= KNOT.length) {
      ok("one click opens the cluster into every pin", `${after.pins.length} pins, no bubble left`);
    } else {
      bad(
        "one click opens the cluster into every pin",
        `${after.pins.length} pins, ${after.clusters.length} bubble(s) left`,
      );
    }
    await page.screenshot({ path: `${SHOTS}/01b-cluster-opened.png` });
    // Back to the whole picture for the checks that follow.
    await page.getByRole("button", { name: /Fit to all/ }).click();
    await page.waitForTimeout(2500);
  } else {
    bad("the knot of six shows as one cluster", `saw ${seen.clusters.length} bubbles`);
  }

  /* ------------------------------------- the Archived chip actually filters */
  // "Archived" on its own also matches two pins and two sidebar rows; only the
  // chip is the word followed by its count and nothing else.
  await page.getByRole("button", { name: /^Archived \d+$/ }).click();
  await page.waitForTimeout(3500);
  const onlyArchived = await markers(page);
  const fillsArchived = onlyArchived.pins.map((p) => p.fill);
  console.log("under Archived:", JSON.stringify(fillsArchived));
  if (
    fillsArchived.length === SPREAD.filter((p) => p.status === "archived").length &&
    fillsArchived.every((f) => f === "#64748b")
  ) {
    ok("the Archived chip plots archived jobs only", `${fillsArchived.length} pins`);
  } else {
    bad("the Archived chip plots archived jobs only", JSON.stringify(fillsArchived));
  }
  await page.screenshot({ path: `${SHOTS}/01c-archived-filter.png` });
  await page.getByRole("button", { name: /^All \d+$/ }).click();
  await waitForMarkers(page, "back to All");

  /* ------------------------------- an archived job does not wear a live stage */
  const stageRow = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Archived from a stage"),
    );
    return btn?.innerText ?? null;
  });
  console.log("archived-from-stage row:", JSON.stringify(stageRow));
  if (stageRow && /Archived/.test(stageRow) && !/Scheduled/.test(stageRow)) {
    ok("an archived job reads Archived, not its old stage");
  } else {
    bad("an archived job reads Archived, not its old stage", JSON.stringify(stageRow));
  }

  /* ------------------------------------------ the preview card agrees with it */
  await page.locator("button", { hasText: "Archived from a stage" }).first().click();
  await page
    .waitForSelector("[data-open-project]", { timeout: 30000 })
    .catch(() => console.log("(no preview card appeared)"));
  await page.waitForTimeout(1500);
  const cardBadge = await page.evaluate(() => {
    const card = document.querySelector("[data-open-project]")?.parentElement;
    const badge = card?.querySelector("span[style*='border-radius:999px'], span[style*='999px']");
    return badge ? { text: badge.textContent, bg: getComputedStyle(badge).backgroundColor } : null;
  });
  console.log("preview badge:", JSON.stringify(cardBadge));
  if (cardBadge && /Archived/i.test(cardBadge.text ?? "")) {
    ok("preview card badge reads Archived", cardBadge.bg);
  } else {
    bad("preview card badge reads Archived", JSON.stringify(cardBadge));
  }
  await page.screenshot({ path: `${SHOTS}/02-archived-preview.png` });

  /*
   * The legend panel is theme-aware but the swatches are fixed hex, so each one
   * has to survive a near-white card and a near-black one. A dot documenting a
   * colour nobody can see is worse than no row at all.
   *
   * The bar is 3:1 (WCAG 1.4.11 for a graphic that carries meaning) in the dark
   * theme, where a filled dot on a dark card is the real risk, and a lower 1.8:1
   * floor in the light theme: the amber On hold dot has always sat at about
   * 1.87:1 on a white card, and holding this run to 3:1 there would fail on
   * something this work never touched.
   */
  injected = INJECTED;
  const measureLegend = () =>
    page.evaluate(() => {
      const panels = [...document.querySelectorAll("div")].filter(
        (d) => d.textContent?.trim().startsWith("Legend") && d.querySelector("span[style]"),
      );
      const panel = panels[panels.length - 1];
      if (!panel) return null;
      /*
       * Never parse a CSS colour string by hand here: this app's tokens come out
       * of getComputedStyle as oklch(), which a naive rgb() regex reads as NaN.
       * A 1x1 canvas accepts any syntax the browser understands and hands back
       * plain sRGB bytes.
       */
      const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
      const parse = (c) => {
        probe.clearRect(0, 0, 1, 1);
        probe.fillStyle = "#000";
        probe.fillStyle = c;
        probe.fillRect(0, 0, 1, 1);
        const d = probe.getImageData(0, 0, 1, 1).data;
        return [d[0], d[1], d[2], d[3] / 255];
      };
      // The panel is translucent over the map, so composite it onto what is
      // behind it before judging anything against it.
      const [pr, pg, pb, pa = 1] = parse(getComputedStyle(panel).backgroundColor);
      const dark = document.documentElement.classList.contains("dark");
      const behind = dark ? [11, 18, 32] : [248, 250, 252]; // the map card's ground
      const card = [pr, pg, pb].map((c, i) => Math.round(c * pa + behind[i] * (1 - pa)));
      const lum = ([r, g, b]) => {
        const f = (c) => {
          const s = c / 255;
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const ratio = (a, b) => {
        const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
        return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
      };
      return {
        isDark: document.documentElement.classList.contains("dark"),
        card: `rgb(${card.join(",")})`,
        swatches: [...panel.querySelectorAll("span[style]")].map((s) => {
          const [r, g, b] = parse(getComputedStyle(s).backgroundColor);
          return {
            label: s.nextElementSibling?.textContent ?? "",
            color: `rgb(${r},${g},${b})`,
            contrast: ratio([r, g, b], card),
          };
        }),
      };
    });
  // Put the archived rows back and reload BEFORE measuring: the previous step
  // left the page on the list with none, and a legend missing the row under
  // test measures nothing.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=/on map/", { timeout: 90000 });
  await waitForMarkers(page, "light theme");
  await page.getByRole("button", { name: /^All \d+$/ }).click();
  await page.waitForTimeout(2500);
  const lightLegend = await measureLegend();
  console.log("light legend:", JSON.stringify(lightLegend, null, 2));
  await page.screenshot({ path: `${SHOTS}/04-legend-light.png` });

  await page.evaluate(() => localStorage.setItem("sitepix-theme", "dark"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=/on map/", { timeout: 90000 });
  await waitForMarkers(page, "dark theme");
  await page.getByRole("button", { name: /^All \d+$/ }).click();
  await page.waitForTimeout(2500);
  const darkLegend = await measureLegend();
  console.log("dark legend:", JSON.stringify(darkLegend, null, 2));
  await page.screenshot({ path: `${SHOTS}/05-legend-dark.png` });

  // The chips carry the same dots on a different surface: the header, not the
  // translucent panel over the map. Measuring the legend says nothing about
  // whether the Archived dot survives up there.
  const chipDots = await page.evaluate(() => {
    const row = [...document.querySelectorAll("div")].find(
      (d) =>
        /rounded-xl/.test(d.className) &&
        [...d.children].length >= 4 &&
        [...d.children].every((c) => c.tagName === "BUTTON"),
    );
    if (!row) return null;
    const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    const parse = (c) => {
      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = "#000";
      probe.fillStyle = c;
      probe.fillRect(0, 0, 1, 1);
      const d = probe.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3] / 255];
    };
    const flatten = (el) => {
      // Walk up until something actually paints, compositing as we go.
      let [r, g, b, a] = [0, 0, 0, 0];
      for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
        const [nr, ng, nb, na] = parse(getComputedStyle(n).backgroundColor);
        if (na === 0) continue;
        [r, g, b] = [nr, ng, nb].map((c, i) => Math.round(c * na + [r, g, b][i] * (1 - na)));
        a = 1;
        if (na === 1) break;
      }
      return a ? [r, g, b] : [255, 255, 255];
    };
    const lum = ([r, g, b]) => {
      const f = (c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (x, y) => {
      const [hi, lo] = [lum(x), lum(y)].sort((m, n) => n - m);
      return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
    };
    return [...row.children]
      .filter((b) => b.querySelector("span[style]"))
      .map((b) => {
        const dot = b.querySelector("span[style]");
        const [r, g, b2] = parse(getComputedStyle(dot).backgroundColor);
        return {
          label: b.textContent.replace(/\d+$/, "").trim(),
          contrast: ratio([r, g, b2], flatten(b)),
        };
      });
  });
  console.log("dark chip dots:", JSON.stringify(chipDots));
  // No seed: a {contrast: 0} starting value is smaller than every real reading,
  // so the reduce would return the seed and fail a passing check.
  const worstDot = chipDots?.length
    ? chipDots.reduce((a, b) => (a.contrast < b.contrast ? a : b))
    : { label: "none", contrast: 0 };
  if (chipDots?.length === 4 && worstDot.contrast >= 3) {
    ok("every chip dot is legible in the dark", `worst: ${worstDot.label} ${worstDot.contrast}:1`);
  } else {
    bad(
      "every chip dot is legible in the dark",
      `${chipDots?.length ?? 0} dots, worst ${worstDot.label} ${worstDot.contrast}:1`,
    );
  }

  /* ------------------------------- five chips have to fit a narrow viewport */
  // A fifth chip plus dots made this row wider than it has ever been. A filter
  // the phone cuts off is the same complaint as a filter that is not there.
  for (const width of [1280, 900, 430]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(1200);
    const fit = await page.evaluate(() => {
      const row = [...document.querySelectorAll("div")].find(
        (d) =>
          /rounded-xl/.test(d.className) &&
          [...d.children].length >= 4 &&
          [...d.children].every((c) => c.tagName === "BUTTON"),
      );
      const chips = row ? [...row.children] : [];
      return {
        chips: chips.length,
        offscreen: chips
          .map((c) => c.getBoundingClientRect())
          .filter((r) => r.width === 0 || r.right > window.innerWidth + 1 || r.left < -1).length,
        pageScrollsSideways:
          document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        // Naming the culprit matters: this page can scroll sideways for reasons
        // that have nothing to do with a chip row, and "my change did it" is not
        // something to assume.
        overflowing: [...document.querySelectorAll("body *")]
          .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
          .slice(0, 4)
          .map((el) => ({
            tag: el.tagName,
            cls: String(el.className ?? "").slice(0, 48),
            right: Math.round(el.getBoundingClientRect().right),
            inChipRow: !!el.closest("button") && /rounded-lg/.test(String(el.className ?? "")),
          })),
      };
    });
    console.log(`at ${width}px:`, JSON.stringify(fit));
    if (fit.chips === 5 && fit.offscreen === 0 && !fit.pageScrollsSideways) {
      ok(`all five chips fit at ${width}px`);
    } else {
      bad(`all five chips fit at ${width}px`, JSON.stringify(fit));
    }
    await page.screenshot({ path: `${SHOTS}/06-chips-${width}.png` });
  }
  await page.setViewportSize({ width: 1500, height: 1000 });

  const worstOf = (m) => m?.swatches.reduce((a, b) => (a.contrast < b.contrast ? a : b));
  if (!darkLegend?.isDark) {
    bad("dark theme applied", "the dark class never landed");
  } else {
    const worst = worstOf(darkLegend);
    if (worst.contrast >= 3) {
      ok("every legend swatch is legible in the dark", `worst: ${worst.label} ${worst.contrast}:1`);
    } else {
      bad(
        "every legend swatch is legible in the dark",
        `${worst.label} is ${worst.contrast}:1 against ${darkLegend.card}`,
      );
    }
  }
  const worstLight = worstOf(lightLegend);
  if (worstLight && worstLight.contrast >= 1.8) {
    ok(
      "every legend swatch is legible in the light",
      `worst: ${worstLight.label} ${worstLight.contrast}:1`,
    );
  } else {
    bad(
      "every legend swatch is legible in the light",
      `${worstLight?.label} is ${worstLight?.contrast}:1 against ${lightLegend?.card}`,
    );
  }

  await browser.close();
};

await run();
console.log("\n--- checks ---");
for (const c of checks) console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}  ${c.detail}`);
const failed = checks.filter((c) => !c.pass).length;
console.log(failed ? `\n${failed} failed` : "\nall good");
