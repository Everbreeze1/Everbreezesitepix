import { z } from "zod";
import type { AuthedContext } from "../../lib/user-context";

async function requireTeamId(ctx: AuthedContext): Promise<string> {
  const { data } = await (ctx.supabase as any)
    .from("team_members")
    .select("team_id")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (!data) throw new Error("Create a team first.");
  return data.team_id as string;
}

export async function listTextSnippetsService(ctx: AuthedContext) {
  const teamId = await requireTeamId(ctx);
  const { data, error } = await (ctx.supabase as any)
    .from("text_snippets")
    .select("id, title, content_html, created_at")
    .eq("team_id", teamId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return { snippets: (data as any[]) ?? [] };
}

export const createTextSnippetInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  contentHtml: z.string().min(1).max(20_000),
});
export async function createTextSnippetService(
  ctx: AuthedContext,
  data: z.infer<typeof createTextSnippetInputSchema>,
) {
  const teamId = await requireTeamId(ctx);
  const { data: row, error } = await (ctx.supabase as any)
    .from("text_snippets")
    .insert({ team_id: teamId, created_by: ctx.userId, title: data.title, content_html: data.contentHtml })
    .select("id, title, content_html, created_at")
    .single();
  if (error) throw new Error(error.message);
  return { snippet: row };
}

export const updateTextSnippetInputSchema = z.object({
  snippetId: z.string().uuid(),
  title: z.string().trim().min(1).max(120).optional(),
  contentHtml: z.string().min(1).max(20_000).optional(),
});
export async function updateTextSnippetService(
  ctx: AuthedContext,
  data: z.infer<typeof updateTextSnippetInputSchema>,
) {
  const patch: Record<string, unknown> = {};
  if (data.title !== undefined) patch.title = data.title;
  if (data.contentHtml !== undefined) patch.content_html = data.contentHtml;
  if (Object.keys(patch).length === 0) return { ok: true };
  const { error } = await (ctx.supabase as any).from("text_snippets").update(patch).eq("id", data.snippetId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export const deleteTextSnippetInputSchema = z.object({ snippetId: z.string().uuid() });
export async function deleteTextSnippetService(
  ctx: AuthedContext,
  data: z.infer<typeof deleteTextSnippetInputSchema>,
) {
  const { error } = await (ctx.supabase as any).from("text_snippets").delete().eq("id", data.snippetId);
  if (error) throw new Error(error.message);
  return { ok: true };
}
