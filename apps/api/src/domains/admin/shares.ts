import { z } from "zod";
import { getSupabaseAdmin } from "../../lib/supabase";
import { requirePlatformAdmin } from "../../lib/admin-context";
import { isMissingTable, isMissingColumn } from "../../lib/postgrest";
import { logAdminAction } from "./audit";
import type { AuthedContext } from "../../lib/user-context";

/*
 * Every unauthenticated link this product has ever minted, in one list, with a
 * revoke button.
 *
 * LAUNCH.md 1.2 is the reason. Thirty-one walkthrough share tokens were
 * readable by anyone holding the publishable key for as long as the anon-read
 * hole was open, and they stay valid until rotated - the lockdown closed the
 * leak without un-leaking what had already been taken. The rotation SQL exists,
 * commented out at the bottom of a migration, as an all-or-nothing script that
 * kills every share link the product has ever sent. That is not a decision
 * anyone should have to make in one step, and it is why nothing has been
 * rotated.
 *
 * Per-token revoke turns it back into an ordinary operation.
 *
 * WHICH SOURCES ARE REAL
 *
 * `project_page_shares` and `showcase_shares` appear in the generated types and
 * in migration filenames but do NOT exist in this database - verified against
 * production. They are not listed here. The four below were each confirmed by
 * reading a row.
 */

export type ShareKind = "walkthrough" | "walkthrough_summary" | "showcase" | "project";

export interface ShareLink {
  kind: ShareKind;
  /** Row id of the owning record, which is what revoke targets. */
  id: string;
  title: string;
  token: string;
  createdAt: string | null;
  updatedAt: string | null;
  revokedAt: string | null;
  /** Public path this token opens, for spotting what a leak would expose. */
  publicPath: string;
}

interface SourceSpec {
  kind: ShareKind;
  table: string;
  titleColumn: string;
  revokedColumn: string | null;
  path: (token: string) => string;
}

/*
 * The revoke column differs per table and two of them do not have one at all.
 * That asymmetry is real and is not worth a migration to paper over here: where
 * there is no column, revoke nulls the token, which is what actually stops the
 * link working. Where there is one, it is set as well so the product's own
 * "this link was revoked" copy still renders.
 */
const SOURCES: SourceSpec[] = [
  {
    kind: "walkthrough",
    table: "walkthroughs",
    titleColumn: "title",
    revokedColumn: null,
    path: (t) => `/share/walkthroughs/${t}`,
  },
  {
    kind: "walkthrough_summary",
    table: "walkthrough_summaries",
    titleColumn: "title",
    revokedColumn: null,
    path: (t) => `/share/summaries/${t}`,
  },
  {
    kind: "showcase",
    table: "showcases",
    titleColumn: "title",
    revokedColumn: "revoked_at",
    path: (t) => `/share/showcases/${t}`,
  },
  {
    kind: "project",
    table: "projects",
    titleColumn: "name",
    revokedColumn: "share_revoked_at",
    path: (t) => `/share/projects/${t}`,
  },
];

export const listShareLinksInputSchema = z.object({
  kind: z.enum(["walkthrough", "walkthrough_summary", "showcase", "project"]).optional(),
  /** Revoked links are hidden by default: the queue is about what is live. */
  includeRevoked: z.boolean().default(false),
  limit: z.number().int().min(1).max(500).default(200),
});

export async function listShareLinksService(
  ctx: AuthedContext,
  data: z.infer<typeof listShareLinksInputSchema>,
): Promise<{ links: ShareLink[]; counts: Record<string, number>; unavailable: string[] }> {
  await requirePlatformAdmin(ctx.userId);
  const admin = getSupabaseAdmin();

  const links: ShareLink[] = [];
  const counts: Record<string, number> = {};
  const unavailable: string[] = [];
  const sources = data.kind ? SOURCES.filter((s) => s.kind === data.kind) : SOURCES;

  for (const source of sources) {
    const columns = [
      "id",
      source.titleColumn,
      "share_token",
      "created_at",
      "updated_at",
      ...(source.revokedColumn ? [source.revokedColumn] : []),
    ].join(", ");

    let query = (admin as any)
      .from(source.table)
      .select(columns)
      .not("share_token", "is", null)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (!data.includeRevoked && source.revokedColumn) {
      query = query.is(source.revokedColumn, null);
    }

    const { data: rows, error } = await query;
    if (error) {
      // A source this database does not have is reported, not thrown. The page
      // is more useful listing three of four kinds than failing entirely.
      if (isMissingTable(error) || isMissingColumn(error)) {
        unavailable.push(source.kind);
        continue;
      }
      throw new Error(`${source.table}: ${error.message}`);
    }

    const list = (rows as any[]) ?? [];
    counts[source.kind] = list.length;
    for (const r of list) {
      links.push({
        kind: source.kind,
        id: r.id,
        title: r[source.titleColumn] ?? "(untitled)",
        token: r.share_token,
        createdAt: r.created_at ?? null,
        updatedAt: r.updated_at ?? null,
        revokedAt: source.revokedColumn ? (r[source.revokedColumn] ?? null) : null,
        publicPath: source.path(r.share_token),
      });
    }
  }

  links.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  return { links, counts, unavailable };
}

export const revokeShareLinksInputSchema = z.object({
  kind: z.enum(["walkthrough", "walkthrough_summary", "showcase", "project"]),
  ids: z.array(z.string().uuid()).min(1).max(200),
  reason: z.string().trim().min(3).max(500),
});

/**
 * Kill share links, by row id.
 *
 * Nulling the token is what actually revokes: every public path resolves the
 * record BY token, so a null one cannot be looked up by anybody, including
 * whoever harvested it. Where the table also has a revoked-at column it is
 * stamped, so the product's own "this link is no longer available" page renders
 * instead of a bare not-found.
 *
 * Irreversible by design. The token is not kept anywhere after this, which is
 * the entire point - a revoke that could be undone is a revoke that could be
 * undone by the wrong person.
 */
export async function revokeShareLinksService(
  ctx: AuthedContext,
  data: z.infer<typeof revokeShareLinksInputSchema>,
): Promise<{ revoked: number }> {
  await requirePlatformAdmin(ctx.userId, "owner");
  const admin = getSupabaseAdmin();

  const source = SOURCES.find((s) => s.kind === data.kind);
  if (!source) throw new Error("Unknown share kind");

  const patch: Record<string, unknown> = { share_token: null };
  if (source.revokedColumn) patch[source.revokedColumn] = new Date().toISOString();

  const { error } = await (admin as any).from(source.table).update(patch).in("id", data.ids);
  if (error) throw new Error(error.message);

  await logAdminAction(admin, {
    actorId: ctx.userId,
    action: "revoke_share_links",
    targetType: source.table,
    targetId: data.ids.length === 1 ? data.ids[0] : null,
    metadata: { kind: data.kind, count: data.ids.length, reason: data.reason, ids: data.ids },
  });

  return { revoked: data.ids.length };
}
