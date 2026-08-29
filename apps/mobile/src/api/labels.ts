import { supabase } from "@/lib/supabase";

/**
 * Workspace labels.
 *
 * Direct RLS reads and writes, unlike almost everything else the phone does
 * through `/v1/rpc`. That matches the web app, which also goes straight at the
 * table: a label is a name and a colour scoped to a team, there is nothing to
 * assemble with the service role, and the RLS policy is the whole of the rule.
 *
 * `(supabase as any)` because `packages/db` still declares roughly fourteen
 * tables and `labels` is not among them. The cast is the same one
 * `use-label-catalog.tsx` carries on the web, and it goes away when the
 * generated types are regenerated, not before.
 */

export type LabelRow = {
  id: string;
  team_id: string | null;
  created_by: string | null;
  name: string;
  color: string | null;
  created_at: string;
  updated_at: string | null;
};

const COLUMNS = "id, team_id, created_by, name, color, created_at, updated_at";

export async function listLabels(): Promise<LabelRow[]> {
  const { data, error } = await (supabase as any)
    .from("labels")
    .select(COLUMNS)
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as LabelRow[];
}

export async function createLabel(args: {
  name: string;
  color: string;
  teamId: string | null;
  userId: string;
}): Promise<LabelRow> {
  const { data, error } = await (supabase as any)
    .from("labels")
    .insert({
      name: args.name.trim(),
      color: args.color,
      team_id: args.teamId,
      // Required by the RLS insert policy: a label with no author belongs to
      // nobody and cannot be edited afterwards.
      created_by: args.userId,
    })
    .select(COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return data as LabelRow;
}

export async function updateLabel(
  id: string,
  patch: { name?: string; color?: string },
): Promise<void> {
  const { error } = await (supabase as any).from("labels").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteLabel(id: string): Promise<void> {
  const { error } = await (supabase as any).from("labels").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
