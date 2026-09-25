import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/everlumen/client";

/*
 * The Blueprints library page, laid out exactly as the Main-html reference
 * (public/Main-html/BlueprintsContent.dc.html): a card grid that opens an
 * in-page editor for the selected blueprint.
 *
 * Unlike the reference (a static mockup), the cards and the editor are filled
 * from the account's real data - project_templates, whatever checklists /
 * workflow / document / report templates each blueprint holds, and how many
 * projects each blueprint has been applied to.
 */

export type RowKind = "checklist" | "workflow" | "document" | "report";

interface SectionRow {
  kind: RowKind;
  name: string;
  /** Item count for checklist rows ("6 items"). */
  items?: number;
  /** Phases for the one workflow row (or empty when none attached). */
  phaseRows?: Array<{ id: string; name: string; steps: number }>;
}

interface Blueprint {
  id: string;
  name: string;
  description: string | null;
  archived: boolean;
  category: string | null;
}

/* ---- Icons (paths from the mockup's inline SVGs) ---- */

function BoxIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3.5 8.5 4.8L12 13 3.5 8.3 12 3.5Z" />
      <path d="m3.5 13 8.5 4.8 8.5-4.8" />
    </svg>
  );
}

function ChecklistIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m4 6 1.6 1.6L8.5 4.8" />
      <path d="M11 6h9.5" />
      <path d="m4 12.5 1.6 1.6 2.9-2.8" />
      <path d="M11 12.5h9.5" />
    </svg>
  );
}

function PhasesIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}

function PlusIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.05em] text-faint">
      {children}
    </div>
  );
}

function AddRow({ children, onPick }: { children: ReactNode; onPick: () => void }) {
  return (
    <div className="cursor-pointer py-[9px] text-[12.5px] font-semibold text-primary" onClick={onPick}>
      {children}
    </div>
  );
}

/* ---- Editor view (the mockup's <sc-if isEditor> block), real data ---- */

function BlueprintEditor({
  blueprint,
  rows,
  usedOn,
  appliedAvailable,
  onBack,
  onSave,
  onAddSection,
}: {
  blueprint: Blueprint;
  rows: SectionRow[];
  usedOn: number | null;
  appliedAvailable: boolean;
  onBack: () => void;
  onSave: () => void;
  /** Opens the hub's picker for this kind, against this blueprint. */
  onAddSection: (kind: RowKind) => void;
}) {
  const checklistRows = rows.filter((r) => r.kind === "checklist");
  const workflowRows = rows.filter((r) => r.kind === "workflow");
  const documentRows = rows.filter((r) => r.kind === "document");
  const reportRows = rows.filter((r) => r.kind === "report");

  return (
    <div className="mx-auto w-full max-w-[1000px]">
      {/* Breadcrumb */}
      <div className="mb-3.5 text-[12.5px] text-faint">
        <a className="cursor-pointer text-primary hover:underline" onClick={onBack}>
          Blueprints
        </a>{" "}
        &nbsp;/&nbsp; {blueprint.name}
      </div>

      {/* Title + actions */}
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-3">
        <div className="text-[22px] font-bold tracking-[-0.01em] text-foreground">
          {blueprint.name}
        </div>
        <div className="flex gap-2.5">
          <button
            onClick={onBack}
            className="cursor-pointer rounded-[9px] border border-border px-4 py-2.5 text-[13px] font-semibold text-muted-foreground transition-colors hover:bg-muted/40"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            className="cursor-pointer rounded-[9px] bg-primary px-4 py-2.5 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Save blueprint
          </button>
        </div>
      </div>
      <div className="mb-6 text-[12.5px] text-faint">
        {appliedAvailable && usedOn !== null ? (
          <>
            Used on {usedOn} {usedOn === 1 ? "project" : "projects"} &middot; changes apply
            the next time this blueprint is assigned to a new project.
          </>
        ) : (
          <>Changes apply the next time this blueprint is assigned to a new project.</>
        )}
      </div>

      {/* Checklists */}
      <SectionLabel>Checklists</SectionLabel>
      <div className="mb-3.5 rounded-xl border border-border bg-card px-[18px] py-4">
        {checklistRows.length > 0 ? (
          checklistRows.map((row) => (
            <div
              key={row.name}
              className="flex items-center gap-3 border-b border-border py-[9px] last:border-b-0"
            >
              <span className="shrink-0 text-primary">
                <ChecklistIcon />
              </span>
              <div className="min-w-0 flex-grow text-[13px] font-medium text-foreground">
                {row.name}
              </div>
              <span className="shrink-0 text-[11.5px] text-faint">
                {row.items ?? 0} {row.items === 1 ? "item" : "items"}
              </span>
            </div>
          ))
        ) : (
          <div className="border-b border-border py-[9px] text-[13px] text-faint">
            No checklists attached yet.
          </div>
        )}
        <AddRow onPick={() => onAddSection("checklist")}>
          + Add from checklist library
        </AddRow>
      </div>

      {/* Workflow phases */}
      <SectionLabel>Workflow phases</SectionLabel>
      <div className="mb-3.5 rounded-xl border border-border bg-card px-[18px] py-4">
        {workflowRows.length > 0 ? (
          workflowRows.flatMap((row) =>
            (row.phaseRows ?? []).map((phase) => (
              <div
                key={phase.id}
                className="flex items-center gap-3 border-b border-border py-[9px] last:border-b-0"
              >
                <span className="shrink-0 text-faint">
                  <PhasesIcon />
                </span>
                <div className="min-w-0 flex-grow text-[13px] font-medium text-foreground">
                  {phase.name || "(Untitled phase)"}
                </div>
                <span className="inline-flex shrink-0 items-center gap-1 rounded-[6px] bg-muted px-2 py-[3px] text-[11px] text-muted-foreground">
                  {phase.steps > 0
                    ? `Actionable \u00b7 ${phase.steps} ${phase.steps === 1 ? "step" : "steps"}`
                    : "Marker"}
                </span>
              </div>
            )),
          )
        ) : (
          <div className="border-b border-border py-[9px] text-[13px] text-faint">
            No workflow attached.
          </div>
        )}
        <AddRow onPick={() => onAddSection("workflow")}>
          + Add phase
        </AddRow>
      </div>

      {/* Documents + Report templates */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <SectionLabel>Documents</SectionLabel>
          <div className="rounded-xl border border-border bg-card px-[18px] py-4">
            {documentRows.length > 0 ? (
              documentRows.map((row) => (
                <div key={row.name} className="py-[9px] text-[13px] text-foreground">
                  {row.name}
                </div>
              ))
            ) : (
              <div className="py-[9px] text-[13px] text-faint">No document templates.</div>
            )}
            <AddRow onPick={() => onAddSection("document")}>
              + Add document
            </AddRow>
          </div>
        </div>
        <div>
          <SectionLabel>Report templates</SectionLabel>
          <div className="rounded-xl border border-border bg-card px-[18px] py-4">
            {reportRows.length > 0 ? (
              reportRows.map((row) => (
                <div key={row.name} className="py-[9px] text-[13px] text-foreground">
                  {row.name}
                </div>
              ))
            ) : (
              <div className="py-[9px] text-[13px] text-faint">No report templates.</div>
            )}
            <AddRow onPick={() => onAddSection("report")}>
              + Add report template
            </AddRow>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---- Library page (the mockup's grid), real data ---- */

export function BlueprintLibraryContent({
  onCreate,
  createTick,
  onAddSection,
}: {
  onCreate: () => void;
  /** Bumped by the hub after a blueprint is saved or changed, so the grid re-reads. */
  createTick: number;
  /**
   * "+ Add ..." on an open blueprint. The hub owns the pickers and the writes
   * (it already had them for the older editor); this only says which blueprint
   * and which kind of section.
   */
  onAddSection: (blueprintId: string, kind: RowKind) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<Blueprint[]>([]);
  const [rowsByTemplate, setRowsByTemplate] = useState<Record<string, SectionRow[]>>({});
  const [usedOnByTemplate, setUsedOnByTemplate] = useState<Record<string, number>>({});
  const [appliedAvailable, setAppliedAvailable] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const prevCreateTick = useRef(createTick);
  useEffect(() => {
    if (createTick > prevCreateTick.current) void load();
    prevCreateTick.current = createTick;
  }, [createTick]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoading(true);
    const [
      tplRes,
      chkRes,
      attRes,
      itemsRes,
      wfRes,
      phRes,
      docRes,
      repRes,
      cliRes,
      wfiRes,
      appRes,
    ] = await Promise.all([
      supabase
        .from("project_templates" as any)
        .select(
          "id, team_id, created_by, name, description, labels, archived, created_at, category, default_for_category, version",
        )
        .order("created_at", { ascending: true }),
      supabase.from("checklist_templates" as any).select("id, name, description, archived"),
      supabase
        .from("project_template_checklists" as any)
        .select("id, project_template_id, checklist_template_id, position")
        .order("position", { ascending: true }),
      supabase
        .from("project_template_items" as any)
        .select("id, project_template_id, kind, ref_id, position")
        .order("position", { ascending: true }),
      supabase.from("workflow_templates" as any).select("id, name, archived"),
      supabase
        .from("workflow_template_phases" as any)
        .select("id, template_id, name, position")
        .order("position", { ascending: true }),
      supabase.from("document_templates" as any).select("id, name, archived"),
      supabase.from("report_templates" as any).select("id, name, archived"),
      supabase.from("checklist_template_items" as any).select("id, template_id"),
      supabase.from("workflow_template_items" as any).select("id, phase_id"),
      supabase
        .from("project_blueprint_applications" as any)
        .select("id, blueprint_id, project_id")
        .limit(2000),
    ]);

    // Item / step counts for the row metas ("6 items", "Actionable · 2 steps").
    const itemCount: Record<string, number> = {};
    for (const it of (cliRes.data as any[]) ?? []) {
      if (it.template_id) itemCount[it.template_id] = (itemCount[it.template_id] ?? 0) + 1;
    }
    const stepsPerPhase: Record<string, number> = {};
    for (const it of (wfiRes.data as any[]) ?? []) {
      if (it.phase_id) stepsPerPhase[it.phase_id] = (stepsPerPhase[it.phase_id] ?? 0) + 1;
    }
    const phasesByWorkflow: Record<string, Array<{ id: string; name: string; steps: number }>> =
      {};
    for (const p of (phRes.data as any[]) ?? []) {
      if (!p.template_id) continue;
      (phasesByWorkflow[p.template_id] ??= []).push({
        id: p.id,
        name: p.name ?? "",
        steps: stepsPerPhase[p.id] ?? 0,
      });
    }

    const nameMaps = {
      checklist: new Map(((chkRes.data as any[]) ?? []).map((c: any) => [c.id, c.name])),
      workflow: new Map(((wfRes.data as any[]) ?? []).map((w: any) => [w.id, w.name])),
      document: new Map(((docRes.data as any[]) ?? []).map((d: any) => [d.id, d.name])),
      report: new Map(((repRes.data as any[]) ?? []).map((r: any) => [r.id, r.name])),
    };

    // Legacy links first, then project_template_items, the same apply order the
    // API processes them in.
    const grouped: Record<string, SectionRow[]> = {};
    for (const a of (attRes.data as any[]) ?? []) {
      const name = nameMaps.checklist.get(a.checklist_template_id) ?? null;
      (grouped[a.project_template_id] ??= []).push({
        kind: "checklist",
        name: name ?? "Deleted checklist template",
        items: itemCount[a.checklist_template_id] ?? 0,
      });
    }
    for (const it of (itemsRes.data as any[]) ?? []) {
      const kind = it.kind as RowKind;
      if (kind !== "checklist" && kind !== "workflow" && kind !== "document" && kind !== "report")
        continue;
      const name = nameMaps[kind].get(it.ref_id) ?? null;
      const row: SectionRow = {
        kind,
        name: name ?? `Deleted ${kind} template`,
      };
      if (kind === "checklist") row.items = itemCount[it.ref_id] ?? 0;
      if (kind === "workflow") row.phaseRows = phasesByWorkflow[it.ref_id] ?? [];
      (grouped[it.project_template_id] ??= []).push(row);
    }

    const usedOn: Record<string, number> = {};
    for (const a of (appRes.data as any[]) ?? []) {
      if (a.blueprint_id) usedOn[a.blueprint_id] = (usedOn[a.blueprint_id] ?? 0) + 1;
    }

    setTemplates(((tplRes.data as any[]) ?? []) as Blueprint[]);
    setRowsByTemplate(grouped);
    setUsedOnByTemplate(usedOn);
    setAppliedAvailable(!appRes.error);
    setLoading(false);
  }

  const visible = templates.filter((t) => !t.archived);
  const selected = templates.find((t) => t.id === selectedId) ?? null;

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pb-10 sm:px-10">
      {loading && visible.length === 0 ? (
        <div className="py-16 text-center text-[13px] text-faint">Loading blueprints&hellip;</div>
      ) : selected ? (
        <BlueprintEditor
          blueprint={selected}
          rows={rowsByTemplate[selected.id] ?? []}
          usedOn={usedOnByTemplate[selected.id] ?? null}
          appliedAvailable={appliedAvailable}
          onBack={() => setSelectedId(null)}
          onAddSection={(kind) => onAddSection(selected.id, kind)}
          onSave={() => {
            toast.success("Blueprint saved");
            setSelectedId(null);
          }}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((b) => {
            const rows = rowsByTemplate[b.id] ?? [];
            const checklists = rows.filter((r) => r.kind === "checklist").length;
            const workflows = rows.filter((r) => r.kind === "workflow").length;
            const workflowPhases = rows
              .filter((r) => r.kind === "workflow")
              .reduce((n, r) => n + (r.phaseRows ?? []).length, 0);
            const reports = rows.filter((r) => r.kind === "report").length;
            const chips: string[] = [];
            if (checklists > 0)
              chips.push(`${checklists} ${checklists === 1 ? "checklist" : "checklists"}`);
            if (workflows > 0)
              chips.push(
                `${workflows} ${workflows === 1 ? "workflow" : "workflows"} \u00b7 ${workflowPhases} ${
                  workflowPhases === 1 ? "phase" : "phases"
                }`,
              );
            if (reports > 0)
              chips.push(
                `${reports} ${reports === 1 ? "report template" : "report templates"}`,
              );
            return (
              <div
                key={b.id}
                onClick={() => setSelectedId(b.id)}
                className="flex cursor-pointer flex-col gap-3.5 rounded-[13px] border border-border bg-card p-5 transition-colors hover:border-primary"
              >
                <div className="flex items-center gap-2.5">
                  <span className="shrink-0 text-primary">
                    <BoxIcon />
                  </span>
                  <div className="text-[14.5px] font-semibold text-foreground">{b.name}</div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {chips.map((c) => (
                    <span
                      key={c}
                      className="inline-flex items-center gap-1 rounded-[6px] bg-muted px-2 py-[3px] text-[11px] text-muted-foreground"
                    >
                      {c}
                    </span>
                  ))}
                </div>
                <div className="border-t border-border pt-3 text-xs text-faint">
                  {appliedAvailable ? (
                    <>
                      Used on <span className="font-mono">{usedOnByTemplate[b.id] ?? 0}</span>{" "}
                      {usedOnByTemplate[b.id] === 1 ? "project" : "projects"}
                    </>
                  ) : (
                    <>Project usage unavailable</>
                  )}
                </div>
              </div>
            );
          })}

          {/* Dashed "Build a new blueprint" card */}
          <div
            onClick={onCreate}
            className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[13px] border border-dashed border-border p-5 text-faint transition-colors hover:border-primary"
          >
            <PlusIcon size={22} />
            <div className="text-[13px] font-medium">Build a new blueprint</div>
          </div>
        </div>
      )}
    </div>
  );
}
