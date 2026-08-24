import { supabase } from "@/integrations/everlumen/client";
import { REPORT_STARTERS } from "@everlumen/shared";
import { STARTER_TEMPLATES } from "./checklist-starters";
import { STARTER_WORKFLOWS } from "./workflow-starters";
import { WALKTHROUGH_STARTERS } from "./walkthrough-starters";
import type { BlueprintItemKind } from "./blueprint-outcomes";
import type { BlueprintStarter, BlueprintStarterPiece } from "./blueprint-starters";

/**
 * Installs a pre-built blueprint, building any pieces the user does not have.
 *
 * The spec asks for "2-3 pre-built Blueprints by trade ... so companies see the
 * pattern before building their own, rather than starting from a blank screen".
 * A blueprint is a bundle of REFERENCES, though, so shipping one means shipping
 * the things it points at, and those live in per-user tables with no ownerless
 * built-ins. Resolution therefore runs in three steps per piece:
 *
 *   1. Does the user already have a component of this kind with this name? Use
 *      it. A company that has customised "Plumbing Service Call" gets THEIR
 *      version bundled, not a fresh copy of ours sitting next to it.
 *   2. Is there a library starter by that name? Create it from the starter,
 *      then use it. This is the same code path the component tab's own
 *      "Starters" button runs, so the piece is identical either way.
 *   3. Neither. Skip the piece and report it, so the installer can say the
 *      blueprint arrived with four sections rather than five instead of
 *      quietly shipping a shorter bundle.
 *
 * The layering is deliberate and is the point of the whole exercise: this
 * function never writes component CONTENT into a blueprint. It creates
 * components in their own libraries, then writes reference rows. Blueprints
 * stay a bundle of pointers, exactly as the spec asks.
 */

export interface InstallResult {
  blueprintId: string;
  /** Pieces attached, in the order they were requested. */
  attached: number;
  /** Pieces that could not be resolved to a component, with the reason. */
  skipped: Array<{ kind: BlueprintItemKind; name: string; reason: string }>;
  /** Components this install had to create, for the "we also built" line. */
  created: Array<{ kind: BlueprintItemKind; name: string }>;
}

/** Case- and whitespace-insensitive, so a renamed copy still matches. */
function normalise(name: string): string {
  return name.trim().toLowerCase();
}

async function findExisting(
  table: string,
  name: string,
  extraColumns = "id, name",
): Promise<string | null> {
  const { data } = await supabase.from(table as any).select(extraColumns);
  const rows = ((data as any[]) ?? []) as Array<{ id: string; name: string }>;
  const hit = rows.find((r) => normalise(r.name) === normalise(name));
  return hit?.id ?? null;
}

/* -------------------------------------------------------------------------- */
/*  Per-kind resolvers                                                        */
/* -------------------------------------------------------------------------- */

async function resolveChecklist(name: string, userId: string): Promise<string | null> {
  const existing = await findExisting("checklist_templates", name);
  if (existing) return existing;

  const starter = STARTER_TEMPLATES.find((s) => normalise(s.name) === normalise(name));
  if (!starter) return null;

  const { data, error } = await supabase
    .from("checklist_templates" as any)
    .insert({
      created_by: userId,
      name: starter.name,
      description: starter.description,
      category: starter.category ?? null,
    })
    .select("id")
    .single();
  if (error || !data) return null;
  const id = (data as any).id as string;

  const { error: itemsErr } = await supabase.from("checklist_template_items" as any).insert(
    starter.items.map((it, idx) => ({
      template_id: id,
      position: idx,
      label: it.label,
      required: !!it.required,
      item_type: it.item_type,
      description: it.description ?? null,
    })),
  );
  // A checklist that exists but has no items is worse than one that was never
  // created: it looks finished in every list and produces nothing on apply.
  if (itemsErr) {
    await supabase
      .from("checklist_templates" as any)
      .delete()
      .eq("id", id);
    return null;
  }
  return id;
}

async function resolveWalkthrough(name: string, userId: string): Promise<string | null> {
  const existing = await findExisting("walkthrough_templates", name);
  if (existing) return existing;

  const starter = WALKTHROUGH_STARTERS.find((s) => normalise(s.name) === normalise(name));
  if (!starter) return null;

  const { data, error } = await supabase
    .from("walkthrough_templates" as any)
    .insert({
      created_by: userId,
      name: starter.name,
      description: starter.description,
      category: starter.category ?? null,
    })
    .select("id")
    .single();
  if (error || !data) return null;
  const id = (data as any).id as string;

  const { error: shotsErr } = await supabase.from("walkthrough_template_shots" as any).insert(
    starter.shots.map((s, idx) => ({
      template_id: id,
      position: idx,
      label: s.label,
      description: s.description ?? null,
      capture: s.capture,
      required: !!s.required,
    })),
  );
  if (shotsErr) {
    await supabase
      .from("walkthrough_templates" as any)
      .delete()
      .eq("id", id);
    return null;
  }
  return id;
}

async function resolveWorkflow(name: string, userId: string): Promise<string | null> {
  const existing = await findExisting("workflow_templates", name);
  if (existing) return existing;

  const starter = STARTER_WORKFLOWS.find((s) => normalise(s.name) === normalise(name));
  if (!starter) return null;

  const { data, error } = await supabase
    .from("workflow_templates" as any)
    .insert({
      created_by: userId,
      name: starter.name,
      description: starter.description,
      category: starter.category ?? null,
    })
    .select("id")
    .single();
  if (error || !data) return null;
  const id = (data as any).id as string;

  // Phases and their items, one phase at a time: `workflow_template_items.phase_id`
  // needs the id the phase insert returns, so these cannot be one batch.
  for (const [idx, phase] of starter.phases.entries()) {
    const { data: created, error: phaseErr } = await supabase
      .from("workflow_template_phases" as any)
      .insert({
        template_id: id,
        position: idx,
        name: phase.name,
        description: phase.description ?? null,
        requires_signoff: !!phase.requires_signoff,
      })
      .select("id")
      .single();
    if (phaseErr || !created) {
      await supabase
        .from("workflow_templates" as any)
        .delete()
        .eq("id", id);
      return null;
    }
    if (phase.items.length) {
      const { error: itemsErr } = await supabase.from("workflow_template_items" as any).insert(
        phase.items.map((it, i) => ({
          phase_id: (created as any).id,
          position: i,
          kind: it.kind,
          label: it.label,
          required: !!it.required,
        })),
      );
      if (itemsErr) {
        await supabase
          .from("workflow_templates" as any)
          .delete()
          .eq("id", id);
        return null;
      }
    }
  }
  return id;
}

async function resolveReport(
  name: string,
  userId: string,
  teamId: string | null,
): Promise<string | null> {
  const existing = await findExisting("report_templates", name);
  if (existing) return existing;

  const starter = REPORT_STARTERS.find((s) => normalise(s.name) === normalise(name));
  if (!starter) return null;

  // The current `report_templates.sections` shape, matching what the editor
  // writes. `parseReportTemplateStructure` reads both this and the legacy array,
  // but a row written today should be written in today's shape.
  const structure = {
    coverStyle: starter.cover.enabled ? "centered" : "minimal",
    placeholders: [] as string[],
    items: starter.sections.map((heading, idx) => ({
      id: `starter-${starter.id}-${idx}`,
      heading,
      body: "",
      layout: "text-photos",
    })),
  };

  const { data, error } = await supabase
    .from("report_templates" as any)
    .insert({
      created_by: userId,
      team_id: teamId,
      name: starter.name,
      subtitle: null,
      sections: structure as any,
    })
    .select("id")
    .single();
  if (error || !data) return null;
  return (data as any).id as string;
}

/**
 * Documents are the one kind with no create-from-starter path, and correctly so.
 *
 * `document_templates` is seeded with an ownerless built-in library
 * (20260820000000 and the trade seeds after it), so the row a starter names
 * already exists on every database and simply has to be found. If it is not
 * there, this environment is missing a seed migration - which is a real thing to
 * report, not something to paper over by inventing an empty document.
 */
async function resolveDocument(name: string): Promise<string | null> {
  return findExisting("document_templates", name);
}

/* -------------------------------------------------------------------------- */
/*  The installer                                                             */
/* -------------------------------------------------------------------------- */

async function resolvePiece(
  piece: BlueprintStarterPiece,
  userId: string,
  teamId: string | null,
): Promise<string | null> {
  switch (piece.kind) {
    case "checklist":
      return resolveChecklist(piece.name, userId);
    case "walkthrough":
      return resolveWalkthrough(piece.name, userId);
    case "workflow":
      return resolveWorkflow(piece.name, userId);
    case "report":
      return resolveReport(piece.name, userId, teamId);
    case "document":
      return resolveDocument(piece.name);
    case "label_set":
      // No starter blueprint asks for one: a starter's labels ride on the
      // blueprint's own `labels` column, which applies them without needing a
      // saved set. Kept as an explicit branch so the switch stays exhaustive.
      return findExisting("label_sets", piece.name);
  }
}

export async function installBlueprintStarter(
  starter: BlueprintStarter,
  userId: string,
  teamId: string | null,
): Promise<InstallResult | { error: string }> {
  const { data, error } = await supabase
    .from("project_templates" as any)
    .insert({
      created_by: userId,
      team_id: teamId,
      name: starter.name,
      description: starter.description,
      labels: starter.labels,
      category: starter.category,
    })
    .select("id")
    .single();
  if (error || !data) {
    return { error: error?.message ?? "Couldn't create that blueprint" };
  }
  const blueprintId = (data as any).id as string;

  const result: InstallResult = { blueprintId, attached: 0, skipped: [], created: [] };

  /*
   * Sequential, not `Promise.all`. Each piece may CREATE a component, and two
   * pieces naming the same one - which the starters above do not do today, but
   * a fourth starter easily could - would otherwise both miss the existence
   * check and create it twice.
   *
   * `position` is the loop index rather than `result.attached`, so a skipped
   * piece leaves a gap rather than silently reshuffling the order the author
   * sees against the order written here.
   */
  for (const [idx, piece] of starter.pieces.entries()) {
    const before = await countLibrary(piece.kind);
    const refId = await resolvePiece(piece, userId, teamId);
    if (!refId) {
      result.skipped.push({
        kind: piece.kind,
        name: piece.name,
        reason:
          piece.kind === "document"
            ? "This workspace's built-in document library doesn't have it."
            : "Couldn't find or build it.",
      });
      continue;
    }
    const after = await countLibrary(piece.kind);
    if (after > before) result.created.push({ kind: piece.kind, name: piece.name });

    const { error: linkErr } = await supabase.from("project_template_items" as any).insert({
      project_template_id: blueprintId,
      kind: piece.kind,
      ref_id: refId,
      position: idx,
    });
    if (linkErr) {
      result.skipped.push({ kind: piece.kind, name: piece.name, reason: linkErr.message });
      continue;
    }
    result.attached++;
  }

  return result;
}

/**
 * Row count for one library, used only to tell "found" from "built".
 *
 * A `head: true` count rather than a select: the answer is one integer and the
 * document library alone is tens of kilobytes of HTML per row.
 */
async function countLibrary(kind: BlueprintItemKind): Promise<number> {
  const TABLE: Record<BlueprintItemKind, string> = {
    checklist: "checklist_templates",
    walkthrough: "walkthrough_templates",
    workflow: "workflow_templates",
    report: "report_templates",
    document: "document_templates",
    label_set: "label_sets",
  };
  const { count } = await supabase
    .from(TABLE[kind] as any)
    .select("id", { count: "exact", head: true });
  return count ?? 0;
}
