import { z } from "zod";
import { formatChecklistAnswer, photoObjectPaths } from "@sitepix/shared";
import { getSupabaseAdmin } from "../../lib/supabase";
import { sanitizePageHtml } from "./sanitize-page-html";

/**
 * Public share for the two field records - checklists and workflows.
 *
 * Both already held the full account of what was done on a job: what was
 * checked, what was measured, which photos prove it, who signed the phase off.
 * Neither had any way out of the app, so the only way to hand a customer or an
 * inspector the record was a screenshot of a modal.
 *
 * These two services are the read side of that link. Deliberately shaped as one
 * payload for both kinds - a checklist is a workflow with a single unnamed
 * section - so the browser has exactly one document renderer to maintain and a
 * printed checklist and a printed workflow come out looking like the same
 * company produced them.
 *
 * Every guard here mirrors `getPublicProjectPageService`, for the same reasons:
 *   - the token is the only credential, so nothing is trusted from the caller
 *   - `revoked_at` is the owner's off switch
 *   - a trashed project takes its shared records down with it, because
 *     `project_checklists` has no `deleted_at` of its own and dies only with
 *     the project's eventual purge - which nothing schedules
 *   - author HTML is sanitised on the way out, not on the way in, so every row
 *     already in the database is covered
 */

const SIGNED_URL_TTL_SECONDS = 60 * 60;

export interface PublicFieldRecordItem {
  id: string;
  /**
   * Plain text, passed through untouched.
   *
   * Deliberately NOT run through `sanitizeCaption` - despite the name, that
   * helper only strips tags to *decide* whether a caption is filename-like and
   * then returns the original input verbatim (see the assertions in
   * tests/shared-helpers.test.ts). Calling it here was a no-op that read like a
   * defence. What actually makes this safe is that `RecordDocument` renders the
   * label as a React text child, so React escapes it; `notesHtml` is the only
   * field on this payload that reaches the DOM as markup, and that one is
   * sanitised.
   */
  label: string;
  description: string | null;
  /** `item_type` for a checklist, `kind` for a workflow. */
  type: string;
  required: boolean;
  /** Whether this line counts as answered - the tick in the printed box. */
  answered: boolean;
  /** The answer as printable text; null when the tick alone is the answer. */
  answer: string | null;
  notes: string | null;
  completedAt: string | null;
  photoUrls: string[];
}

export interface PublicFieldRecordSection {
  id: string;
  /** null for a checklist - it has one implicit, unnamed section. */
  name: string | null;
  description: string | null;
  notes: string | null;
  /**
   * Whether this phase was *designed* to be signed. Carried separately from
   * `signoff` so the printed sheet can draw a signature rule on an unsigned
   * gate - and, just as importantly, draw nothing under a phase that never
   * asked for one. Inferring it from `signoff === null` would put a signature
   * line under every ordinary phase.
   */
  requiresSignoff: boolean;
  signoff: { name: string | null; at: string } | null;
  items: PublicFieldRecordItem[];
}

export interface PublicFieldRecord {
  status: "ok" | "not_found" | "revoked";
  record: {
    kind: "checklist" | "workflow";
    title: string;
    description: string | null;
    createdAt: string;
    completedAt: string | null;
    /** The rich-text write-up that turns a tick list into a document. */
    notesHtml: string | null;
    sections: PublicFieldRecordSection[];
    done: number;
    total: number;
  } | null;
  project: {
    name: string;
    street: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
  } | null;
  company: {
    name: string | null;
    logo_url: string | null;
    phone: string | null;
    address: string | null;
  } | null;
  author: { name: string | null } | null;
}

export const publicFieldRecordInputSchema = z.object({ token: z.string().uuid() });

const empty = (status: PublicFieldRecord["status"]): PublicFieldRecord => ({
  status,
  record: null,
  project: null,
  company: null,
  author: null,
});

/**
 * Project + letterhead + author, resolved once for either kind.
 *
 * Returns `null` when the project is trashed, which the callers translate into
 * a revoked link rather than a 404 - the link was valid, the owner took the job
 * away.
 */
async function loadEnvelope(projectId: string, createdBy: string) {
  const admin = getSupabaseAdmin();
  const [{ data: project }, { data: profile }] = await Promise.all([
    // `as any`: packages/db's generated types don't know about
    // `projects.deleted_at`, though the trash flow writes it. Same escape hatch
    // the other public read paths use for that gap.
    (admin as any)
      .from("projects")
      .select("name, street, city, state, zip, deleted_at")
      .eq("id", projectId)
      .maybeSingle(),
    admin
      .from("profiles")
      .select("full_name, company, company_logo_url, company_phone, company_address")
      .eq("id", createdBy)
      .maybeSingle(),
  ]);
  if (!project || (project as { deleted_at?: string | null }).deleted_at) return null;

  const prof = profile as {
    full_name: string | null;
    company: string | null;
    company_logo_url: string | null;
    company_phone: string | null;
    company_address: string | null;
  } | null;

  return {
    project: {
      name: (project as any).name as string,
      street: ((project as any).street ?? null) as string | null,
      city: ((project as any).city ?? null) as string | null,
      state: ((project as any).state ?? null) as string | null,
      zip: ((project as any).zip ?? null) as string | null,
    },
    company: {
      name: prof?.company ?? null,
      logo_url: prof?.company_logo_url ?? null,
      phone: prof?.company_phone ?? null,
      address: prof?.company_address ?? null,
    },
    author: { name: prof?.full_name ?? null },
  };
}

/**
 * Signs every referenced photo, scoped to the record's own project.
 *
 * The project scope is load-bearing and not defensive decoration: this runs on
 * the service-role client, so an item row pointing at a photo in someone else's
 * project would otherwise be signed and served to an anonymous visitor.
 */
async function signPhotos(photoIds: string[], projectId: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = Array.from(new Set(photoIds.filter(Boolean)));
  if (!ids.length) return out;

  const admin = getSupabaseAdmin();
  const { data: rows } = await admin
    .from("photos")
    .select("id, storage_path, image_url, project_id")
    .in("id", ids)
    .eq("project_id", projectId);

  await Promise.all(
    ((rows as Array<{ id: string; storage_path: string; image_url: string | null }>) ?? []).map(
      async (r) => {
        if (r.image_url) {
          out.set(r.id, r.image_url);
          return;
        }
        // The full-size object, not the thumbnail: this is the copy a customer
        // or an inspector may need to zoom into as evidence.
        const [full] = photoObjectPaths(r.storage_path);
        const { data: signed } = await admin.storage
          .from("site-photos")
          .createSignedUrl(full, SIGNED_URL_TTL_SECONDS);
        if (signed?.signedUrl) out.set(r.id, signed.signedUrl);
      },
    ),
  );
  return out;
}

// ============================================================
// Checklist
// ============================================================

export async function getPublicChecklistService(
  data: z.infer<typeof publicFieldRecordInputSchema>,
): Promise<PublicFieldRecord> {
  const admin = getSupabaseAdmin();

  const { data: checklist } = await (admin as any)
    .from("project_checklists")
    .select("id, project_id, created_by, name, notes_html, revoked_at, created_at, completed_at")
    .eq("share_token", data.token)
    .maybeSingle();
  if (!checklist) return empty("not_found");
  if (checklist.revoked_at) return empty("revoked");

  const envelope = await loadEnvelope(checklist.project_id, checklist.created_by);
  if (!envelope) return empty("revoked");

  /*
   * The live item rows, not `project_checklists.snapshot`, even for a completed
   * checklist.
   *
   * The snapshot exists so a sealed record cannot be rewritten, and it stays the
   * durable copy - but it is a flat JSON blob with no item ids and only
   * `photo_ids`, so serving it would mean a second mapping, a second signing
   * pass, and a shared record whose photographic evidence rendered differently
   * from the app's. Every write path that could make the two disagree is closed
   * once `completed_at` is set: `ChecklistDocumentPage` puts the whole record
   * read-only (`canFill`/`canStructure` both go false), and nothing else in the
   * product edits these rows.
   */
  const { data: itemRows } = await (admin as any)
    .from("project_checklist_items")
    .select(
      "id, position, label, required, completed_at, notes, item_type, description, response_value",
    )
    .eq("checklist_id", checklist.id)
    .order("position", { ascending: true });

  type Row = {
    id: string;
    position: number;
    label: string;
    required: boolean;
    completed_at: string | null;
    notes: string | null;
    item_type: string | null;
    description: string | null;
    response_value: unknown;
  };
  const rows = ((itemRows as Row[]) ?? []).slice();

  const { data: photoRows } = rows.length
    ? await (admin as any)
        .from("checklist_item_photos")
        .select("item_id, photo_id")
        .in(
          "item_id",
          rows.map((r) => r.id),
        )
    : { data: [] as Array<{ item_id: string; photo_id: string }> };

  const links = ((photoRows as Array<{ item_id: string; photo_id: string }>) ?? []).filter(Boolean);
  const urlById = await signPhotos(
    links.map((l) => l.photo_id),
    checklist.project_id,
  );
  const urlsByItem = new Map<string, string[]>();
  for (const l of links) {
    const url = urlById.get(l.photo_id);
    if (!url) continue;
    const bucket = urlsByItem.get(l.item_id);
    if (bucket) bucket.push(url);
    else urlsByItem.set(l.item_id, [url]);
  }

  const items: PublicFieldRecordItem[] = rows.map((r) => {
    const answer = formatChecklistAnswer(r.item_type, r.response_value);
    return {
      id: r.id,
      label: r.label,
      description: r.description,
      type: r.item_type ?? "checkbox",
      required: !!r.required,
      answered: !!r.completed_at,
      answer,
      notes: r.notes,
      completedAt: r.completed_at,
      photoUrls: urlsByItem.get(r.id) ?? [],
    };
  });

  return {
    status: "ok",
    record: {
      kind: "checklist",
      title: checklist.name,
      description: null,
      createdAt: checklist.created_at,
      completedAt: checklist.completed_at ?? null,
      notesHtml: sanitizePageHtml(checklist.notes_html ?? null),
      sections: [
        {
          id: checklist.id,
          name: null,
          description: null,
          notes: null,
          requiresSignoff: false,
          signoff: null,
          items,
        },
      ],
      done: items.filter((i) => i.answered).length,
      total: items.length,
    },
    ...envelope,
  };
}

// ============================================================
// Workflow
// ============================================================

export async function getPublicWorkflowService(
  data: z.infer<typeof publicFieldRecordInputSchema>,
): Promise<PublicFieldRecord> {
  const admin = getSupabaseAdmin();

  const { data: workflow } = await (admin as any)
    .from("project_workflows")
    .select(
      "id, project_id, created_by, name, description, notes_html, revoked_at, started_at, created_at, completed_at",
    )
    .eq("share_token", data.token)
    .maybeSingle();
  if (!workflow) return empty("not_found");
  if (workflow.revoked_at) return empty("revoked");

  const envelope = await loadEnvelope(workflow.project_id, workflow.created_by);
  if (!envelope) return empty("revoked");

  const { data: phaseRows } = await (admin as any)
    .from("project_workflow_phases")
    .select("id, position, name, description, requires_signoff, notes, signoff_name, signed_off_at")
    .eq("workflow_id", workflow.id)
    .order("position", { ascending: true });

  type PhaseRow = {
    id: string;
    position: number;
    name: string;
    description: string | null;
    requires_signoff: boolean;
    notes: string | null;
    signoff_name: string | null;
    signed_off_at: string | null;
  };
  const phases = ((phaseRows as PhaseRow[]) ?? []).slice();

  type ItemRow = {
    id: string;
    phase_id: string;
    position: number;
    kind: string;
    label: string;
    required: boolean;
    completed_at: string | null;
    photo_id: string | null;
    note_text: string | null;
  };
  const { data: itemRows } = phases.length
    ? await (admin as any)
        .from("project_workflow_items")
        .select("id, phase_id, position, kind, label, required, completed_at, photo_id, note_text")
        .in(
          "phase_id",
          phases.map((p) => p.id),
        )
        .order("position", { ascending: true })
    : { data: [] as ItemRow[] };
  const items = ((itemRows as ItemRow[]) ?? []).slice();

  const urlById = await signPhotos(
    items.map((i) => i.photo_id).filter((v): v is string => !!v),
    workflow.project_id,
  );

  /** Same rule as `isItemComplete` in the runner - a photo step is done when a
   *  photo exists, a note step when there is text, a check when it is ticked. */
  const isDone = (it: ItemRow) => {
    if (it.kind === "photo") return !!it.photo_id;
    if (it.kind === "note") return !!it.note_text?.trim();
    return !!it.completed_at;
  };

  const sections: PublicFieldRecordSection[] = phases.map((ph) => ({
    id: ph.id,
    name: ph.name,
    description: ph.description,
    notes: ph.notes,
    requiresSignoff: !!ph.requires_signoff,
    signoff: ph.signed_off_at ? { name: ph.signoff_name, at: ph.signed_off_at } : null,
    items: items
      .filter((it) => it.phase_id === ph.id)
      .sort((a, b) => a.position - b.position)
      .map((it) => {
        const url = it.photo_id ? urlById.get(it.photo_id) : undefined;
        return {
          id: it.id,
          label: it.label,
          description: null,
          type: it.kind,
          required: !!it.required,
          answered: isDone(it),
          answer: it.kind === "note" ? it.note_text?.trim() || null : null,
          notes: null,
          completedAt: it.completed_at,
          photoUrls: url ? [url] : [],
        };
      }),
  }));

  const total = items.length;
  const done = items.filter(isDone).length;

  return {
    status: "ok",
    record: {
      kind: "workflow",
      title: workflow.name,
      description: workflow.description ?? null,
      createdAt: workflow.started_at ?? workflow.created_at,
      completedAt: workflow.completed_at ?? null,
      notesHtml: sanitizePageHtml(workflow.notes_html ?? null),
      sections,
      done,
      total,
    },
    ...envelope,
  };
}
