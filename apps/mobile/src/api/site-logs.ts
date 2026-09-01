import { randomUUID } from "expo-crypto";
import { AI_TIMEOUT_MS } from "@everlumen/api-client";
import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { PhotoNote, SiteLogRow } from "./site-log-notes";

/**
 * Site logs: a day's photos with a note and a to-do list against each one.
 *
 * The rows are ordinary RLS reads and writes on `project_site_logs`, which is
 * what the web app does. Only the two expensive parts go through `/v1/rpc`:
 * asking the model to describe the photos, and rendering the PDF. Both cost
 * money and both are gated on an active subscription server-side.
 *
 * `(supabase as any)` because `packages/db` does not declare this table. Same
 * cast the web component carries.
 */

const COLUMNS = "id, project_id, title, photo_ids, notes, created_at, updated_at";

export async function listSiteLogs(projectId: string): Promise<SiteLogRow[]> {
  const { data, error } = await (supabase as any)
    .from("project_site_logs")
    .select(COLUMNS)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as SiteLogRow[];
}

export async function getSiteLog(id: string): Promise<SiteLogRow | null> {
  const { data, error } = await (supabase as any)
    .from("project_site_logs")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as SiteLogRow) ?? null;
}

export async function createSiteLog(args: {
  projectId: string;
  title: string;
  photoIds: string[];
  notes: Record<string, PhotoNote>;
}): Promise<SiteLogRow> {
  const { data, error } = await (supabase as any)
    .from("project_site_logs")
    .insert({
      project_id: args.projectId,
      title: args.title,
      photo_ids: args.photoIds,
      notes: args.notes,
    })
    .select(COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return data as SiteLogRow;
}

export async function saveSiteLog(
  id: string,
  patch: { title?: string; photo_ids?: string[]; notes?: Record<string, PhotoNote> },
): Promise<void> {
  const { error } = await (supabase as any).from("project_site_logs").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteSiteLog(id: string): Promise<void> {
  const { error } = await (supabase as any).from("project_site_logs").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Ask the model to write the notes.
 *
 * Returns a note per photo id, which the caller merges into whatever the person
 * has already typed rather than replacing it. Somebody who wrote three careful
 * lines and then tapped Describe should not lose them.
 */
export async function describeSiteLogPhotos(
  photoIds: string[],
): Promise<{ notes: Record<string, string> }> {
  const result = await api.rpc<{ notes?: Record<string, string> }>(
    "describeSiteLogPhotos",
    { photoIds },
    /*
     * The long timeout. This describes a whole day's photographs in one call,
     * so it is among the slowest AI ops here - and the one most likely to be
     * run on a phone at the end of a shift, on a van's worth of signal.
     */
    { idempotencyKey: randomUUID(), timeoutMs: AI_TIMEOUT_MS },
  );
  return { notes: result?.notes ?? {} };
}
