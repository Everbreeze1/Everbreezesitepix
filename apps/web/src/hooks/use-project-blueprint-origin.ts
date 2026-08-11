import { useCallback, useEffect, useState } from "react";
import {
  getProjectBlueprintOrigin,
  type BlueprintOriginApplication,
} from "@/lib/blueprint.functions";

export type BlueprintOriginState =
  | { kind: "loading" }
  /** Ledger readable, genuinely no blueprint applied. */
  | { kind: "none" }
  /** The read failed — table absent on this environment, or a real error. */
  | { kind: "unavailable" }
  | { kind: "ok"; applications: BlueprintOriginApplication[] };

export interface ProjectBlueprintOriginResult {
  state: BlueprintOriginState;
  /** Source template id → the blueprint that brought it in. Empty unless `ok`. */
  itemSources: Record<string, { blueprintId: string | null; blueprintName: string | null }>;
  refresh: () => void;
}

/**
 * The project side's only reader of blueprint provenance.
 *
 * Before this there were two independent inline queries with different embeds
 * and two separate local row interfaces, and both collapsed every failure into
 * `null` — so "the ledger is not on this environment" and "no blueprint was
 * applied" rendered identically, with nothing logged. Adding a third reader for
 * per-item badges would have tripled that.
 *
 * Goes through the API rather than querying Supabase directly because the ledger
 * and the blueprint library have different visibility: a teammate can see the
 * project but often not the blueprint that made it, and a browser-side read
 * returned them an empty list indistinguishable from "no blueprint".
 */
export function useProjectBlueprintOrigin(projectId: string): ProjectBlueprintOriginResult {
  const [state, setState] = useState<BlueprintOriginState>({ kind: "loading" });
  const [itemSources, setItemSources] = useState<
    Record<string, { blueprintId: string | null; blueprintName: string | null }>
  >({});
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    (async () => {
      try {
        const res = await getProjectBlueprintOrigin({ data: { projectId } });
        if (cancelled) return;
        if (res.status === "unavailable") {
          // Never silent — this is the state that used to be invisible.
          console.warn("[blueprint-origin] ledger unavailable on this environment", { projectId });
          setState({ kind: "unavailable" });
          setItemSources({});
          return;
        }
        setItemSources(res.itemSources ?? {});
        setState(
          res.applications.length
            ? { kind: "ok", applications: res.applications }
            : { kind: "none" },
        );
      } catch (e: any) {
        if (cancelled) return;
        console.warn("[blueprint-origin] read failed", { projectId, message: e?.message });
        setState({ kind: "unavailable" });
        setItemSources({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, nonce]);

  return { state, itemSources, refresh };
}
