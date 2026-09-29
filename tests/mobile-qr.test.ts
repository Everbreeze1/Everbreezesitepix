import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import QRCode from "qrcode";
import {
  encodeQr,
  qrByteCapacity,
  qrPath,
  utf8Bytes,
  type QrErrorLevel,
} from "../apps/mobile/src/lib/qr";

/*
 * The phone's QR encoder, checked module for module against the `qrcode`
 * package the web draws its project QR with.
 *
 * The web library is the reference: if both agree on every module for the same
 * bytes, version, level and mask, a code drawn on the phone scans the same way
 * a printed one from the web does. The reference is asked for byte mode
 * explicitly, because left to itself it splits a URL into numeric and
 * alphanumeric runs and produces a different (equally valid) code.
 */

function reference(text: string, level: QrErrorLevel, version: number, mask: number) {
  const code = QRCode.create([{ data: text, mode: "byte" }], {
    errorCorrectionLevel: level,
    version,
    maskPattern: mask as QRCode.QRCodeMaskPattern,
  });
  const size = code.modules.size;
  const rows: boolean[][] = [];
  for (let y = 0; y < size; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < size; x++) row.push(Boolean(code.modules.get(y, x)));
    rows.push(row);
  }
  return rows;
}

const VECTORS: [string, QrErrorLevel][] = [
  ["https://everlumen.co/share/projects/abc123", "M"],
  ["https://everlumen.co/share/projects/0f8c2d7e-4b1a-4c3e-9e2f-1234567890ab", "Q"],
  ["HELLO", "M"],
  ["a", "L"],
  ["Café ✓ site", "H"],
  ["https://everlumen.co/share/projects/" + "x".repeat(120), "M"],
  ["https://everlumen.co/share/projects/" + "y".repeat(160), "M"],
];

describe("encodeQr", () => {
  for (const [text, level] of VECTORS) {
    it(`matches the web library for ${text.slice(0, 40)} at ${level}, every mask`, () => {
      for (let mask = 0; mask < 8; mask++) {
        const ours = encodeQr(text, level, { mask });
        expect(ours.size).toBe(ours.version * 4 + 17);
        expect(ours.modules).toEqual(reference(text, level, ours.version, mask));
      }
    });
  }

  it("picks the smallest version that fits", () => {
    // 17 bytes is the whole of a version 1 code at level L; 18 needs version 2.
    expect(encodeQr("x".repeat(17), "L").version).toBe(1);
    expect(encodeQr("x".repeat(18), "L").version).toBe(2);
    expect(encodeQr("x".repeat(14), "M").version).toBe(1);
    expect(encodeQr("x".repeat(15), "M").version).toBe(2);
  });

  it("knows the byte capacity tables for version 10", () => {
    expect(qrByteCapacity("L")).toBe(271);
    expect(qrByteCapacity("M")).toBe(213);
    expect(qrByteCapacity("Q")).toBe(151);
    expect(qrByteCapacity("H")).toBe(119);
  });

  it("refuses text too long for version 10 rather than drawing a broken code", () => {
    expect(() => encodeQr("z".repeat(214), "M")).toThrow(/too long/);
  });

  it("chooses a mask on its own and draws it consistently", () => {
    const text = "https://everlumen.co/share/projects/abc123";
    const auto = encodeQr(text, "Q");
    expect(auto.mask).toBeGreaterThanOrEqual(0);
    expect(auto.mask).toBeLessThan(8);
    expect(auto.modules).toEqual(reference(text, "Q", auto.version, auto.mask));
  });

  it("encodes UTF-8 by hand", () => {
    expect(utf8Bytes("Aé€\u{1F600}")).toEqual([
      0x41, 0xc3, 0xa9, 0xe2, 0x82, 0xac, 0xf0, 0x9f, 0x98, 0x80,
    ]);
  });

  it("draws one path square per dark module, inside the quiet zone", () => {
    const code = encodeQr("HELLO", "M", { mask: 0 });
    const dark = code.modules.flat().filter(Boolean).length;
    const path = qrPath(code);
    expect(path.split("M").length - 1).toBe(dark);
    // The top-left finder's corner sits at the margin.
    expect(path.startsWith("M4 4h1v1h-1z")).toBe(true);
  });
});

describe("the project QR screen", () => {
  const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");

  it("encodes the public share link through the web's op, at the web's level", () => {
    const screen = read("apps/mobile/app/(app)/project/[id]/qr.tsx");
    expect(screen).toMatch(/ensureProjectShareState/);
    expect(screen).toMatch(/publicUrl\("projects", token\)/);
    expect(screen).toMatch(/encodeQr\(url, "Q"\)/);
    expect(read("apps/mobile/src/api/sharing.ts")).toMatch(/"ensureProjectShare", \{ projectId \}/);
  });

  it("is reachable from the project actions menu and registered as a screen", () => {
    expect(read("apps/mobile/app/(app)/project/[id]/index.tsx")).toMatch(
      /pathname: "\/project\/\[id\]\/qr"/,
    );
    expect(read("apps/mobile/app/(app)/_layout.tsx")).toMatch(/name="project\/\[id\]\/qr"/);
  });
});
