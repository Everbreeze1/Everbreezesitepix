/**
 * The rules behind the photo viewer, free of imports so they can be tested.
 *
 * The viewer itself is `src/components/photo-viewer/PhotoViewer.tsx`, the
 * phone's copy of the web's `PhotoLightbox` + `PhotoDetailsPanel`. Everything
 * here is a decision the two surfaces have to agree on: when a screen counts as
 * a tablet, what colour a tag is, what a tag name is allowed to look like, and
 * which share link a visitor could still open.
 */

import { shareState, sortedShares, type PhotoShareRow } from "./photo-shares-view";

/**
 * Wide enough to put the details panel beside the photo rather than under it.
 *
 * The web switches at Tailwind's `md` (768px), and so does this. An iPad in
 * portrait is 768pt or wider; the largest phone in landscape is not far off,
 * which is fine: a phone on its side has the room for a side panel too.
 */
export const TABLET_MIN_WIDTH = 768;

export function isTabletWidth(width: number): boolean {
  return width >= TABLET_MIN_WIDTH;
}

/** The side panel's width: web's `md:w-[380px] lg:w-[420px]`. */
export function sidePanelWidth(width: number): number {
  return width >= 1024 ? 420 : 380;
}

/** "2 / 200", the position readout in the top bar. */
export function viewerPosition(index: number, total: number): string {
  if (total <= 0) return "";
  const at = Math.min(Math.max(index, 0), total - 1) + 1;
  return `${at} / ${total}`;
}

/** The next index when paging, clamped rather than wrapped. */
export function stepIndex(index: number, delta: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(Math.max(index + delta, 0), total - 1);
}

/* ------------------------------------------------------------------- tags */

/**
 * A tag name the way web stores it: lower case, spaces to hyphens, 32 chars.
 * Same rule as web's `PhotoTagPopoverBody`, so a tag made on the phone and the
 * same word typed on web are one tag, not two.
 */
export function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 32);
}

/** Add the tag if it is missing, remove it if it is there. */
export function toggleTagName(current: string[] | null | undefined, name: string): string[] {
  const list = current ?? [];
  return list.includes(name) ? list.filter((tag) => tag !== name) : [...list, name];
}

/** The presets web's tag picker offers when creating a tag. */
export const TAG_PRESET_COLORS = [
  "#64748b",
  "#ef4444",
  "#f59e0b",
  "#10b981",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
] as const;

/** Web's `use-tag-colors` fallback palette, in the same order. */
const FALLBACK_PALETTE = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#06b6d4",
  "#ec4899",
  "#84cc16",
  "#f97316",
  "#14b8a6",
];

/**
 * The colour a tag gets before the library has said otherwise.
 *
 * The same hash as web's `fallbackColor`, so a tag with no stored colour paints
 * the same on both surfaces instead of blue on one and green on the other.
 */
export function fallbackTagColor(name: string): string {
  const s = (name ?? "").trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return FALLBACK_PALETTE[h % FALLBACK_PALETTE.length];
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.replace("#", "").trim();
  const full =
    m.length === 3
      ? m
          .split("")
          .map((c) => c + c)
          .join("")
      : m;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Black or white text on a tag pill, whichever contrasts more.
 *
 * Web's `TagPill` rule (WCAG contrast rather than a brightness cutoff), so a
 * mid-tone orange tag reads the same on the phone as it does on the web.
 */
export function readableOn(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return "#ffffff";
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const lum = 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
  return (lum + 0.05) / 0.05 > 1.05 / (lum + 0.05) ? "#0b0b0b" : "#ffffff";
}

/** "north-wall" as "North Wall", the way web's pill prints a tag. */
export function tagTitle(name: string): string {
  return (name ?? "")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/* ------------------------------------------------------------------ share */

/**
 * The share links a visitor could open right now, newest first.
 *
 * Web's `SharePhotoDialog.isLive`: not revoked and not expired. Every live row
 * matters, not just the newest, because "turn sharing off" has to close all of
 * them or the link a customer already holds keeps working.
 */
export function liveShareRows<T extends PhotoShareRow>(rows: T[], now: Date = new Date()): T[] {
  return (sortedShares(rows, now) as T[]).filter((row) => shareState(row, now) === "live");
}

/* --------------------------------------------------------------- location */

export function hasCoords(lat: number | null | undefined, lng: number | null | undefined): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)
  );
}

/**
 * Where the header's map button goes: the photo's own GPS when it has one,
 * otherwise the project address, otherwise nowhere. Web's rule exactly.
 */
export function mapsLink(
  lat: number | null | undefined,
  lng: number | null | undefined,
  address: string | null | undefined,
): string | null {
  if (hasCoords(lat, lng)) {
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  }
  const trimmed = (address ?? "").trim();
  if (trimmed) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(trimmed)}`;
  }
  return null;
}

/** "43.65321, -79.38318", five places being about a metre. */
export function formatCoords(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}
