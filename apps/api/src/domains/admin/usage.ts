import { z } from "zod";
import { getSupabaseAdmin } from "../../lib/supabase";
import { requirePlatformAdmin } from "../../lib/admin-context";
import { isMissingTable } from "../../lib/postgrest";
import type { AuthedContext } from "../../lib/user-context";

/*
 * What the paid features actually cost, and who is spending it.
 *
 * Photo analysis, walkthrough summaries, report generation and TTS all call
 * metered third parties, and none of it has ever been counted. So the unit
 * economics of a customer are unknown, and an account burning a hundred
 * analyses a day looks exactly like an account burning none.
 *
 * The cost column is an ESTIMATE and is labelled as one everywhere it is shown.
 * The real numbers live on the providers' invoices; this exists to answer "is
 * anyone abnormal" and "roughly what does a heavy team cost us", which a
 * monthly invoice total cannot.
 */

/**
 * Rough per-unit costs in USD.
 *
 * Deliberately conservative round numbers rather than precise ones. Precision
 * here would be false: token counts are not recorded, so a per-call average is
 * the best available input, and a figure to four decimal places would imply a
 * confidence this data cannot support. Update when the provider pricing moves.
 */
const UNIT_COST_USD = {
  photoAnalysis: 0.004,
  walkthroughSummary: 0.02,
  reportGeneration: 0.02,
} as const;

export interface UsageRow {
  teamId: string | null;
  teamName: string;
  photoAnalyses: number;
  walkthroughSummaries: number;
  autoReports: number;
  photoCount: number;
  storageBytes: number;
  estimatedAiCostUsd: number;
}

export interface PlatformUsage {
  windowDays: number;
  rows: UsageRow[];
  totals: {
    photoAnalyses: number;
    walkthroughSummaries: number;
    autoReports: number;
    storageBytes: number;
    estimatedAiCostUsd: number;
  };
  unavailable: string[];
}

export const getPlatformUsageInputSchema = z.object({
  windowDays: z.number().int().min(1).max(365).default(30),
});

export async function getPlatformUsageService(
  ctx: AuthedContext,
  data: z.infer<typeof getPlatformUsageInputSchema>,
): Promise<PlatformUsage> {
  await requirePlatformAdmin(ctx.userId);
  const admin = getSupabaseAdmin();

  const since = new Date(Date.now() - data.windowDays * 24 * 60 * 60 * 1000).toISOString();
  const unavailable: string[] = [];

  const [teamsRes, membersRes] = await Promise.all([
    (admin as any).from("teams").select("id, name"),
    (admin as any).from("team_members").select("team_id, user_id"),
  ]);
  if (teamsRes.error) throw new Error(teamsRes.error.message);

  const teams = ((teamsRes.data as any[]) ?? []) as Array<{ id: string; name: string }>;
  const members = ((membersRes.data as any[]) ?? []) as Array<{
    team_id: string;
    user_id: string;
  }>;

  // A user in two teams belongs to both lists, matching the attribution rule
  // admin_team_rollups uses. See its migration header.
  const teamsByUser = new Map<string, string[]>();
  for (const m of members) {
    teamsByUser.set(m.user_id, [...(teamsByUser.get(m.user_id) ?? []), m.team_id]);
  }

  /** Count rows created in the window, bucketed by the creator's teams. */
  const tally = async (
    table: string,
    creatorColumn: string,
    dateColumn = "created_at",
  ): Promise<Map<string | null, number>> => {
    const out = new Map<string | null, number>();
    const { data: rows, error } = await (admin as any)
      .from(table)
      .select(creatorColumn)
      .gte(dateColumn, since);
    if (error) {
      if (isMissingTable(error)) {
        unavailable.push(table);
        return out;
      }
      throw new Error(`${table}: ${error.message}`);
    }
    for (const r of ((rows as any[]) ?? []) as any[]) {
      const teamIds = teamsByUser.get(r[creatorColumn]) ?? [];
      // Work by a user in no team is attributed to null and shown as
      // "Unattributed" rather than dropped - it is still spend.
      if (!teamIds.length) out.set(null, (out.get(null) ?? 0) + 1);
      for (const t of teamIds) out.set(t, (out.get(t) ?? 0) + 1);
    }
    return out;
  };

  const [analyses, summaries, reports] = await Promise.all([
    tally("ai_analyses", "created_by"),
    tally("walkthrough_summaries", "created_by"),
    tally("auto_report_generations", "created_by"),
  ]);

  // Storage is lifetime rather than windowed - the bill is for what is stored
  // now, not for what was uploaded this month.
  const storageByTeam = new Map<string, { photoCount: number; storageBytes: number }>();
  const teamIds = teams.map((t) => t.id);
  if (teamIds.length) {
    const { data: rollups, error } = await (admin as any).rpc("admin_team_rollups", {
      team_ids: teamIds,
    });
    if (!error) {
      for (const r of ((rollups as any[]) ?? []) as any[]) {
        storageByTeam.set(r.team_id, {
          photoCount: Number(r.photo_count ?? 0),
          storageBytes: Number(r.storage_bytes ?? 0),
        });
      }
    } else {
      unavailable.push("admin_team_rollups");
    }
  }

  const buildRow = (id: string | null, name: string): UsageRow => {
    const photoAnalyses = analyses.get(id) ?? 0;
    const walkthroughSummaries = summaries.get(id) ?? 0;
    const autoReports = reports.get(id) ?? 0;
    const storage = id ? (storageByTeam.get(id) ?? { photoCount: 0, storageBytes: 0 }) : null;
    return {
      teamId: id,
      teamName: name,
      photoAnalyses,
      walkthroughSummaries,
      autoReports,
      photoCount: storage?.photoCount ?? 0,
      storageBytes: storage?.storageBytes ?? 0,
      estimatedAiCostUsd: Number(
        (
          photoAnalyses * UNIT_COST_USD.photoAnalysis +
          walkthroughSummaries * UNIT_COST_USD.walkthroughSummary +
          autoReports * UNIT_COST_USD.reportGeneration
        ).toFixed(2),
      ),
    };
  };

  const rows = teams.map((t) => buildRow(t.id, t.name));
  const orphan = buildRow(null, "Unattributed (no team)");
  if (orphan.photoAnalyses || orphan.walkthroughSummaries || orphan.autoReports) {
    rows.push(orphan);
  }
  rows.sort(
    (a, b) => b.estimatedAiCostUsd - a.estimatedAiCostUsd || b.storageBytes - a.storageBytes,
  );

  return {
    windowDays: data.windowDays,
    rows,
    totals: {
      photoAnalyses: rows.reduce((s, r) => s + r.photoAnalyses, 0),
      walkthroughSummaries: rows.reduce((s, r) => s + r.walkthroughSummaries, 0),
      autoReports: rows.reduce((s, r) => s + r.autoReports, 0),
      storageBytes: rows.reduce((s, r) => s + r.storageBytes, 0),
      estimatedAiCostUsd: Number(rows.reduce((s, r) => s + r.estimatedAiCostUsd, 0).toFixed(2)),
    },
    unavailable: Array.from(new Set(unavailable)),
  };
}

// ---------------------------------------------------------------------------
// Global content library
// ---------------------------------------------------------------------------

export interface ContentLibraryEntry {
  kind: string;
  table: string;
  total: number;
  /** Rows with no owning team: the platform-wide library every customer sees. */
  global: number;
  available: boolean;
}

/*
 * Which tables hold the templates that ship to every customer.
 *
 * `ownerColumn` is how a global row is told from a customer's own copy. Where a
 * table has no such column the count is reported as total only, and `global` is
 * left at zero rather than guessed.
 */
const LIBRARY_SOURCES: Array<{ kind: string; table: string; ownerColumn: string | null }> = [
  { kind: "Document templates", table: "document_templates", ownerColumn: "team_id" },
  { kind: "Report templates", table: "report_templates", ownerColumn: "team_id" },
  { kind: "Checklist templates", table: "checklist_templates", ownerColumn: "team_id" },
  { kind: "Workflow templates", table: "workflow_templates", ownerColumn: "team_id" },
  { kind: "Project templates", table: "project_templates", ownerColumn: "team_id" },
  { kind: "Walkthrough templates", table: "walkthrough_templates", ownerColumn: "team_id" },
  { kind: "Label sets", table: "label_sets", ownerColumn: "team_id" },
];

/**
 * A count of the platform-wide content library.
 *
 * Deliberately counts rather than edits. Editing a global template from here
 * would need a full editor per template type - six different shapes - and the
 * product already has those editors. What was missing is the answer to "what is
 * in the library at all, and how much of it is ours versus a customer's", which
 * previously required seven separate SELECTs.
 */
export async function getContentLibraryService(
  ctx: AuthedContext,
): Promise<{ entries: ContentLibraryEntry[] }> {
  await requirePlatformAdmin(ctx.userId);
  const admin = getSupabaseAdmin();

  const entries: ContentLibraryEntry[] = [];
  for (const source of LIBRARY_SOURCES) {
    const { count, error } = await (admin as any)
      .from(source.table)
      .select("id", { count: "exact", head: true });
    if (error) {
      entries.push({
        kind: source.kind,
        table: source.table,
        total: 0,
        global: 0,
        available: false,
      });
      continue;
    }

    let global = 0;
    if (source.ownerColumn) {
      const { count: globalCount, error: globalError } = await (admin as any)
        .from(source.table)
        .select("id", { count: "exact", head: true })
        .is(source.ownerColumn, null);
      if (!globalError) global = globalCount ?? 0;
    }

    entries.push({
      kind: source.kind,
      table: source.table,
      total: count ?? 0,
      global,
      available: true,
    });
  }

  return { entries };
}
