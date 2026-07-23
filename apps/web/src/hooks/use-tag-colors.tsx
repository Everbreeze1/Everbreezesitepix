import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/sitepix/client";

// Deterministic fallback palette (hex) used until a global tag color is known.
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

export function fallbackColor(name: string): string {
  const s = (name ?? "").trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return FALLBACK_PALETTE[h % FALLBACK_PALETTE.length];
}

// In-memory shared cache so every chip across the app paints the same color.
const cache = new Map<string, string>(); // lower(name) -> hex
const subscribers = new Set<() => void>();
const notify = () => subscribers.forEach((cb) => cb());

let loadingPromise: Promise<void> | null = null;
const loadAll = () => {
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    const { data } = await (supabase as any).from("tags").select("name, color");
    for (const row of (data ?? []) as Array<{ name: string; color: string }>) {
      if (row?.name) cache.set(row.name.toLowerCase(), row.color || fallbackColor(row.name));
    }
    notify();
  })().finally(() => {
    loadingPromise = null;
  });
  return loadingPromise;
};

export function rememberTagColor(name: string, color: string) {
  if (!name) return;
  cache.set(name.toLowerCase(), color);
  notify();
}

/**
 * Ensure a tag exists in the global `tags` table. If it already exists,
 * its existing color is reused. Returns the color that the tag actually has.
 */
export async function ensureGlobalTag(
  name: string,
  desiredColor?: string,
  createdBy?: string | null,
): Promise<string> {
  const norm = name.trim().toLowerCase();
  if (!norm) return desiredColor ?? fallbackColor(name);
  const cached = cache.get(norm);
  if (cached) return cached;
  // Look up existing
  const { data: existing } = await (supabase as any)
    .from("tags")
    .select("name, color")
    .ilike("name", norm)
    .maybeSingle();
  if (existing?.color) {
    rememberTagColor(existing.name, existing.color);
    return existing.color;
  }
  const color = desiredColor || fallbackColor(norm);
  const { data: inserted, error } = await (supabase as any)
    .from("tags")
    .insert({ name: norm, color, created_by: createdBy ?? null })
    .select("name, color")
    .single();
  if (!error && inserted) {
    rememberTagColor(inserted.name, inserted.color);
    return inserted.color;
  }
  // Insert race: re-fetch
  const { data: again } = await (supabase as any)
    .from("tags")
    .select("name, color")
    .ilike("name", norm)
    .maybeSingle();
  if (again?.color) {
    rememberTagColor(again.name, again.color);
    return again.color;
  }
  return color;
}

export function useTagColors() {
  const [, force] = useState(0);
  useEffect(() => {
    const cb = () => force((n) => n + 1);
    subscribers.add(cb);
    void loadAll();
    return () => {
      subscribers.delete(cb);
    };
  }, []);
  const colorOf = useCallback(
    (name: string) => cache.get((name ?? "").toLowerCase()) ?? fallbackColor(name),
    [],
  );
  return { colorOf };
}
