import { supabase } from "@/lib/supabase";

/**
 * Project checklists: the "stand on site and work through it" surface.
 *
 * Answer shapes match what the web runner writes
 * (`apps/web/src/features/projects/pages/ChecklistDocumentPage.tsx`), because
 * the same checklist is rendered by the web app, the public share page, and the
 * printed sheet. A value stored in a different shape here would come out as
 * `null` on paper, on a customer-facing link, or both.
 */

export type ChecklistSummary = {
  id: string;
  name: string;
  project_id: string;
  completed_at: string | null;
  updated_at: string;
  assigned_to: string | null;
  /** Filled in by `listProjectChecklists`, not a column. */
  total: number;
  done: number;
};

export type ChecklistItem = {
  id: string;
  checklist_id: string;
  label: string;
  description: string | null;
  item_type: string;
  required: boolean;
  position: number;
  notes: string | null;
  response_value: unknown;
  completed_at: string | null;
};

export type ChecklistDetail = {
  id: string;
  name: string;
  project_id: string;
  completed_at: string | null;
  /** Who made it, holds it, handed it over and sealed it: the reopen rule reads all four. */
  created_by: string | null;
  assigned_to: string | null;
  assigned_by: string | null;
  completed_by: string | null;
  /*
   * Minted when the checklist is created and kept for good. Sharing is switched
   * off by stamping a revoked timestamp, not by destroying the token, so turning
   * it back on restores the same URL rather than invalidating one already sent
   * to a customer.
   */
  share_token: string | null;
  revoked_at: string | null;
  items: ChecklistItem[];
};

const ITEM_FIELDS =
  "id, checklist_id, label, description, item_type, required, position, notes, response_value, completed_at";

/** Checklists on a project, each with its progress counts. */
export async function listProjectChecklists(projectId: string): Promise<ChecklistSummary[]> {
  const { data: lists, error } = await supabase
    .from("project_checklists")
    .select("id, name, project_id, completed_at, updated_at, assigned_to")
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false });

  if (error) throw new Error(error.message);
  const rows = (lists as Omit<ChecklistSummary, "total" | "done">[]) ?? [];
  if (rows.length === 0) return [];

  /*
   * Progress comes from a second query rather than a nested count. A phone
   * showing "0 of 12" when it means "9 of 12" is worse than showing nothing,
   * and a single round trip for every checklist's items is cheaper than an
   * aggregate per row.
   */
  const { data: items } = await supabase
    .from("project_checklist_items")
    .select("checklist_id, completed_at")
    .in(
      "checklist_id",
      rows.map((row) => row.id),
    );

  const totals = new Map<string, { total: number; done: number }>();
  for (const item of (items as { checklist_id: string; completed_at: string | null }[]) ?? []) {
    const entry = totals.get(item.checklist_id) ?? { total: 0, done: 0 };
    entry.total += 1;
    if (item.completed_at) entry.done += 1;
    totals.set(item.checklist_id, entry);
  }

  return rows.map((row) => ({
    ...row,
    total: totals.get(row.id)?.total ?? 0,
    done: totals.get(row.id)?.done ?? 0,
  }));
}

export async function getChecklist(checklistId: string): Promise<ChecklistDetail | null> {
  const { data: list, error } = await supabase
    .from("project_checklists")
    .select(
      "id, name, project_id, completed_at, created_by, assigned_to, assigned_by, completed_by, share_token, revoked_at",
    )
    .eq("id", checklistId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!list) return null;

  const { data: items, error: itemsError } = await supabase
    .from("project_checklist_items")
    .select(ITEM_FIELDS)
    .eq("checklist_id", checklistId)
    .order("position", { ascending: true });

  if (itemsError) throw new Error(itemsError.message);

  return {
    ...(list as Omit<ChecklistDetail, "items">),
    items: (items as ChecklistItem[]) ?? [],
  };
}

/*
 * Answer shaping lives in `./checklist-answers`, which imports nothing, so the
 * rules can be tested without a Supabase client standing in the way.
 */
export {
  choicesFor,
  hasResponse,
  parseNumericAnswer,
  responsePatch,
  toggledResponse,
} from "./checklist-answers";

export async function applyItemPatch(
  itemId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from("project_checklist_items")
    .update(patch as never)
    .eq("id", itemId);
  if (error) throw new Error(error.message);
}

/** Link an already-uploaded photo to a checklist item. */
export async function attachPhotoToItem(
  itemId: string,
  photoId: string,
  userId: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("checklist_item_photos")
    .insert({ item_id: itemId, photo_id: photoId, created_by: userId });
  if (error) throw new Error(error.message);
}

/*
 * Structure edits: the Edit mode of the runner.
 *
 * Direct table writes, the same ones `ChecklistDocumentPage` makes on the web.
 * None are queued. Adding, removing and reordering items is deliberate office
 * work done with a connection, and an item that appears twenty minutes later
 * while someone else is working the list is worse than a write that fails now.
 * The authoring trigger refuses these for anyone without the right, and its
 * sentence is passed through.
 */

/** Append items, in order, after `startPosition`. Returns the new rows. */
export async function addChecklistItems(
  checklistId: string,
  labels: string[],
  itemType: string,
  startPosition: number,
): Promise<ChecklistItem[]> {
  if (labels.length === 0) return [];
  const { data, error } = await supabase
    .from("project_checklist_items")
    .insert(
      labels.map((label, index) => ({
        checklist_id: checklistId,
        label,
        position: startPosition + index,
        item_type: itemType,
      })) as never,
    )
    .select(ITEM_FIELDS);
  if (error) throw new Error(error.message);
  return (data as ChecklistItem[]) ?? [];
}

export async function deleteChecklistItem(itemId: string): Promise<void> {
  const { error } = await supabase.from("project_checklist_items").delete().eq("id", itemId);
  if (error) throw new Error(error.message);
}

/** Write the positions that changed after a move. */
export async function saveChecklistItemPositions(
  changes: { id: string; position: number }[],
): Promise<void> {
  const results = await Promise.all(
    changes.map((change) =>
      supabase
        .from("project_checklist_items")
        .update({ position: change.position } as never)
        .eq("id", change.id),
    ),
  );
  const failed = results.find((result) => result.error);
  if (failed?.error) throw new Error(failed.error.message);
}

export async function patchChecklist(
  checklistId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from("project_checklists")
    .update(patch as never)
    .eq("id", checklistId);
  if (error) throw new Error(error.message);
}

/**
 * Delete a checklist and, by cascade, its items.
 *
 * The row is selected back because RLS refuses by matching nothing, and a
 * checklist that disappears and returns on the next refresh reads as a bug.
 */
export async function deleteChecklist(checklistId: string): Promise<void> {
  const { data, error } = await supabase
    .from("project_checklists")
    .delete()
    .eq("id", checklistId)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error("You do not have permission to delete this checklist.");
  }
}

/** The name the web gives a blank checklist until someone renames it. */
export const UNTITLED_CHECKLIST = "Untitled checklist";

/** Start an empty checklist on a project, as the web's "Blank checklist" does. */
export async function createBlankChecklist(projectId: string, userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("project_checklists")
    .insert({ project_id: projectId, name: UNTITLED_CHECKLIST, created_by: userId } as never)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Could not create that checklist");
  return (data as { id: string }).id;
}

/**
 * Copy this checklist's items into a new workspace template.
 *
 * Two inserts, like the web. If the items fail, the empty template is removed
 * again so the library is not left with a name that has nothing under it.
 */
export async function saveChecklistAsTemplate(args: {
  name: string;
  userId: string;
  items: ChecklistItem[];
}): Promise<void> {
  const { data: template, error } = await supabase
    .from("checklist_templates")
    .insert({ created_by: args.userId, name: args.name } as never)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const templateId = (template as { id: string } | null)?.id;
  if (!templateId) throw new Error("Could not save that template");

  if (args.items.length === 0) return;
  const ordered = [...args.items].sort((a, b) => a.position - b.position);
  const { error: itemsError } = await supabase.from("checklist_template_items").insert(
    ordered.map((item, index) => ({
      template_id: templateId,
      position: index,
      label: item.label,
      required: item.required,
      item_type: item.item_type ?? "checkbox",
      description: item.description,
    })) as never,
  );
  if (itemsError) {
    await supabase.from("checklist_templates").delete().eq("id", templateId);
    throw new Error(itemsError.message);
  }
}

/** Photo ids attached to each item, for the sealed copy written on completion. */
export async function listItemPhotoIds(itemIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (itemIds.length === 0) return map;
  const { data, error } = await supabase
    .from("checklist_item_photos")
    .select("item_id, photo_id, created_at")
    .in("item_id", itemIds)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  for (const row of (data as { item_id: string; photo_id: string }[]) ?? []) {
    const list = map.get(row.item_id) ?? [];
    list.push(row.photo_id);
    map.set(row.item_id, list);
  }
  return map;
}

/**
 * Seal a checklist: the same single update the web's Mark as complete writes.
 * The completion trigger refuses someone who may not close it, and its
 * sentence is passed through.
 */
export async function completeChecklist(
  checklistId: string,
  args: { completedAt: string; userId: string; snapshot: unknown },
): Promise<void> {
  const { error } = await supabase
    .from("project_checklists")
    .update({
      completed_at: args.completedAt,
      completed_by: args.userId,
      snapshot: args.snapshot,
    } as never)
    .eq("id", checklistId);
  if (error) throw new Error(error.message);
}
