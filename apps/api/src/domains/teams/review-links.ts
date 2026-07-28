import { z } from "zod";
import type { AuthedContext } from "../../lib/user-context";

export interface ReviewLink {
  id: string;
  platform: "google" | "nicejob" | "custom";
  url: string;
  label: string | null;
  position: number;
}

async function myTeamId(ctx: AuthedContext): Promise<string | null> {
  const { data } = await ctx.supabase
    .from("team_members" as any)
    .select("team_id")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  return (data as any)?.team_id ?? null;
}

export async function listReviewLinksService(ctx: AuthedContext): Promise<{ links: ReviewLink[] }> {
  const teamId = await myTeamId(ctx);
  if (!teamId) return { links: [] };
  const { data } = await (ctx.supabase as any)
    .from("team_review_links")
    .select("id, platform, url, label, position")
    .eq("team_id", teamId)
    .order("position", { ascending: true });
  return { links: (data as ReviewLink[]) ?? [] };
}

export const setReviewLinksInputSchema = z.object({
  links: z
    .array(
      z.object({
        platform: z.enum(["google", "nicejob", "custom"]),
        url: z.string().url().max(500),
        label: z.string().max(60).nullable().optional(),
      }),
    )
    .max(10),
});

export async function setReviewLinksService(
  ctx: AuthedContext,
  data: z.infer<typeof setReviewLinksInputSchema>,
): Promise<{ links: ReviewLink[] }> {
  const teamId = await myTeamId(ctx);
  if (!teamId) throw Object.assign(new Error("No team"), { status: 400 });

  await (ctx.supabase as any).from("team_review_links").delete().eq("team_id", teamId);
  if (data.links.length === 0) return { links: [] };

  const rows = data.links.map((l, i) => ({
    team_id: teamId,
    platform: l.platform,
    url: l.url,
    label: l.label ?? null,
    position: i,
  }));
  const { data: inserted } = await (ctx.supabase as any)
    .from("team_review_links")
    .insert(rows)
    .select("id, platform, url, label, position");
  return { links: (inserted as ReviewLink[]) ?? [] };
}
