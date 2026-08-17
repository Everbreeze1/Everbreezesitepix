import { z } from "zod";
import type { AuthedContext } from "../../lib/user-context";

export interface ProjectBoard {
  id: string;
  name: string;
  tag_ids: string[];
  created_by: string;
  created_at: string;
  updated_at: string;
}

async function myTeamId(ctx: AuthedContext): Promise<string | null> {
  const { data } = await ctx.supabase
    .from("team_members" as any)
    .select("team_id")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  return (data as any)?.team_id ?? null;
}

export async function listProjectBoardsService(
  ctx: AuthedContext,
): Promise<{ boards: ProjectBoard[] }> {
  const teamId = await myTeamId(ctx);
  if (!teamId) return { boards: [] };
  const { data } = await (ctx.supabase as any)
    .from("project_boards")
    .select("id, name, tag_ids, created_by, created_at, updated_at")
    .eq("team_id", teamId)
    .order("created_at", { ascending: false });
  return { boards: (data as ProjectBoard[]) ?? [] };
}

export const createProjectBoardInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  tagIds: z.array(z.string().uuid()).min(1).max(20),
});

export async function createProjectBoardService(
  ctx: AuthedContext,
  data: z.infer<typeof createProjectBoardInputSchema>,
): Promise<ProjectBoard> {
  const teamId = await myTeamId(ctx);
  if (!teamId) throw Object.assign(new Error("No team"), { status: 400 });
  const { data: row, error } = await (ctx.supabase as any)
    .from("project_boards")
    .insert({ team_id: teamId, name: data.name, tag_ids: data.tagIds, created_by: ctx.userId })
    .select("id, name, tag_ids, created_by, created_at, updated_at")
    .single();
  if (error) throw Object.assign(new Error(error.message), { status: 400 });
  return row as ProjectBoard;
}

export const updateProjectBoardInputSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  tagIds: z.array(z.string().uuid()).min(1).max(20).optional(),
});

export async function updateProjectBoardService(
  ctx: AuthedContext,
  data: z.infer<typeof updateProjectBoardInputSchema>,
): Promise<ProjectBoard> {
  const patch: Record<string, unknown> = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.tagIds !== undefined) patch.tag_ids = data.tagIds;
  const { data: row, error } = await (ctx.supabase as any)
    .from("project_boards")
    .update(patch)
    .eq("id", data.id)
    .select("id, name, tag_ids, created_by, created_at, updated_at")
    .single();
  if (error) throw Object.assign(new Error(error.message), { status: 400 });
  return row as ProjectBoard;
}

export const deleteProjectBoardInputSchema = z.object({ id: z.string().uuid() });

export async function deleteProjectBoardService(
  ctx: AuthedContext,
  data: z.infer<typeof deleteProjectBoardInputSchema>,
): Promise<{ ok: true }> {
  const { error } = await (ctx.supabase as any).from("project_boards").delete().eq("id", data.id);
  if (error) throw Object.assign(new Error(error.message), { status: 400 });
  return { ok: true };
}
