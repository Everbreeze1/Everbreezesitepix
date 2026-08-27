/**
 * Renders every Everlumen icon PNG from the vector master.
 *
 * The eight files below used to be hand-exported, which is how the mobile icon
 * and the web icon drifted a percent apart in mark size. They are all one
 * artwork at different sizes, so they should come from one place: the geometry
 * here is the same geometry as apps/web/src/assets/logo.svg, and any change to
 * the mark means re-running this rather than re-exporting eight times.
 *
 * Run with: node scripts/generate-brand-assets.mjs
 * Overwrites the PNGs in place. Nothing else is touched.
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ------------------------------------------------------------------ artwork */

/**
 * Outer vertices sit at r=50 about (75,75) every 60 degrees from -90, inner
 * vertices at r=22 every 60 degrees from -115, and the 25 degree offset between
 * the rings is the twist. Coordinates are lifted unchanged from the design file
 * so this can be diffed against logo.svg and against the two BrandMark ports.
 */
const BLADES = [
  ["M75,25 A50,50 0 0 1 118.3,50 L 87.62,56.98 L 65.70,55.06 Z", 1],
  ["M118.3,50 A50,50 0 0 1 118.3,100 L 96.92,76.92 L 87.62,56.98 Z", 0.88],
  ["M118.3,100 A50,50 0 0 1 75,125 L 84.30,94.94 L 96.92,76.92 Z", 1],
  ["M75,125 A50,50 0 0 1 31.7,100 L 62.38,93.02 L 84.30,94.94 Z", 0.88],
  ["M31.7,100 A50,50 0 0 1 31.7,50 L 53.08,73.08 L 62.38,93.02 Z", 1],
  ["M31.7,50 A50,50 0 0 1 75,25 L 65.70,55.06 L 53.08,73.08 Z", 0.88],
];

const SEAMS = [
  "M75,25 L65.70,55.06",
  "M118.3,50 L87.62,56.98",
  "M118.3,100 L96.92,76.92",
  "M75,125 L84.30,94.94",
  "M31.7,100 L62.38,93.02",
  "M31.7,50 L53.08,73.08",
];

const APERTURE = "65.70,55.06 87.62,56.98 96.92,76.92 84.30,94.94 62.38,93.02 53.08,73.08";

const GOLD = "#FFB020";
const SEAM = "#1E2B4D";
/** The hairline between blades is painted in the ground, never in a darker ink. */
const GROUND_INK = "#171A2C";

/**
 * Mark box as a fraction of the canvas.
 *
 * From the design file's own icon sheet: a 70px mark in a 96px tile. The mark
 * only inks the middle two thirds of its viewBox, so the gold lands at about
 * 49% of the canvas. This is the same number `BrandLogo`'s tile uses, which is
 * what keeps the installed icon and the in-app logo the same object.
 */
const MARK_BOX = 0.73;

/**
 * @param {{ glow: boolean, ground: boolean }} opts
 */
function markSvg({ glow, ground }) {
  // Strokes are in user units. A mark that will be downscaled hard needs them
  // thickened or the seams vanish and it turns into a plain gold disc.
  const seamWidth = glow ? 3 : 3.5;
  const gapWidth = glow ? 1 : 1.5;

  const defs = [
    ground &&
      `<radialGradient id="ground" cx="35%" cy="30%" r="85%">
         <stop offset="0" stop-color="#262A44"/><stop offset="1" stop-color="#0A0A10"/>
       </radialGradient>`,
    glow &&
      `<radialGradient id="glow" cx="50%" cy="50%" r="50%">
         <stop offset="0" stop-color="${GOLD}" stop-opacity="0.45"/>
         <stop offset="1" stop-color="${GOLD}" stop-opacity="0"/>
       </radialGradient>
       <filter id="blur"><feGaussianBlur stdDeviation="6"/></filter>
       <mask id="hole">
         <rect width="150" height="150" fill="white"/>
         <polygon points="${APERTURE}" fill="black"/>
       </mask>`,
  ]
    .filter(Boolean)
    .join("\n");

  const blades = BLADES.map(
    ([d, o]) => `<path d="${d}" fill="${GOLD}"${o === 1 ? "" : ` opacity="${o}"`}/>`,
  ).join("\n");
  const seams = SEAMS.map((d) => `<path d="${d}"/>`).join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 150" width="100%" height="100%">
  <defs>${defs}</defs>
  ${glow ? `<circle cx="75" cy="75" r="58" fill="url(#glow)" filter="url(#blur)" mask="url(#hole)"/>` : ""}
  <g stroke="${GROUND_INK}" stroke-width="${gapWidth}" stroke-linejoin="round">${blades}</g>
  <g fill="none" stroke="${SEAM}" stroke-width="${seamWidth}" stroke-linecap="round">${seams}</g>
</svg>`;
}

/**
 * The full canvas: mark centred in its box, over a ground or over nothing.
 *
 * The ground is a separate full-bleed layer rather than a rect inside the mark
 * SVG, because the transparent outputs need the mark inset by exactly the same
 * fraction as the opaque ones.
 */
function page(size, { ground, glow, box }) {
  const markPx = Math.round(size * box);
  return `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0;background:transparent}
  #c{width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;
     ${ground ? "background:radial-gradient(circle at 35% 30%, #262A44, #0A0A10);" : ""}}
  #m{width:${markPx}px;height:${markPx}px}
</style>
<div id="c"><div id="m">${markSvg({ glow, ground })}</div></div>`;
}

/* ------------------------------------------------------------------ outputs */

const TARGETS = [
  // Opaque app icons. The OS applies its own rounding, so these stay square.
  //
  // There is deliberately no src/assets/logo.png here. It was a byte-identical
  // copy of icon-512.png that existed only because BrandLogo used to be an
  // `<img>`; the component draws the mark now, so nothing imported it.
  { file: "apps/web/public/icon-512.png", size: 512, ground: true, glow: true, box: MARK_BOX },
  { file: "apps/web/public/icon-192.png", size: 192, ground: true, glow: true, box: MARK_BOX },
  {
    file: "apps/web/public/apple-touch-icon.png",
    size: 180,
    ground: true,
    glow: true,
    box: MARK_BOX,
  },
  { file: "apps/mobile/assets/icon.png", size: 1024, ground: true, glow: true, box: MARK_BOX },

  // Transparent. Android composites the adaptive foreground over the colour in
  // app.json, and expo-splash-screen composites the splash the same way, so a
  // baked ground would show as a square tile on both.
  {
    file: "apps/mobile/assets/adaptive-icon.png",
    size: 1024,
    ground: false,
    glow: true,
    box: MARK_BOX,
  },
  {
    file: "apps/mobile/assets/splash-icon.png",
    size: 1024,
    ground: false,
    glow: true,
    box: MARK_BOX,
  },

  // 48px leaves no room for a glow or for hairline seams, so it gets the
  // simplified treatment and the whole canvas.
  { file: "apps/mobile/assets/favicon.png", size: 48, ground: false, glow: false, box: 1 },
];

const browser = await chromium.launch();
try {
  for (const t of TARGETS) {
    /*
     * Rendered at 4x and downscaled by the encoder rather than shot at final
     * size: Chromium rasterises the arcs and the 1px hairlines with far less
     * stair-stepping when it has the pixels to work with, and the 48px favicon
     * is unusable without it.
     */
    const scale = t.size <= 256 ? 4 : 1;
    const ctx = await browser.newContext({
      viewport: { width: t.size, height: t.size },
      deviceScaleFactor: scale,
    });
    const p = await ctx.newPage();
    await p.setContent(page(t.size, t), { waitUntil: "load" });
    const buf = await p.screenshot({ omitBackground: !t.ground, type: "png" });
    await ctx.close();

    if (scale === 1) {
      writeFileSync(join(ROOT, t.file), buf);
    } else {
      // Downsample the oversampled shot back to the declared size.
      const ctx2 = await browser.newContext({
        viewport: { width: t.size, height: t.size },
        deviceScaleFactor: 1,
      });
      const p2 = await ctx2.newPage();
      await p2.setContent(
        `<!doctype html><meta charset="utf-8">
         <style>html,body{margin:0;background:transparent}
         img{width:${t.size}px;height:${t.size}px;display:block}</style>
         <img src="data:image/png;base64,${buf.toString("base64")}">`,
        { waitUntil: "load" },
      );
      writeFileSync(
        join(ROOT, t.file),
        await p2.screenshot({ omitBackground: !t.ground, type: "png" }),
      );
      await ctx2.close();
    }
    console.log(`${t.file}  ${t.size}x${t.size}${t.ground ? "" : "  (transparent)"}`);
  }
} finally {
  await browser.close();
}
