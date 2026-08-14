import { useEffect, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/sitepix/client";

// ---------------------------------------------------------------------------
// Global label catalog - labels are company/team-wide with a custom color.
// This module keeps a single shared cache so every chip across the app paints
// the same color, and exposes CRUD helpers for the Labels tab.
// ---------------------------------------------------------------------------

export interface LabelRow {
  id: string;
  team_id: string | null;
  created_by: string;
  name: string;
  color: string;
  created_at?: string;
  updated_at?: string;
}

// Deterministic fallback palette (hex) used until a stored color is known.
const FALLBACK_PALETTE = [
  "#2563eb",
  "#0d9488",
  "#b45309",
  "#b91c1c",
  "#6d28d9",
  "#0e7490",
  "#be185d",
  "#4d7c0f",
  "#c2410c",
  "#0f766e",
];

export function fallbackLabelColor(name: string): string {
  const s = (name ?? "").trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return FALLBACK_PALETTE[h % FALLBACK_PALETTE.length];
}

interface Store {
  rows: LabelRow[];
  byName: Map<string, LabelRow>;
}
let store: Store = { rows: [], byName: new Map() };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((cb) => cb());

function setRows(rows: LabelRow[]) {
  const byName = new Map<string, LabelRow>();
  for (const r of rows) byName.set(r.name.trim().toLowerCase(), r);
  store = { rows, byName };
  emit();
}

let loaded = false;
let loadingPromise: Promise<void> | null = null;
export async function loadLabels(force = false): Promise<void> {
  if (loadingPromise) return loadingPromise;
  if (loaded && !force) return;
  loadingPromise = (async () => {
    const { data } = await (supabase as any)
      .from("labels")
      .select("id, team_id, created_by, name, color, created_at, updated_at")
      .order("name", { ascending: true });
    setRows(((data as any[]) ?? []) as LabelRow[]);
    loaded = true;
  })().finally(() => {
    loadingPromise = null;
  });
  return loadingPromise;
}

export function getLabelColor(name: string): string {
  const r = store.byName.get((name ?? "").trim().toLowerCase());
  return r?.color || fallbackLabelColor(name);
}

export function useLabelCatalog() {
  useEffect(() => {
    void loadLabels();
  }, []);
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => store,
    () => store,
  );
}

export function useLabelColor(name: string): string {
  const s = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => store,
    () => store,
  );
  const r = s.byName.get((name ?? "").trim().toLowerCase());
  return r?.color || fallbackLabelColor(name);
}

export async function upsertLabel(args: {
  name: string;
  color: string;
  team_id: string | null;
  created_by: string;
}): Promise<LabelRow | null> {
  const norm = args.name.trim();
  if (!norm) return null;
  const existing = store.byName.get(norm.toLowerCase());
  if (existing) {
    if (existing.color !== args.color) {
      return updateLabel(existing.id, { color: args.color });
    }
    return existing;
  }
  const { data, error } = await (supabase as any)
    .from("labels")
    .insert({
      name: norm,
      color: args.color,
      team_id: args.team_id,
      created_by: args.created_by,
    })
    .select("id, team_id, created_by, name, color, created_at, updated_at")
    .single();
  if (error || !data) {
    // Race: another client created it. Re-fetch.
    await loadLabels(true);
    return store.byName.get(norm.toLowerCase()) ?? null;
  }
  const row = data as LabelRow;
  setRows([...store.rows, row].sort((a, b) => a.name.localeCompare(b.name)));
  return row;
}

export async function ensureLabel(
  name: string,
  team_id: string | null,
  created_by: string,
): Promise<LabelRow | null> {
  const norm = name.trim();
  if (!norm) return null;
  const existing = store.byName.get(norm.toLowerCase());
  if (existing) return existing;
  return upsertLabel({
    name: norm,
    color: fallbackLabelColor(norm),
    team_id,
    created_by,
  });
}

export async function updateLabel(
  id: string,
  patch: { name?: string; color?: string },
): Promise<LabelRow | null> {
  const { data, error } = await (supabase as any)
    .from("labels")
    .update(patch)
    .eq("id", id)
    .select("id, team_id, created_by, name, color, created_at, updated_at")
    .single();
  if (error || !data) return null;
  const row = data as LabelRow;
  setRows(store.rows.map((r) => (r.id === id ? row : r)));
  return row;
}

export async function deleteLabel(id: string): Promise<boolean> {
  const { error } = await (supabase as any).from("labels").delete().eq("id", id);
  if (error) return false;
  setRows(store.rows.filter((r) => r.id !== id));
  return true;
}

// Render helpers ------------------------------------------------------------
// Produces a light, muted chip with a dark bold text. The user-selected color
// is desaturated and lightened so labels feel professional, not neon, and
// text always has excellent contrast.
export function hexToChipStyle(hex: string) {
  const base = hexToRgb(hex || "#2563eb");
  // Tint a white background with the chosen color so the hue is clearly
  // visible while keeping the chip light enough for black text.
  const tintRatio = 0.28; // portion of the chosen color mixed into white
  const bg = base.map((c) => Math.round(c * tintRatio + 255 * (1 - tintRatio)));
  // Border uses a stronger dose of the same hue for a clear outline.
  const border = base.map((c) => Math.round(c * 0.75 + 255 * 0.25));
  // Always use black text for maximum readability on the light tint.
  return {
    backgroundColor: `rgb(${bg[0]},${bg[1]},${bg[2]})`,
    color: "rgb(0,0,0)",
    borderColor: `rgb(${border[0]},${border[1]},${border[2]})`,
  } as const;
}

// Produces a translucent chip for dark surfaces: a faint tint of the color
// as the background, a lightened border, and a pastel (light) text tint so
// it stays readable on a dark background instead of the light-chip's black text.
export function hexToChipStyleDark(hex: string) {
  const base = hexToRgb(hex || "#2563eb");
  const bg = `rgba(${base[0]},${base[1]},${base[2]},0.14)`;
  const lightBorder = base.map((c) => Math.round(c * 0.55 + 255 * 0.45));
  const lightText = base.map((c) => Math.round(c * 0.35 + 255 * 0.65));
  return {
    backgroundColor: bg,
    borderColor: `rgba(${lightBorder[0]},${lightBorder[1]},${lightBorder[2]},0.3)`,
    color: `rgb(${lightText[0]},${lightText[1]},${lightText[2]})`,
  } as const;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const f =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const n = parseInt(f, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// A curated professional swatch palette. Muted, print-safe tones - no neons.
export const COLOR_SWATCHES = [
  "#b91c1c",
  "#c2410c",
  "#b45309",
  "#a16207",
  "#4d7c0f",
  "#15803d",
  "#047857",
  "#0f766e",
  "#0e7490",
  "#0369a1",
  "#1d4ed8",
  "#4338ca",
  "#6d28d9",
  "#7e22ce",
  "#a21caf",
  "#be185d",
  "#9f1239",
  "#475569",
  "#57534e",
  "#1f2937",
];

// Use the cache without subscribing - for one-shot calls.
export function getCachedLabels(): LabelRow[] {
  return store.rows;
}

// Allow other modules to seed/refresh the cache.
export const refreshLabels = () => loadLabels(true);
