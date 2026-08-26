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
    .select("id, name, project_id, completed_at")
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
