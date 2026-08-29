import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cleanLabelName,
  fallbackLabelColor,
  labelColor,
  labelNameError,
  LABEL_SWATCHES,
  MAX_LABEL_LENGTH,
} from "../apps/mobile/src/api/label-rules";

/*
 * Label rules.
 *
 * Labels are the one thing in the product two people edit at once, from two
 * devices, with no locking, and the failure mode is quiet: a duplicate that
 * differs only in case produces two chips that look identical and filter
 * differently. Nobody reports that, because it reads as their own typo.
 */

describe("labelNameError", () => {
  const existing = [
    { id: "1", name: "Roofing" },
    { id: "2", name: "Riverside contract" },
  ];

  it("accepts a new name", () => {
    expect(labelNameError("Groundworks", existing)).toBeNull();
  });

  it("rejects a duplicate whatever the casing or padding", () => {
    // "Roofing" and "roofing" are the same label to everyone except the
    // database.
    expect(labelNameError("roofing", existing)).toContain("already a label");
    expect(labelNameError("  ROOFING  ", existing)).toContain("already a label");
  });

  it("lets a label keep its own name when renamed", () => {
    // Otherwise recolouring a label without touching its name is refused as a
    // clash with itself.
    expect(labelNameError("Roofing", existing, "1")).toBeNull();
    expect(labelNameError("Roofing", existing, "2")).toContain("already a label");
  });

  it("refuses an empty name", () => {
    expect(labelNameError("", existing)).toContain("name");
    expect(labelNameError("   ", existing)).toContain("name");
  });

  it("caps the length", () => {
    expect(labelNameError("x".repeat(MAX_LABEL_LENGTH), existing)).toBeNull();
    expect(labelNameError("x".repeat(MAX_LABEL_LENGTH + 1), existing)).toContain("characters");
  });
});

describe("cleanLabelName", () => {
  it("trims and truncates", () => {
    expect(cleanLabelName("  Roofing  ")).toBe("Roofing");
    expect(cleanLabelName("x".repeat(80))).toHaveLength(MAX_LABEL_LENGTH);
  });
});

describe("fallbackLabelColor", () => {
  it("is stable for the same name", () => {
    // The only property that makes a colour useful for recognising something.
    // A random one would change on every reload.
    expect(fallbackLabelColor("Roofing")).toBe(fallbackLabelColor("Roofing"));
  });

  it("ignores casing and padding, like the name comparison does", () => {
    expect(fallbackLabelColor("  ROOFING ")).toBe(fallbackLabelColor("roofing"));
  });

  it("always returns a colour, including for an empty name", () => {
    expect(fallbackLabelColor("")).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("agrees with the web, character for character", () => {
    /*
     * The arithmetic is `>>> 0` and not `| 0`. The two disagree the moment the
     * hash passes 2^31, which is most names, so a signed version would agree
     * with the web on short labels and quietly diverge on longer ones: the same
     * label blue at a desk and red in the field.
     *
     * Recomputed here from the web's own source rather than from a copy, so
     * this fails if either side is edited.
     */
    const web = readFileSync(
      join(process.cwd(), "apps/web/src/hooks/use-label-catalog.tsx"),
      "utf8",
    );
    const block = /const FALLBACK_PALETTE = \[([\s\S]*?)\];/.exec(web);
    expect(block).not.toBeNull();
    const palette = [...block![1].matchAll(/"(#[0-9a-fA-F]{6})"/g)].map((m) => m[1]);
    expect(palette.length).toBeGreaterThan(0);

    const webColor = (name: string) => {
      const s = (name ?? "").trim().toLowerCase();
      let h = 0;
      for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
      return palette[h % palette.length];
    };

    for (const name of [
      "Roofing",
      "Riverside contract",
      "a",
      "",
      "A rather long label name that runs on",
      "Ünïcodé trädes",
    ]) {
      expect(fallbackLabelColor(name)).toBe(webColor(name));
    }
  });
});

describe("labelColor", () => {
  it("prefers the stored colour", () => {
    expect(labelColor({ name: "Roofing", color: "#123456" })).toBe("#123456");
  });

  it("falls back for a row that predates the colour column", () => {
    expect(labelColor({ name: "Roofing", color: null })).toBe(fallbackLabelColor("Roofing"));
    expect(labelColor({ name: "Roofing", color: "   " })).toBe(fallbackLabelColor("Roofing"));
  });
});

describe("LABEL_SWATCHES", () => {
  it("is the web palette, in the web's order", () => {
    /*
     * A phone-only colour would be visible immediately: the web chips are drawn
     * from this fixed set, so a twenty-first colour appearing among them reads
     * as a mistake rather than a choice.
     */
    const web = readFileSync(
      join(process.cwd(), "apps/web/src/hooks/use-label-catalog.tsx"),
      "utf8",
    );
    const block = /export const COLOR_SWATCHES = \[([\s\S]*?)\];/.exec(web);
    expect(block).not.toBeNull();
    const swatches = [...block![1].matchAll(/"(#[0-9a-fA-F]{6})"/g)].map((m) => m[1]);

    expect([...LABEL_SWATCHES]).toEqual(swatches);
  });
});
