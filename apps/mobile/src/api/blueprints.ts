import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { ApplyResult, BlueprintOption } from "./blueprints-view";

/**
 * Project blueprints.
 *
 * A blueprint bundles everything a company sets up for one kind of job:
 * checklists, workflows, documents, draft reports, shot lists and label sets.
 * Applying one instantiates the lot onto a project, which is the difference
 * between starting a job and setting one up, and is the single most useful
 * thing to be able to do from a van.
 *
 * Applying is an `/v1/rpc` op and could not be anything else. It reads through
 * the caller's own client purely to prove they may see the blueprint - the
 * service comment is explicit that skipping that check let a pasted id copy
 * another team's whole template library into your project through a write
 * endpoint - and then does the copying with the service role.
 *
 * Listing is a direct RLS read, matching the web.
 */

export type { BlueprintOption, ApplyResult } from "./blueprints-view";

/**
 * Blueprints this account may see.
 *
 * The two-step select is not defensive habit, it is a bug the web already hit:
 * `category` and `default_for_category` arrive with migration
 * 20260908000000, and PostgREST rejects the entire select over one unknown
 * column. Without the retry a database still waiting for that migration returns
 * NO blueprints at all, and the chooser is empty rather than degraded - so the
 * person concludes they have none.
 */
export async function listBlueprints(): Promise<BlueprintOption[]> {
  const BASE = "id, name, labels, archived";

  let rows: Record<string, unknown>[] | null = null;
  const full = await supabase
    .from("project_templates" as never)
    .select(`${BASE}, category, default_for_category`)
    .eq("archived", false)
    .order("name", { ascending: true });

  if (full.error) {
    const fallback = await supabase
      .from("project_templates" as never)
      .select(BASE)
      .eq("archived", false)
      .order("name", { ascending: true });
    if (fallback.error) throw new Error(fallback.error.message);
    rows = (fallback.data as Record<string, unknown>[] | null) ?? [];
  } else {
    rows = (full.data as Record<string, unknown>[] | null) ?? [];
  }

  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name ?? "Untitled blueprint"),
    labels: Array.isArray(row.labels) ? (row.labels as string[]) : [],
    category: (row.category as string | null) ?? null,
    isDefault: Boolean(row.default_for_category),
  }));
}

export async function applyBlueprint(input: {
  blueprintId: string;
  projectId: string;
  projectName: string;
  projectAddress?: string | null;
  preparedBy?: string;
  companyName?: string;
}): Promise<ApplyResult> {
  /*
   * The project's own name and address travel with the request because the
   * service fills `{{ }}` tokens in the blueprint's documents with them. Sending
   * a blank name does not fail; it leaves the token unreplaced in the document,
   * which is the "squiggles" a client would then read in a site log.
   */
  const result = await api.rpc<Partial<ApplyResult>>("applyProjectBlueprint", {
    blueprintId: input.blueprintId,
    projectId: input.projectId,
    projectName: input.projectName,
    projectAddress: input.projectAddress ?? null,
    preparedBy: input.preparedBy,
    companyName: input.companyName,
  });

  return {
    counts: result.counts ?? {},
    failed: result.failed ?? [],
    // Absent is treated as "not recorded" rather than as success: the warning
    // this drives exists because a silent flag nobody reads is the same as no
    // flag at all.
    ledgerRecorded: Boolean(result.ledgerRecorded),
    originTagged: Boolean(result.originTagged),
  };
}

/**
 * One recorded apply. A subset of what the service returns, and deliberately:
 * the phone shows provenance rather than the full item-by-item ledger the web
 * panel draws, so it takes the four fields it renders and ignores the rest.
 */
export type BlueprintApplication = {
  applicationId: string;
  blueprintId: string | null;
  /** Kept on the ledger row, so it survives the blueprint being deleted. */
  blueprintName: string | null;
  appliedByName: string | null;
  appliedAt: string;
  counts: Record<string, number>;
};

export type BlueprintOrigin = {
  status: "ok" | "unavailable";
  applications: BlueprintApplication[];
};

/** Which blueprint set this project up, if anything recorded it. */
export async function getBlueprintOrigin(projectId: string): Promise<BlueprintOrigin> {
  const result = await api.rpc<Partial<BlueprintOrigin>>("getProjectBlueprintOrigin", {
    projectId,
  });
  return {
    // "unavailable" is a real answer, not a failure: the ledger table may not
    // exist yet on this database, and the service says so rather than throwing.
    status: result.status === "unavailable" ? "unavailable" : "ok",
    applications: result.applications ?? [],
  };
}
