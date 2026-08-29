import { supabase } from "@/lib/supabase";
import type { TemplateItem } from "./template-edit";

/**
 * Managing the shared template library.
 *
 * `templates.ts` next door reads templates and applies them to a project; this
 * is the other half, the part that used to open the web app in a browser.
 *
 * Direct RLS writes rather than `/v1/rpc`, matching how the web settings page
 * does it and matching `labels.ts`: a template is a name and a list of rows
 * scoped to a team, there is nothing to assemble with the service role, and the
 * policy is the whole of the rule.
 *
 * Nothing here is queued through the outbox. Editing the shared library is
 * office work done once and deliberately, not field work that has to survive a
 * basement, and a template item that silently appears twenty minutes later
 * while somebody else is editing the same template is worse than a write that
 * fails and says so.
 */

export type ChecklistTemplate = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  archived: boolean | null;
};

const TEMPLATE_FIELDS = "id, name, description, category, archived";
const ITEM_FIELDS = "id, position, label, description, required, item_type";

/** Every checklist template, archived ones included: this screen manages them. */
export async function listAllChecklistTemplates(): Promise<ChecklistTemplate[]> {
  const { data, error } = await supabase
    .from("checklist_templates")
    .select(TEMPLATE_FIELDS)
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as ChecklistTemplate[]) ?? [];
}

export async function listTemplateItems(templateId: string): Promise<TemplateItem[]> {
  const { data, error } = await supabase
    .from("checklist_template_items")
    .select(ITEM_FIELDS)
    .eq("template_id", templateId)
    .order("position", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as TemplateItem[]) ?? [];
}

export async function createChecklistTemplate(args: {
  name: string;
  description: string | null;
}): Promise<ChecklistTemplate> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("Not signed in");

  const { data, error } = await supabase
    .from("checklist_templates")
    .insert({
      name: args.name,
      description: args.description,
      // Required by the RLS insert policy. A template with no author belongs to
      // nobody and cannot be edited afterwards.
      created_by: userId,
    } as never)
    .select(TEMPLATE_FIELDS)
    .single();
  if (error) throw new Error(error.message);
  return data as ChecklistTemplate;
}

export async function updateChecklistTemplate(
  id: string,
  patch: { name?: string; description?: string | null; archived?: boolean },
): Promise<void> {
  const { error } = await supabase
    .from("checklist_templates")
    .update(patch as never)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function addTemplateItem(
  templateId: string,
  item: Omit<TemplateItem, "id">,
): Promise<TemplateItem> {
  const { data, error } = await supabase
    .from("checklist_template_items")
    .insert({
      template_id: templateId,
      position: item.position,
      label: item.label,
      description: item.description,
      required: item.required,
      item_type: item.item_type,
    } as never)
    .select(ITEM_FIELDS)
    .single();
  if (error) throw new Error(error.message);
  return data as TemplateItem;
}

export async function updateTemplateItem(
  id: string,
  patch: Partial<Pick<TemplateItem, "label" | "description" | "required" | "item_type">>,
): Promise<void> {
  const { error } = await supabase
    .from("checklist_template_items")
    .update(patch as never)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteTemplateItem(id: string): Promise<void> {
  const { error } = await supabase.from("checklist_template_items").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Write back the positions that actually moved.
 *
 * One statement per row, because PostgREST has no "update these ids to these
 * different values" form and a bulk upsert would need every column of every
 * row. `positionChanges` keeps the list to the two or three that moved, which
 * is what makes that acceptable.
 *
 * Sequential rather than `Promise.all`: they are writes to adjacent rows of one
 * table and firing twenty at once on a weak connection is how a reorder ends up
 * half applied.
 */
export async function saveItemPositions(
  changes: { id: string; position: number }[],
): Promise<void> {
  for (const change of changes) {
    const { error } = await supabase
      .from("checklist_template_items")
      .update({ position: change.position } as never)
      .eq("id", change.id);
    if (error) throw new Error(error.message);
  }
}
