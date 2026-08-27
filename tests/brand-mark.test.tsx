import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

/*
 * The Everlumen aperture, which now exists in five files.
 *
 * The mark is one artwork drawn five times: the SVG master, a transparent cut
 * of it, a React port for web, a react-native-svg port for mobile, and the
 * generator that rasterises the eight app icons. Every one of those carries a
 * comment claiming its coordinates are "lifted unchanged" from the design file,
 * and until this test nothing made that true. A one-character drift in a blade
 * path would ship a logo that is subtly wrong on exactly one platform, which is
 * the kind of thing nobody notices until it is on the App Store.
 *
 * Path-based, like tests/invariants.test.ts: moving any of these files means
 * updating the list here.
 */

const repo = (rel: string) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const read = (rel: string) => readFileSync(repo(rel), "utf8");

/**
 * Every quoted string in a file that looks like SVG path data.
 *
 * Deliberately blunt: it catches `d="..."` in the SVGs, the array entries in
 * the two components, and the template literals in the generator without any of
 * them having to agree on a format. A file that stops containing the paths at
 * all fails on the count assertion rather than passing vacuously.
 */
function pathData(source: string): string[] {
  return [...source.matchAll(/"(M\s*[\d.][^"]*)"/g)].map((m) => m[1].replace(/\s+/g, " ").trim());
}

const SOURCES = {
  "logo.svg": "apps/web/src/assets/logo.svg",
  "logo-mark.svg": "apps/web/src/assets/logo-mark.svg",
  "web BrandMark": "apps/web/src/components/BrandMark.tsx",
  "mobile BrandMark": "apps/mobile/src/components/BrandMark.tsx",
  "icon generator": "scripts/generate-brand-assets.mjs",
} as const;

describe("the aperture is one artwork", () => {
  const master = pathData(read(SOURCES["logo.svg"]));

  it("the master holds six blades and six seams", () => {
    expect(master).toHaveLength(12);
    // A blade is an arc closed back through two inner vertices; a seam is not.
    expect(master.filter((d) => d.includes("A50,50"))).toHaveLength(6);
    expect(master.filter((d) => !d.includes("A50,50"))).toHaveLength(6);
  });

  for (const [name, file] of Object.entries(SOURCES)) {
    if (name === "logo.svg") continue;
    it(`${name} carries the master's geometry, unchanged`, () => {
      expect(pathData(read(file))).toEqual(master);
    });
  }

  it("the aperture polygon matches wherever it is repeated", () => {
    const aperture =
      /65\.70,55\.06 87\.62,56\.98 96\.92,76\.92 84\.30,94\.94 62\.38,93\.02 53\.08,73\.08/;
    for (const file of [SOURCES["logo.svg"], SOURCES["web BrandMark"], SOURCES["icon generator"]]) {
      expect(read(file)).toMatch(aperture);
    }
  });

  it("the blades close on the aperture rather than on the centre", () => {
    /*
     * Each blade ends at two inner vertices, and those sit at r=22 about
     * (75,75). A blade that closed through the centre would fill the aperture
     * in and turn the iris into a plain gold disc, which is the one failure
     * that still looks plausible in a thumbnail.
     */
    for (const d of master.filter((s) => s.includes("A50,50"))) {
      const inner = [...d.matchAll(/L\s*([\d.]+)[, ]\s*([\d.]+)/g)];
      expect(inner).toHaveLength(2);
      for (const [, x, y] of inner) {
        const r = Math.hypot(Number(x) - 75, Number(y) - 75);
        expect(r).toBeCloseTo(22, 1);
      }
    }
  });
});

describe("BrandMark renders", () => {
  it("resolves every gradient, filter and mask it references", async () => {
    const { BrandMark } = await import("@/components/BrandMark");
    // 48 and up is the only size that emits <defs> at all, and no call site in
    // the app is currently that big, so nothing else exercises this branch.
    const html = renderToStaticMarkup(<BrandMark size={96} />);

    const referenced = [...html.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]);
    const defined = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);

    expect(referenced.length).toBeGreaterThan(0);
    for (const ref of referenced) expect(defined).toContain(ref);
  });

  it("keeps ids free of characters that break a url(#...) reference", async () => {
    const { BrandMark } = await import("@/components/BrandMark");
    const html = renderToStaticMarkup(<BrandMark size={96} />);
    /*
     * React wraps useId output in `:` and, since 19, in guillemets. Either one
     * inside a fragment reference is a mark that renders with no gold at all.
     */
    for (const [, id] of html.matchAll(/\sid="([^"]+)"/g)) {
      expect(id).toMatch(/^[a-zA-Z0-9-]+$/);
    }
  });

  it("gives two marks on one page their own defs", async () => {
    const { BrandMark } = await import("@/components/BrandMark");
    const html = renderToStaticMarkup(
      <>
        <BrandMark size={96} />
        <BrandMark size={96} />
      </>,
    );
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("simplifies to a disc and a hole once the seams stop resolving", async () => {
    const { BrandMark } = await import("@/components/BrandMark");
    // 20px is what a 28px BrandLogo tile asks for, which four call sites do.
    const small = renderToStaticMarkup(<BrandMark size={20} />);
    expect(small).not.toContain("<path");
    expect(small.match(/<circle/g)).toHaveLength(2);

    const mid = renderToStaticMarkup(<BrandMark size={29} />);
    expect(mid).toContain("<path");
    expect(mid).not.toContain("url(#");
  });

  it("darkens the gold when it is reversed onto a light ground", async () => {
    const { BrandMark } = await import("@/components/BrandMark");
    const onLight = renderToStaticMarkup(<BrandMark size={96} tone="light" />);
    // #FFB020 on white measures about 1.8:1, so the blades must not use it.
    expect(onLight).not.toContain("#FFB020");
    expect(onLight).toContain("#D97C0A");
  });
});
