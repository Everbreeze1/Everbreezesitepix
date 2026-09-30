import { supabase } from "@/lib/supabase";
import { currentUserId } from "./blueprint-admin";
import { isMissingTable } from "./template-library-view";
import {
  normaliseCapture,
  type ShotCapture,
  type ShotRow,
  type WalkthroughTemplateRow,
} from "./walkthrough-template-view";

/**
 * Managing walkthrough templates and their shots: the same
 * `walkthrough_templates` / `walkthrough_template_shots` statements as the
 * web's `WalkthroughTemplatesManager`. Direct RLS; `created_by` is required by
 * every policy on these tables.
 */

const db = (table: string): any => supabase.from(table as never);

export type WalkthroughLibrary =
  | { status: "ok"; templates: WalkthroughTemplateRow[]; shots: ShotRow[] }
  /** The tables do not exist on this database yet (migration not run). */
  | { status: "unavailable" };

export async function loadWalkthroughLibrary(): Promise<WalkthroughLibrary> {
  const { data, error } = await db("walkthrough_templates")
    .select("id, name, description, category, archived, created_at")
    .order("created_at", { ascending: true });
  if (error) {
    if (isMissingTable(error.code)) return { status: "unavailable" };
    throw new Error(error.message);
  }
  const templates: WalkthroughTemplateRow[] = ((data as any[]) ?? []).map((t) => ({
    id: String(t.id),
    name: String(t.name ?? "Untitled walkthrough"),
    description: (t.description as string | null) ?? null,
    category: (t.category as string | null) ?? null,
    archived: Boolean(t.archived),
    createdAt: String(t.created_at ?? ""),
  }));
  if (!templates.length) return { status: "ok", templates, shots: [] };
  const shotRes = await db("walkthrough_template_shots")
    .select("id, template_id, position, label, description, capture, required")
    .in(
      "template_id",
      templates.map((t) => t.id),
    )
    .order("position", { ascending: true });
  if (shotRes.error) throw new Error(shotRes.error.message);
  const shots: ShotRow[] = ((shotRes.data as any[]) ?? []).map((s) => ({
    id: String(s.id),
    templateId: String(s.template_id),
    position: Number(s.position ?? 0),
    label: String(s.label ?? ""),
    description: (s.description as string | null) ?? null,
    capture: normaliseCapture(s.capture),
    required: Boolean(s.required),
  }));
  return { status: "ok", templates, shots };
}

export async function createWalkthroughTemplate(args: {
  name: string;
  description: string | null;
  category: string | null;
}): Promise<string> {
  const userId = await currentUserId();
  const { data, error } = await db("walkthrough_templates")
    .insert({
      created_by: userId,
      name: args.name.trim(),
      description: args.description?.trim() || null,
      category: args.category,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not create that walkthrough");
  return String(data.id);
}

export async function updateWalkthroughTemplate(
  id: string,
  patch: { name?: string; description?: string | null; category?: string | null },
): Promise<void> {
  const { error } = await db("walkthrough_templates").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function setWalkthroughTemplateArchived(id: string, archived: boolean): Promise<void> {
  const { error } = await db("walkthrough_templates").update({ archived }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteWalkthroughTemplate(id: string): Promise<void> {
  const { error } = await db("walkthrough_templates").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Duplicate with every shot; a failed shot copy is reported, not swallowed. */
export async function duplicateWalkthroughTemplate(
  source: WalkthroughTemplateRow,
  shots: readonly ShotRow[],
): Promise<string> {
  const id = await createWalkthroughTemplate({
    name: `${source.name} (copy)`,
    description: source.description,
    category: source.category,
  });
  if (shots.length) {
    const { error } = await db("walkthrough_template_shots").insert(
      shots.map((s, idx) => ({
        template_id: id,
        position: idx,
        label: s.label,
        description: s.description,
        capture: s.capture,
        required: s.required,
      })),
    );
    if (error) throw new Error(error.message ?? "Could not copy the shots");
  }
  return id;
}

export type ShotDraft = {
  label: string;
  description: string | null;
  capture: ShotCapture;
  required: boolean;
};

export async function addShot(templateId: string, draft: ShotDraft, position: number) {
  const { error } = await db("walkthrough_template_shots").insert({
    ...draft,
    template_id: templateId,
    position,
  });
  if (error) throw new Error(error.message);
}

export async function updateShot(id: string, draft: ShotDraft) {
  const { error } = await db("walkthrough_template_shots").update(draft).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteShot(id: string) {
  const { error } = await db("walkthrough_template_shots").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Write back the positions that moved, one row at a time. */
export async function saveShotPositions(changes: { id: string; position: number }[]) {
  for (const change of changes) {
    const { error } = await db("walkthrough_template_shots")
      .update({ position: change.position })
      .eq("id", change.id);
    if (error) throw new Error(error.message);
  }
}
