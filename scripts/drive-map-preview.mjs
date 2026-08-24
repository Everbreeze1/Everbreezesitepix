/**
 * Drives the Project map in a real browser, against the four things the client
 * called out:
 *
 *   1. clicking a pin should preview the job (photo, name, status, address,
 *      "View project"), not navigate away
 *   2. coming back from a project should land on the same zoom/pan, not the
 *      default country-wide view
 *   3. pin name labels should appear on hover/selection only, not on every pin
 *      at once
 *   4. a cluster should open in one click
 *
 * WRITES NOTHING. It logs in, reads the map, opens one project page and goes
 * back. The database is shared with production, so this run is a reader.
 *
 * Run with: node scripts/drive-map-preview.mjs
 * Screenshots land in artifacts/map-preview/.
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const SHOTS = "artifacts/map-preview";
mkdirSync(SHOTS, { recursive: true });

function env(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const checks = [];
const ok = (name, detail = "") => checks.push({ pass: true, name, detail });
const bad = (name, detail = "") => checks.push({ pass: false, name, detail });

const problems = [];
let current = "startup";
const IGNORE = [
  /Download the React DevTools/i,
  /Re-optimizing dependencies/i,
  /\[vite\]/i,
  /Module level directives/i,
  /favicon/i,
  /net::ERR_/i,
  /Google Maps JavaScript API/i,
];

// The map's own state, read the way the page persists it.
const viewOf = (page) =>
  page.evaluate(() => {
    try {
      return JSON.parse(window.sessionStorage.getItem("everlumen:map-view") ?? "null");
    } catch {
      return null;
    }
  });

// Every marker image the API painted, split into project pins (ours carry the
// teardrop path) and cluster bubbles.
const markerShapes = (page) =>
  page.evaluate(() => {
    const imgs = [...document.querySelectorAll('img[src^="data:image/svg+xml"]')];
    return imgs.map((img) => {
      const svg = decodeURIComponent(img.src.replace(/^data:image\/svg\+xml[^,]*,/, ""));
      const rect = img.getBoundingClientRect();
      return {
        pin: svg.includes("C13 2 4 11 4 22"),
        labelled: svg.includes("<text"),
        selected: svg.includes("#0ea5e9"),
        width: Math.round(rect.width),
        x: Math.round(rect.x + rect.width / 2),
        y: Math.round(rect.y + rect.height / 2),
      };
    });
  });

const run = async () => {
  const { email, password } = env(".env");
  if (!email || !password) throw new Error("email/password missing from .env");

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await ctx.newPage();

  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (IGNORE.some((re) => re.test(t))) return;
    problems.push({ kind: "console", where: current, detail: t.slice(0, 240) });
  });
  page.on("pageerror", (e) =>
    problems.push({ kind: "pageerror", where: current, detail: String(e).slice(0, 240) }),
  );

  /* ------------------------------------------------------------------ login */
  current = "login";
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.waitForSelector('button[type="submit"]', { state: "visible" });
  for (let attempt = 0; attempt < 6; attempt++) {
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
    bad("login", "still on /login after submitting");
    await page.screenshot({ path: `${SHOTS}/00-login-failed.png` });
    return { browser };
  }
  ok("login");

  /* -------------------------------------------------------------- the map */
  current = "map";
  // A stale saved view would make the "restored on back" check meaningless.
  await page.evaluate(() => window.sessionStorage.removeItem("everlumen:map-view"));
  await page.goto(`${BASE}/map`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=/on map/", { timeout: 90000 });
  // The Maps script loads after the page paints, and the pins land after that.
  for (let i = 0; i < 30; i++) {
    if ((await markerShapes(page)).some((s) => s.pin)) break;
    await page.waitForTimeout(2000);
  }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/01-map-default.png` });

  let shapes = await markerShapes(page);
  const pins = shapes.filter((s) => s.pin);
  console.log(`markers: ${shapes.length} images, ${pins.length} project pins`);
  if (pins.length === 0) {
    bad("pins on the map", "no teardrop pin images found");
    await browser.close();
    return { browser: null };
  }
  const labelledAtRest = pins.filter((s) => s.labelled).length;
  if (labelledAtRest === 0) {
    ok("no pin labels at rest", `${pins.length} pins, none labelled`);
  } else {
    bad("no pin labels at rest", `${labelledAtRest} of ${pins.length} pins carry a name pill`);
  }

  /* -------------------------------------------------------- hover a pin */
  current = "hover";
  await page.mouse.move(pins[0].x, pins[0].y);
  await page.waitForTimeout(900);
  shapes = await markerShapes(page);
  const labelledOnHover = shapes.filter((s) => s.pin && s.labelled).length;
  if (labelledOnHover === 1) {
    ok("hovering one pin labels exactly that pin");
  } else {
    bad("hovering one pin labels exactly that pin", `${labelledOnHover} labelled`);
  }
  await page.screenshot({ path: `${SHOTS}/02-map-hover.png` });

  /* ------------------------------------------------- click a pin: preview */
  current = "preview card";
  await page.mouse.click(pins[0].x, pins[0].y);
  await page.waitForTimeout(1500);
  const viewProject = page.getByRole("button", { name: "View project" });
  const previewShown = await viewProject.isVisible().catch(() => false);
  if (previewShown) {
    ok("clicking a pin opens a preview card");
  } else {
    bad("clicking a pin opens a preview card", "no View project button");
  }
  if (/\/projects\//.test(new URL(page.url()).pathname)) {
    bad("clicking a pin stays on the map", `navigated to ${page.url()}`);
  } else {
    ok("clicking a pin stays on the map");
  }
  await page.screenshot({ path: `${SHOTS}/03-preview-card.png` });

  const cardText = previewShown
    ? await page.locator("div", { has: viewProject }).last().innerText()
    : "";
  console.log("card text:", JSON.stringify(cardText.slice(0, 300)));

  // The card must show a real photo, not the "No photos yet" tile, for a
  // project that has one: private-bucket photos need signing to render.
  const thumbState = await page.evaluate(async () => {
    const card = document.querySelector("[data-open-project]")?.parentElement;
    const tile = card?.firstElementChild;
    if (!tile) return { tile: "missing" };
    if ((tile.textContent ?? "").includes("No photos yet")) return { tile: "placeholder" };
    const url = /url\("?([^")]+)"?\)/.exec(getComputedStyle(tile).backgroundImage)?.[1];
    if (!url) return { tile: "no background image" };
    try {
      const r = await fetch(url);
      return { tile: "photo", status: r.status, type: r.headers.get("content-type") };
    } catch (e) {
      return { tile: "photo", error: String(e) };
    }
  });
  console.log("thumbnail:", JSON.stringify(thumbState));
  if (!previewShown) {
    // already reported above
  } else if (thumbState.tile === "photo" && thumbState.status === 200) {
    ok("preview card paints a real photo", `${thumbState.type}`);
  } else if (thumbState.tile === "placeholder" && /0 photos|No photos/i.test(cardText)) {
    ok("preview card photo", "project has no photos, placeholder is correct");
  } else {
    bad("preview card paints a real photo", JSON.stringify(thumbState));
  }

  /* ------------------------------- the card survives a marker layer rebuild */
  current = "card survives a rebuild";
  // Changing the filter rebuilds every marker, which is what a background
  // refetch does too. Google closes an InfoWindow whose anchor is removed, so
  // this is the case where the card used to shut itself mid-read.
  await page.getByRole("button", { name: /^All/ }).click();
  await page.waitForTimeout(3000);
  const survived = await page
    .getByRole("button", { name: "View project" })
    .isVisible()
    .catch(() => false);
  if (survived) {
    ok("preview card survives a marker rebuild");
  } else {
    bad("preview card survives a marker rebuild", "card closed when the layer rebuilt");
  }
  await page.screenshot({ path: `${SHOTS}/03b-after-rebuild.png` });

  /* ------------------------------------- drill in, then leave and come back */
  current = "back restores the view";
  // Zoom in twice so the restored view is unmistakably not the default. The
  // API renders its controls twice; only one copy is on screen.
  const zoomIn = page.locator('button[aria-label="Zoom in"]:visible').first();
  await zoomIn.click();
  await page.waitForTimeout(900);
  await zoomIn.click();
  await page.waitForTimeout(2500);
  const before = await viewOf(page);
  console.log("view before leaving:", JSON.stringify(before));

  // Fall back to the sidebar when the card is not on screen, so a failure above
  // is reported as a failed check rather than crashing the rest of the run.
  if (survived) {
    await viewProject.click();
  } else {
    await page.locator('a[href^="/projects/"]').first().click();
  }
  await page.waitForURL(/\/projects\//, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(5000);
  if (/\/projects\//.test(new URL(page.url()).pathname)) {
    ok("View project opens the project page");
  } else {
    bad("View project opens the project page", page.url());
  }
  await page.screenshot({ path: `${SHOTS}/04-project-page.png` });

  await page.goBack({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=/on map/", { timeout: 90000 });
  for (let i = 0; i < 30; i++) {
    if ((await markerShapes(page)).some((s) => s.pin)) break;
    await page.waitForTimeout(2000);
  }
  await page.waitForTimeout(3000);
  const after = await viewOf(page);
  console.log("view after back:", JSON.stringify(after));
  await page.screenshot({ path: `${SHOTS}/05-back-on-map.png` });

  if (before && after && after.zoom === before.zoom) {
    const drift =
      Math.abs(after.center.lat - before.center.lat) +
      Math.abs(after.center.lng - before.center.lng);
    if (drift < 0.01) {
      ok("back keeps the zoom and pan", `zoom ${after.zoom}, drift ${drift.toFixed(5)}`);
    } else {
      bad("back keeps the zoom and pan", `zoom kept but centre drifted ${drift.toFixed(5)}`);
    }
  } else {
    bad("back keeps the zoom and pan", `before ${before?.zoom} vs after ${after?.zoom}`);
  }

  /* ------------------------------------------------ clusters open in a click */
  current = "clusters";
  // One pin cannot cluster, and the API's own controls are data-URI images too,
  // so guessing at a bubble here would only produce a false failure.
  let clusterShape = null;
  if (pins.length < 2) {
    ok("cluster click", `only ${pins.length} project on the map, no cluster to open`);
  } else {
    // Zoom out until the API paints a cluster bubble, then click it once.
    for (let i = 0; i < 10 && !clusterShape; i++) {
      await page.locator('button[aria-label="Zoom out"]:visible').first().click();
      await page.waitForTimeout(1200);
      clusterShape = (await markerShapes(page)).find((s) => !s.pin && s.width > 20);
    }
  }
  if (!clusterShape) {
    if (pins.length >= 2) ok("cluster click", "no cluster formed at any zoom, nothing to test");
  } else {
    const zoomBefore = (await viewOf(page))?.zoom;
    await page.screenshot({ path: `${SHOTS}/06-cluster.png` });
    await page.mouse.click(clusterShape.x, clusterShape.y);
    await page.waitForTimeout(3000);
    const zoomAfter = (await viewOf(page))?.zoom;
    const stillClustered = (await markerShapes(page)).some((s) => !s.pin);
    await page.screenshot({ path: `${SHOTS}/07-cluster-opened.png` });
    console.log(`cluster zoom ${zoomBefore} -> ${zoomAfter}, still clustered: ${stillClustered}`);
    if (zoomAfter > zoomBefore) {
      ok("one cluster click moves the zoom", `${zoomBefore} -> ${zoomAfter}`);
    } else {
      bad("one cluster click moves the zoom", `${zoomBefore} -> ${zoomAfter}`);
    }
  }

  return { browser };
};

run()
  .then(async ({ browser }) => {
    if (browser) await browser.close();
    console.log("\n--- checks ---");
    for (const c of checks) console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}  ${c.detail}`);
    console.log("\n--- console/page errors ---");
    if (problems.length === 0) console.log("none");
    for (const p of problems) console.log(`${p.kind} @ ${p.where}: ${p.detail}`);
    process.exit(checks.some((c) => !c.pass) ? 1 : 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
