import { REPORT_STARTERS } from "@everlumen/shared";
import { supabase } from "@/lib/supabase";
import type { BlueprintItemKind } from "./blueprints-view";
import {
  CHECKLIST_STARTER_PIECES,
  WALKTHROUGH_STARTER_PIECES,
  WORKFLOW_STARTER_PIECES,
  type BlueprintStarter,
  type BlueprintStarterPiece,
} from "./blueprint-starters";
import {
  saveErrorMessage,
  type ApplyTarget,
  type BlueprintRow,
  type InstallResult,
  type Libraries,
  type SectionLink,
  type SectionRow,
} from "./blueprint-library-view";

/**
 * Authoring blueprints: the library the web keeps under Templates > Blueprints.
 *
 * Direct RLS reads and writes on the same tables, with the same statements, as
 * `apps/web/src/features/settings/pages/TemplatesPage.tsx`. Nothing here needs
 * the service role; applying a blueprint does, and that stays the
 * `applyProjectBlueprint` op in `blueprints.ts`.
 *
 * Not queued through the outbox: this is office work done once and
 * deliberately, and a section that silently lands later is worse than a write
 * that fails and says so.
 */

// The template tables are not all in the generated types, and the web reads
// them the same way (`as any`).
const db = (table: string): any => supabase.from(table as never);

function fail(error: { message?: string } | null | undefined, fallback: string): never {
  throw new Error(error?.message || fallback);
}

export async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  const id = data.user?.id;
  if (!id) throw new Error("Not signed in");
  return id;
}

export type BlueprintLibrary = {
  blueprints: BlueprintRow[];
  links: SectionLink[];
  libraries: Libraries;
};

const FULL = "id, name, description, labels, archived, created_at, category, default_for_category";
const LEGACY = "id, name, description, labels, archived, created_at";

/**
 * Everything the library needs, in one round of parallel reads: the web's
 * `load()`, minus the counts it draws on cards the phone does not have.
 */
export async function loadBlueprintLibrary(): Promise<BlueprintLibrary> {
  const [tplRes, attRes, itemsRes, chkRes, docRes, repRes, lsRes, wfRes, wtRes] = await Promise.all(
    [
      db("project_templates").select(FULL).order("created_at", { ascending: true }),
      db("project_template_checklists")
        .select("id, project_template_id, checklist_template_id, position")
        .order("position", { ascending: true }),
      db("project_template_items")
        .select("id, project_template_id, kind, ref_id, position")
        .order("position", { ascending: true }),
      db("checklist_templates").select("id, name").order("name"),
      // `body->>copiedFrom`, not `body`: the bodies are tens of kilobytes of
      // HTML each, and this only needs to know which built-ins are shadowed.
      db("document_templates")
        .select("id, name, copiedFrom:body->>copiedFrom")
        .eq("archived", false)
        .order("name"),
      db("report_templates").select("id, name").eq("archived", false).order("name"),
      db("label_sets").select("id, name").eq("archived", false).order("name"),
      db("workflow_templates").select("id, name").eq("archived", false).order("name"),
      db("walkthrough_templates").select("id, name").eq("archived", false).order("name"),
    ],
  );

  /*
   * The blueprint read can fail over a pending migration (20260908000000 adds
   * `category` and `default_for_category`), and PostgREST rejects the whole
   * select over one unknown column. Fall back rather than show an empty library.
   */
  let tplRows = (tplRes.data as any[]) ?? [];
  if (tplRes.error) {
    const legacy = await db("project_templates")
      .select(LEGACY)
      .order("created_at", { ascending: true });
    if (legacy.error) fail(legacy.error, "Could not load blueprints");
    tplRows = (legacy.data as any[]) ?? [];
  }
  if (attRes.error) fail(attRes.error, "Could not load blueprint sections");
  if (itemsRes.error) fail(itemsRes.error, "Could not load blueprint sections");

  const blueprints: BlueprintRow[] = tplRows.map((t) => ({
    id: String(t.id),
    name: String(t.name ?? "Untitled blueprint"),
    description: (t.description as string | null) ?? null,
    labels: Array.isArray(t.labels) ? (t.labels as string[]) : [],
    archived: Boolean(t.archived),
    category: (t.category as string | null) ?? null,
    isDefault: Boolean(t.default_for_category),
    createdAt: String(t.created_at ?? ""),
  }));

  const links: SectionLink[] = [
    ...((attRes.data as any[]) ?? []).map((a) => ({
      id: String(a.id),
      blueprintId: String(a.project_template_id),
      kind: "checklist" as BlueprintItemKind,
      refId: String(a.checklist_template_id),
      position: Number(a.position ?? 0),
      legacy: true,
    })),
    ...((itemsRes.data as any[]) ?? []).map((i) => ({
      id: String(i.id),
      blueprintId: String(i.project_template_id),
      kind: i.kind as BlueprintItemKind,
      refId: String(i.ref_id),
      position: Number(i.position ?? 0),
      legacy: false,
    })),
  ];

  const names = (res: { data: unknown }) =>
    ((res.data as any[]) ?? []).map((x) => ({ id: String(x.id), name: String(x.name ?? "") }));

  // A built-in the team has its own version of is dropped in favour of that
  // version, the rule every document list applies.
  const docRows = (docRes.data as any[]) ?? [];
  const shadowed = new Set(docRows.map((x) => x.copiedFrom).filter(Boolean));

  return {
    blueprints,
    links,
    libraries: {
      checklist: names(chkRes),
      document: docRows
        .filter((x) => !shadowed.has(x.id))
        .map((x) => ({ id: String(x.id), name: String(x.name ?? "") })),
      report: names(repRes),
      label_set: names(lsRes),
      workflow: names(wfRes),
      // Absent on a database still waiting for its migration: the read errors
      // and the list is simply empty.
      walkthrough: names(wtRes),
    },
  };
}

export async function createBlueprint(args: {
  name: string;
  description: string | null;
  category: string | null;
  labels: string[];
  teamId: string | null;
}): Promise<string> {
  const userId = await currentUserId();
  const { data, error } = await db("project_templates")
    .insert({
      created_by: userId,
      team_id: args.teamId,
      name: args.name,
      description: args.description,
      labels: args.labels,
      category: args.category,
    })
    .select("id")
    .single();
  if (error || !data) fail(error, "Could not create that blueprint");
  return String(data.id);
}

export async function updateBlueprint(
  id: string,
  patch: {
    name?: string;
    description?: string | null;
    category?: string | null;
    isDefault?: boolean;
    labels?: string[];
  },
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.labels !== undefined) row.labels = patch.labels;
  if (patch.category !== undefined) {
    row.category = patch.category;
    // A blueprint with no trade cannot be the default FOR a trade, so the flag
    // is forced off rather than left dangling when the trade is cleared.
    row.default_for_category = patch.category ? Boolean(patch.isDefault) : false;
  }
  const { error } = await db("project_templates").update(row).eq("id", id);
  if (error) throw new Error(saveErrorMessage(error.code, error.message, patch.category ?? null));
}

export async function setBlueprintArchived(id: string, archived: boolean): Promise<void> {
  const { error } = await db("project_templates").update({ archived }).eq("id", id);
  if (error) fail(error, "Could not archive that blueprint");
}

export async function deleteBlueprint(id: string): Promise<void> {
  const { error } = await db("project_templates").delete().eq("id", id);
  if (error) fail(error, "Could not delete that blueprint");
}

/**
 * Duplicate a blueprint with every section, legacy links included. Copying
 * only the legacy checklist links once dropped every document, report and
 * workflow, so both tables are copied and either failure is reported.
 */
export async function duplicateBlueprint(
  source: BlueprintRow,
  links: readonly SectionLink[],
  teamId: string | null,
): Promise<string> {
  const userId = await currentUserId();
  const { data, error } = await db("project_templates")
    .insert({
      created_by: userId,
      team_id: teamId,
      name: `${source.name} (copy)`,
      description: source.description,
      labels: source.labels,
      category: source.category,
      // Never copied: two defaults for one trade would be rejected by the
      // partial unique index, so the copy could not be created at all.
      default_for_category: false,
    })
    .select("id")
    .single();
  if (error || !data) fail(error, "Could not duplicate that blueprint");
  const newId = String(data.id);

  const mine = links.filter((l) => l.blueprintId === source.id);
  const legacy = mine.filter((l) => l.legacy);
  if (legacy.length) {
    const res = await db("project_template_checklists").insert(
      legacy.map((l) => ({
        project_template_id: newId,
        checklist_template_id: l.refId,
        position: l.position,
      })),
    );
    if (res.error) fail(res.error, "Could not copy this blueprint's checklists");
  }
  const items = mine.filter((l) => !l.legacy);
  if (items.length) {
    const res = await db("project_template_items").insert(
      items.map((i) => ({
        project_template_id: newId,
        kind: i.kind,
        ref_id: i.refId,
        position: i.position,
      })),
    );
    if (res.error) fail(res.error, "Could not copy this blueprint's sections");
  }
  return newId;
}

/** New sections always go into the generic table; the legacy one is read-only. */
export async function addSection(args: {
  blueprintId: string;
  kind: BlueprintItemKind;
  refId: string;
  position: number;
}): Promise<void> {
  const { error } = await db("project_template_items").insert({
    project_template_id: args.blueprintId,
    kind: args.kind,
    ref_id: args.refId,
    position: args.position,
  });
  if (error) fail(error, "Could not add that section");
}

export async function removeSection(row: Pick<SectionLink, "id" | "legacy">): Promise<void> {
  const table = row.legacy ? "project_template_checklists" : "project_template_items";
  const { error } = await db(table).delete().eq("id", row.id);
  if (error) fail(error, "Could not remove that section");
}

/**
 * Write a new section order: the web's `persistOrder`.
 *
 * The apply service always runs legacy checklist links first, so an order that
 * interleaves them cannot be expressed while they exist. Reordering therefore
 * migrates them into the generic table first (skipping any already there),
 * deletes the legacy rows, re-reads the real ids, and writes the absolute
 * order. Every step's error is thrown, because a silent failure after the
 * delete would leave the blueprint converted but in the old order.
 */
export async function saveSectionOrder(
  blueprintId: string,
  next: readonly SectionRow[],
): Promise<void> {
  const legacyRows = next.filter((r) => r.legacy);
  if (!legacyRows.length) {
    for (const [idx, row] of next.entries()) {
      if (row.position === idx) continue;
      const { error } = await db("project_template_items")
        .update({ position: idx })
        .eq("id", row.id);
      if (error) fail(error, "Could not reorder sections");
    }
    return;
  }

  const existingRefs = new Set(
    next.filter((r) => !r.legacy && r.kind === "checklist").map((r) => r.refId),
  );
  const toInsert = legacyRows.filter((r) => !existingRefs.has(r.refId));
  if (toInsert.length) {
    const { error } = await db("project_template_items").insert(
      toInsert.map((r) => ({
        project_template_id: blueprintId,
        kind: "checklist",
        ref_id: r.refId,
        position: next.indexOf(r),
      })),
    );
    if (error) fail(error, "Could not reorder sections");
  }
  const del = await db("project_template_checklists")
    .delete()
    .in(
      "id",
      legacyRows.map((r) => r.id),
    );
  if (del.error) fail(del.error, "Could not reorder sections");

  const { data, error } = await db("project_template_items")
    .select("id, kind, ref_id")
    .eq("project_template_id", blueprintId);
  if (error) fail(error, "Could not reorder sections");
  const idByRef = new Map(
    ((data as any[]) ?? []).map((r) => [`${r.kind}:${r.ref_id}`, String(r.id)]),
  );
  for (const [idx, row] of next.entries()) {
    const id = idByRef.get(`${row.kind}:${row.refId}`);
    if (!id) continue;
    const res = await db("project_template_items").update({ position: idx }).eq("id", id);
    if (res.error) fail(res.error, "Could not reorder sections");
  }
}

/* ------------------------------------------------------------------ apply */

/** Open projects to apply to, newest activity first: the web dialog's read. */
export async function listApplyTargets(): Promise<ApplyTarget[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("id, name, street, city, archived")
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return ((data as any[]) ?? [])
    .filter((p) => !p.archived)
    .map((p) => ({
      id: String(p.id),
      name: String(p.name ?? "Untitled project"),
      street: (p.street as string | null) ?? null,
      city: (p.city as string | null) ?? null,
    }));
}

/* --------------------------------------------------------------- starters */

const normalise = (name: string) => name.trim().toLowerCase();

async function findExisting(table: string, name: string): Promise<string | null> {
  const { data } = await db(table).select("id, name");
  const hit = ((data as any[]) ?? []).find(
    (r) => normalise(String(r.name ?? "")) === normalise(name),
  );
  return hit ? String(hit.id) : null;
}

async function resolveChecklist(name: string, userId: string): Promise<string | null> {
  const existing = await findExisting("checklist_templates", name);
  if (existing) return existing;
  const starter = CHECKLIST_STARTER_PIECES.find((s) => normalise(s.name) === normalise(name));
  if (!starter) return null;
  const { data, error } = await db("checklist_templates")
    .insert({
      created_by: userId,
      name: starter.name,
      description: starter.description,
      category: starter.category ?? null,
    })
    .select("id")
    .single();
  if (error || !data) return null;
  const id = String(data.id);
  const items = await db("checklist_template_items").insert(
    starter.items.map((it, idx) => ({
      template_id: id,
      position: idx,
      label: it.label,
      required: !!it.required,
      item_type: it.item_type,
      description: it.description ?? null,
    })),
  );
  // A checklist with no items looks finished everywhere and produces nothing.
  if (items.error) {
    await db("checklist_templates").delete().eq("id", id);
    return null;
  }
  return id;
}

async function resolveWalkthrough(name: string, userId: string): Promise<string | null> {
  const existing = await findExisting("walkthrough_templates", name);
  if (existing) return existing;
  const starter = WALKTHROUGH_STARTER_PIECES.find((s) => normalise(s.name) === normalise(name));
  if (!starter) return null;
  const { data, error } = await db("walkthrough_templates")
    .insert({
      created_by: userId,
      name: starter.name,
      description: starter.description,
      category: starter.category ?? null,
    })
    .select("id")
    .single();
  if (error || !data) return null;
  const id = String(data.id);
  const shots = await db("walkthrough_template_shots").insert(
    starter.shots.map((s, idx) => ({
      template_id: id,
      position: idx,
      label: s.label,
      description: s.description ?? null,
      capture: s.capture,
      required: !!s.required,
    })),
  );
  if (shots.error) {
    await db("walkthrough_templates").delete().eq("id", id);
    return null;
  }
  return id;
}

async function resolveWorkflow(name: string, userId: string): Promise<string | null> {
  const existing = await findExisting("workflow_templates", name);
  if (existing) return existing;
  const starter = WORKFLOW_STARTER_PIECES.find((s) => normalise(s.name) === normalise(name));
  if (!starter) return null;
  const { data, error } = await db("workflow_templates")
    .insert({
      created_by: userId,
      name: starter.name,
      description: starter.description,
      category: starter.category ?? null,
    })
    .select("id")
    .single();
  if (error || !data) return null;
  const id = String(data.id);
  // One phase at a time: each item insert needs the id its phase insert returns.
  for (const [idx, phase] of starter.phases.entries()) {
    const created = await db("workflow_template_phases")
      .insert({
        template_id: id,
        position: idx,
        name: phase.name,
        description: phase.description ?? null,
        requires_signoff: !!phase.requires_signoff,
      })
      .select("id")
      .single();
    if (created.error || !created.data) {
      await db("workflow_templates").delete().eq("id", id);
      return null;
    }
    if (phase.items.length) {
      const items = await db("workflow_template_items").insert(
        phase.items.map((it, i) => ({
          phase_id: created.data.id,
          position: i,
          kind: it.kind,
          label: it.label,
          required: !!it.required,
        })),
      );
      if (items.error) {
        await db("workflow_templates").delete().eq("id", id);
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
  // Today's `report_templates.sections` shape, matching what the editor writes.
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
  const { data, error } = await db("report_templates")
    .insert({
      created_by: userId,
      team_id: teamId,
      name: starter.name,
      subtitle: null,
      sections: structure,
    })
    .select("id")
    .single();
  if (error || !data) return null;
  return String(data.id);
}

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
      // Documents ship as seeded built-ins, so the piece is found, never built.
      return findExisting("document_templates", piece.name);
    case "label_set":
      return findExisting("label_sets", piece.name);
  }
}

const LIBRARY_TABLE: Record<BlueprintItemKind, string> = {
  checklist: "checklist_templates",
  walkthrough: "walkthrough_templates",
  workflow: "workflow_templates",
  report: "report_templates",
  document: "document_templates",
  label_set: "label_sets",
};

/** Row count for one library, used only to tell "found" from "built". */
async function countLibrary(kind: BlueprintItemKind): Promise<number> {
  const { count } = await db(LIBRARY_TABLE[kind]).select("id", { count: "exact", head: true });
  return count ?? 0;
}

/**
 * Install a pre-built blueprint, finding or building each piece first: the web's
 * `installBlueprintStarter`, step for step. Sequential, so two pieces naming
 * the same component cannot both miss the existence check and build it twice.
 */
export async function installBlueprintStarter(
  starter: BlueprintStarter,
  teamId: string | null,
): Promise<InstallResult> {
  const userId = await currentUserId();
  const { data, error } = await db("project_templates")
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
  if (error || !data) fail(error, "Could not create that blueprint");
  const blueprintId = String(data.id);
  const result: InstallResult = { blueprintId, attached: 0, skipped: [], created: [] };

  for (const [idx, piece] of starter.pieces.entries()) {
    const before = await countLibrary(piece.kind);
    const refId = await resolvePiece(piece, userId, teamId);
    if (!refId) {
      result.skipped.push({
        kind: piece.kind,
        name: piece.name,
        reason:
          piece.kind === "document"
            ? "This workspace's built-in document library does not have it."
            : "Could not find or build it.",
      });
      continue;
    }
    const after = await countLibrary(piece.kind);
    if (after > before) result.created.push({ kind: piece.kind, name: piece.name });
    const link = await db("project_template_items").insert({
      project_template_id: blueprintId,
      kind: piece.kind,
      ref_id: refId,
      position: idx,
    });
    if (link.error) {
      result.skipped.push({ kind: piece.kind, name: piece.name, reason: link.error.message });
      continue;
    }
    result.attached++;
  }
  return result;
}
