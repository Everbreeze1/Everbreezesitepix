import { rpcOp } from "./sitepix-api";

export const applyProjectBlueprint = rpcOp<
  {
    blueprintId: string;
    projectId: string;
    projectName: string;
    projectAddress?: string | null;
    preparedBy?: string;
    companyName?: string;
  },
  {
    counts: Record<string, number>;
    /** Items that could not be created. Empty on a fully clean apply. */
    failed: Array<{ kind: string; reason: string }>;
    /**
     * False when the ledger row could not be written - the apply itself
     * succeeded, but the project will not be able to show which blueprint made
     * it. Best-effort on the server, so this is the only signal.
     */
    ledgerRecorded: boolean;
  }
>("applyProjectBlueprint");

export interface BlueprintOriginApplication {
  /** null once the blueprint has been deleted; `blueprintName` still names it. */
  blueprintId: string | null;
  blueprintName: string | null;
  /** May this viewer open the blueprint? Teammates often cannot. */
  blueprintVisible: boolean;
  /** Reconstructed by the backfill rather than observed at apply time. */
  inferred: boolean;
  /**
   * The bundle version this project received.
   *
   * Null on applies recorded before the column existed, and on a database still
   * without it, so every reader has to treat "no version" as ordinary rather
   * than as an error.
   */
  version: number | null;
  /**
   * What the blueprint is at now, when this viewer can see it. Higher than
   * `version` means it has been edited since, and that this project was
   * deliberately left as it was.
   */
  currentVersion: number | null;
  appliedAt: string;
  counts: Record<string, number>;
  failedCount: number;
}

export interface ProjectBlueprintOrigin {
  /** `unavailable` = the ledger could not be read, NOT "no blueprint applied". */
  status: "ok" | "unavailable";
  applications: BlueprintOriginApplication[];
  /** Source template id → the blueprint that brought it in, for per-item badges. */
  itemSources: Record<string, { blueprintId: string | null; blueprintName: string | null }>;
}

export const getProjectBlueprintOrigin = rpcOp<{ projectId: string }, ProjectBlueprintOrigin>(
  "getProjectBlueprintOrigin",
);

export type BlueprintSourceMap = Record<
  string,
  { blueprintId: string | null; blueprintName: string | null }
>;

/**
 * `itemSources` for several projects at once, keyed by project id.
 *
 * The workspace Reports screen lists reports from every project together, so
 * the per-project endpoint would mean one round trip per group.
 */
export const listBlueprintItemSources = rpcOp<
  { projectIds: string[] },
  { status: "ok" | "unavailable"; byProject: Record<string, BlueprintSourceMap> }
>("listBlueprintItemSources");
