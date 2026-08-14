import { useEffect, useState } from "react";
import { supabase } from "@/integrations/sitepix/client";
import type { BlueprintItemKind } from "@/features/settings/components/blueprint-outcomes";

const TABLE_FOR_KIND: Record<BlueprintItemKind, string> = {
  checklist: "checklist_templates",
  workflow: "workflow_templates",
  document: "document_templates",
  report: "report_templates",
  label_set: "label_sets",
};

export interface BlueprintContents {
  name: string | null;
  /** In apply order, matching `applyProjectBlueprintService`. */
  items: Array<{ kind: BlueprintItemKind; name: string }>;
  labels: string[];
  loading: boolean;
}

/**
 * Reads one blueprint's contents, resolved to display names.
 *
 * The Templates page already loads every library wholesale for its builder, but
 * anywhere else that wants to show "here is what this blueprint will do" - the
 * new-project form, for one - only needs the one blueprint. Same ordering rule
 * as the server: legacy `project_template_checklists` links first, then
 * `project_template_items` by position.
 */
export function useBlueprintContents(blueprintId: string | null | undefined): BlueprintContents {
  const [state, setState] = useState<BlueprintContents>({
    name: null,
    items: [],
    labels: [],
    loading: false,
  });

  useEffect(() => {
    if (!blueprintId) {
      setState({ name: null, items: [], labels: [], loading: false });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    (async () => {
      const [tplRes, legacyRes, itemRes] = await Promise.all([
        supabase
          .from("project_templates" as any)
          .select("name, labels")
          .eq("id", blueprintId)
          .maybeSingle(),
        supabase
          .from("project_template_checklists" as any)
          .select("checklist_template_id, position")
          .eq("project_template_id", blueprintId)
          .order("position", { ascending: true }),
        supabase
          .from("project_template_items" as any)
          .select("kind, ref_id, position")
          .eq("project_template_id", blueprintId)
          .order("position", { ascending: true }),
      ]);
      if (cancelled) return;

      const refs: Array<{ kind: BlueprintItemKind; refId: string }> = [
        ...((legacyRes.data as any[]) ?? []).map((r) => ({
          kind: "checklist" as BlueprintItemKind,
          refId: r.checklist_template_id as string,
        })),
        ...((itemRes.data as any[]) ?? []).map((r) => ({
          kind: r.kind as BlueprintItemKind,
          refId: r.ref_id as string,
        })),
      ];

      // One query per kind actually present, rather than one per row.
      const byKind = new Map<BlueprintItemKind, string[]>();
      for (const r of refs) {
        const bucket = byKind.get(r.kind);
        if (bucket) bucket.push(r.refId);
        else byKind.set(r.kind, [r.refId]);
      }
      const names = new Map<string, string>();
      await Promise.all(
        [...byKind.entries()].map(async ([kind, ids]) => {
          const { data } = await supabase
            .from(TABLE_FOR_KIND[kind] as any)
            .select("id, name")
            .in("id", ids);
          for (const row of ((data as any[]) ?? []) as Array<{ id: string; name: string }>) {
            names.set(`${kind}:${row.id}`, row.name);
          }
        }),
      );
      if (cancelled) return;

      setState({
        name: ((tplRes.data as any)?.name as string | undefined) ?? null,
        // A ref whose source template was deleted is dropped rather than shown
        // as "(deleted)": this panel is a promise about what will be created,
        // and the apply service skips those rows too.
        items: refs
          .map((r) => ({ kind: r.kind, name: names.get(`${r.kind}:${r.refId}`) }))
          .filter((r): r is { kind: BlueprintItemKind; name: string } => !!r.name),
        labels: (((tplRes.data as any)?.labels as string[] | null) ?? []) as string[],
        loading: false,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [blueprintId]);

  return state;
}
