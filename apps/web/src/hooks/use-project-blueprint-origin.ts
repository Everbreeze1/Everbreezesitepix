import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getProjectBlueprintOrigin,
  type BlueprintOriginApplication,
} from "@/lib/blueprint.functions";

export type BlueprintOriginState =
  | { kind: "loading" }
  /** Ledger readable, genuinely no blueprint applied. */
  | { kind: "none" }
  /** The read failed - table absent on this environment, or a real error. */
  | { kind: "unavailable" }
  | { kind: "ok"; applications: BlueprintOriginApplication[] };

/** What a single row's badge should say. `null` = say nothing at all. */
export type ItemOrigin = { blueprintName: string | null; inferred?: boolean } | "manual" | null;

export interface ProjectBlueprintOriginResult {
  state: BlueprintOriginState;
  /** Source template id → the blueprint that brought it in. Empty unless `ok`. */
  itemSources: Record<string, { blueprintId: string | null; blueprintName: string | null }>;
  /**
   * The badge for one row, by its own id.
   *
   * Recorded origin first: every row a blueprint created points back at the
   * apply that made it, so this is exact. `sourceTemplateId` is only consulted
   * on a database still waiting for 20260924000000, where the old template
   * inference is all there is.
   *
   * Returns `"manual"` only when this project HAS a blueprint and per-item
   * origin is readable - so the tag means "not from the blueprint", which is a
   * fact, rather than "no blueprint here", which is noise.
   */
  originOf: (itemId: string, sourceTemplateId?: string | null) => ItemOrigin;
  refresh: () => void;
}

/**
 * The project side's only reader of blueprint provenance.
 *
 * Before this there were two independent inline queries with different embeds
 * and two separate local row interfaces, and both collapsed every failure into
 * `null` - so "the ledger is not on this environment" and "no blueprint was
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
          // Never silent - this is the state that used to be invisible.
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

  /*
   * Item id → what created it, flattened out of every application on this
   * project. Built here rather than in each tab so the four tabs that show a
   * badge cannot drift apart, and so none of them has to re-query: the panel's
   * own read already carries every row a blueprint made.
   */
  const { itemOrigins, originTracked } = useMemo(() => {
    const map: Record<string, { blueprintName: string | null; inferred: boolean }> = {};
    if (state.kind !== "ok") return { itemOrigins: map, originTracked: false };
    // `liveCounts === null` is the server saying it could not read per-item
    // origin at all. That is not "nothing was created", so it must not become
    // an "Added manually" tag on every row in the project.
    const tracked = state.applications.some((a) => a.liveCounts !== null);
    for (const app of state.applications) {
      for (const it of app.items) {
        map[it.id] = { blueprintName: app.blueprintName, inferred: it.inferred };
      }
    }
    return { itemOrigins: map, originTracked: tracked };
  }, [state]);

  const originOf = useCallback(
    (itemId: string, sourceTemplateId?: string | null): ItemOrigin => {
      const recorded = itemOrigins[itemId];
      if (recorded) return recorded;
      if (originTracked) return state.kind === "ok" ? "manual" : null;
      // Migration pending: fall back to the old template inference, which is
      // approximate, so it never claims a row is manual - only that it looks
      // like it came from a blueprint.
      const guess = sourceTemplateId ? itemSources[sourceTemplateId] : null;
      return guess ? { blueprintName: guess.blueprintName, inferred: true } : null;
    },
    [itemOrigins, originTracked, itemSources, state.kind],
  );

  return { state, itemSources, originOf, refresh };
}
