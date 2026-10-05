import { isMissingRequiredPhoto } from "@everlumen/shared";
import { can } from "@everlumen/shared/team-permissions";
import { isShareLive, shareUrl } from "./share-links";

/**
 * Who may change the structure of a task, checklist or workflow, as rules.
 *
 * Every rule here is copied from the web app so the phone offers exactly what
 * the browser offers, no more and no less. The database is the boundary (RLS
 * plus the authoring triggers in `20261008000000_template_authoring...`); these
 * only decide which buttons are drawn, so a person is not handed a Delete that
 * the server will quietly ignore.
 *
 * Sources:
 *   - `canAuthorRecords`   web `useTemplateAuthoringAccess`
 *   - `isManagerRole`      web `lib/assignment.ts`
 *   - `canReopenRecord`    web `lib/assignment.ts` `canReopen`
 *   - `canDeleteTask`      RLS "Users delete own tasks" (`created_by = auth.uid()`)
 *   - `parsePastedItems`   web `components/BulkAddItemsDialog.tsx`
 *   - `recordPrintLinks`   web print sheets (see the function)
 *   - `completionRights`, `overrideConfirm`, `checklistSnapshot`: web completion
 */

/** The team facts `getMyTeam` returns that decide authoring. */
export type AuthoringTeam = {
  myRole: string | null;
  plan: string | null;
  isActive: boolean;
  isInternal?: boolean;
};

/**
 * Whether this person may add, reorder and delete checklist items, rename or
 * delete a checklist or workflow, and save one as a template.
 *
 * Pro or Team plan, and a role with `manage_templates` (owner, admin, manager).
 * A null role is a solo owner with no team row, which the web treats as the
 * owner. Unknown (still loading) is a no, so the controls appear once the
 * answer arrives rather than flashing for someone who then loses them.
 */
export function canAuthorRecords(team: AuthoringTeam | null | undefined): boolean {
  if (!team) return false;
  const roleAllows = !team.myRole || can(team.myRole, "manage_templates");
  const tier = team.isInternal ? "team" : team.plan;
  const isPro = team.isActive && (tier === "pro" || tier === "team");
  return isPro && roleAllows;
}

/** Owner and admin. Managers author structure but do not override assignments. */
export function isManagerRole(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export type ReopenSubject = {
  assignedTo: string | null;
  assignedBy: string | null;
  createdBy: string | null;
  completedBy: string | null;
};

/**
 * Who may send a completed checklist back to be worked on.
 *
 * The reviewing half of the assignment loop: the person who handed it over,
 * the person who holds it, its author, whoever sealed it, or a manager.
 */
export function canReopenRecord(
  subject: ReopenSubject,
  viewer: { userId: string | null; isManager: boolean },
): boolean {
  const me = viewer.userId;
  if (!me) return false;
  return (
    viewer.isManager ||
    subject.assignedBy === me ||
    subject.assignedTo === me ||
    subject.createdBy === me ||
    subject.completedBy === me
  );
}

/**
 * Whether a task's Delete is offered.
 *
 * Only its creator. The web draws the button for everyone and RLS then deletes
 * nothing for anybody else, with no error, so the task simply comes back on the
 * next load. Offering it only where it works is the same rule, stated honestly.
 */
export function canDeleteTask(
  task: { created_by?: string | null } | null | undefined,
  userId: string | null | undefined,
): boolean {
  return Boolean(task?.created_by && userId && task.created_by === userId);
}

/** The most lines one paste adds, matching the web dialog. */
export const MAX_PASTED_ITEMS = 200;

/**
 * Items from a pasted list, one per line.
 *
 * Bullets ("-", "*", the bullet dot, en and em dashes) and numbering ("1." or
 * "2)") are stripped, blank lines are dropped, and the result is capped. The
 * dashes are written as escapes so the source holds none of them.
 */
export function parsePastedItems(raw: string): { labels: string[]; truncated: boolean } {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*\u2022\u00b7\u2013\u2014]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
  return {
    labels: lines.slice(0, MAX_PASTED_ITEMS),
    truncated: lines.length > MAX_PASTED_ITEMS,
  };
}

/**
 * The patch that reopens a sealed checklist.
 *
 * All three columns describe one sealing event. Leaving the snapshot behind
 * would keep printing and sharing the frozen answers after they change.
 */
export function reopenChecklistPatch() {
  return { completed_at: null, completed_by: null, snapshot: null };
}

/** The confirm sentence before a checklist is deleted. */
export function checklistDeleteMessage(name: string, itemCount: number): string {
  return `"${name}" and its ${itemCount} item${itemCount === 1 ? "" : "s"} will be permanently removed from this project. Photos attached to it stay in the project gallery.`;
}

/** The confirm sentence before a workflow is deleted. */
export function workflowDeleteMessage(
  name: string,
  counts: { phases: number; steps: number; signoffs: number },
): string {
  const parts = [
    `${counts.phases} phase${counts.phases === 1 ? "" : "s"}`,
    `${counts.steps} step${counts.steps === 1 ? "" : "s"}`,
  ];
  if (counts.signoffs > 0) {
    parts.push(`${counts.signoffs} sign-off${counts.signoffs === 1 ? "" : "s"}`);
  }
  return `"${name}" and its record on this project (${parts.join(", ")}) will be permanently removed. Photos already taken stay in the project gallery.`;
}

/**
 * Where a checklist or workflow is printed from.
 *
 * The web has no PDF endpoint for either: its Print button is the browser's
 * own print of the record sheet (`PrintDocument` + `RecordDocument`), and the
 * public share page (`PublicRecordView`) renders the same sheet with a "Print /
 * Save as PDF" button of its own. The phone opens one of those two pages in the
 * in-app browser and lets its print or share menu do the rest.
 *
 *   - `publicUrl`: the share page, when the link is live. No sign-in needed.
 *   - `webUrl`: the record on the web app, which needs a web sign-in in that
 *     browser but does not make anything public.
 *
 * Either is null when it cannot be built (no web origin configured, or the
 * link is off).
 */
export function recordPrintLinks(args: {
  kind: "checklists" | "workflows";
  webOrigin: string;
  projectId: string;
  recordId: string;
  shareToken: string | null;
  revokedAt: string | null;
}): { publicUrl: string | null; webUrl: string | null } {
  const base = (args.webOrigin ?? "").replace(/\/+$/, "");
  return {
    publicUrl: isShareLive(args.shareToken, args.revokedAt)
      ? shareUrl(base, args.kind, args.shareToken)
      : null,
    webUrl: base ? `${base}/projects/${args.projectId}/${args.kind}/${args.recordId}` : null,
  };
}

/* ------------------------------------------------------------- completion */

export type CompletionRights = {
  canComplete: boolean;
  /** Closing someone else's work: allowed, but confirmed first. */
  isOverride: boolean;
  /** The sentence shown beside the button, or null. */
  reason: string | null;
};

/**
 * Who may close a task, checklist or workflow. A copy of web
 * `completionRights` in `lib/assignment.ts`, word for word: the assignee
 * closes their own work; whoever assigned it, or a manager, may close it for
 * them as a confirmed override; nobody else may.
 */
export function completionRights(
  subject: { assignedTo: string | null; assignedBy: string | null },
  viewer: { userId: string | null; isManager: boolean },
  assigneeName?: string | null,
): CompletionRights {
  const me = viewer.userId;
  if (!me) return { canComplete: false, isOverride: false, reason: "You are not signed in." };
  if (!subject.assignedTo) return { canComplete: true, isOverride: false, reason: null };
  if (subject.assignedTo === me) return { canComplete: true, isOverride: false, reason: null };

  const who = assigneeName?.trim() || "the assignee";
  if (subject.assignedBy === me || viewer.isManager) {
    return {
      canComplete: true,
      isOverride: true,
      reason: `Assigned to ${who} - completing it will record you as the one who closed it.`,
    };
  }
  return {
    canComplete: false,
    isOverride: false,
    reason: `Only ${who} can mark this complete. Ask a manager if it needs closing without them.`,
  };
}

/** The confirm shown before closing someone else's work. Web `overrideConfirm`. */
export function overrideConfirm(input: {
  what: string;
  who: string;
  detail?: string | null;
  confirmText?: string;
}): { title: string; description: string; confirmText: string } {
  const who = input.who.trim() || "the assignee";
  const detail = input.detail?.trim();
  return {
    title: `Complete this for ${who}?`,
    description:
      `"${input.what}" is assigned to ${who}. You can close it, but the record will show ` +
      `you closed it, not ${who}.` +
      (detail ? ` ${detail}` : ""),
    confirmText: input.confirmText ?? "Complete anyway",
  };
}

/** The web's extra sentence when a checklist is closed for someone else. */
export const CHECKLIST_OVERRIDE_DETAIL =
  "The sealed record is signed in your name and they are not asked to confirm.";

export type SnapshotItem = {
  id: string;
  label: string;
  required: boolean;
  item_type: string;
  description: string | null;
  completed_at: string | null;
  response_value: unknown;
  notes: string | null;
  position: number;
  /** A Number item's unit. Optional so rows read by an older select still seal. */
  unit?: string | null;
};

/** Required items still unanswered. */
export function requiredOpenCount(items: { required: boolean; completed_at: string | null }[]) {
  return items.filter((item) => item.required && !item.completed_at).length;
}

/**
 * Why Mark as complete is not available yet, or null. The web disables the
 * button for an empty checklist and for open required items, and says the
 * latter as "N required items still open".
 */
export function checklistCompletionBlock(
  items: (PhotoRequirement & { required: boolean; completed_at: string | null })[],
  photoCounts?: Map<string, number>,
): string | null {
  if (items.length === 0) return "Add items before completing this checklist.";
  const open = requiredOpenCount(items);
  const photos = photoCounts ? missingPhotoCount(items, photoCounts) : 0;
  const reasons = [
    open > 0 ? `${open} required item${open === 1 ? "" : "s"} still open` : null,
    photos > 0 ? `${photos} photo${photos === 1 ? "" : "s"} still needed` : null,
  ].filter(Boolean);
  return reasons.length > 0 ? reasons.join(", ") : null;
}

/** The part of an item the photo rule reads. */
export type PhotoRequirement = { id?: string; photo_required?: boolean | null };

/**
 * Photo-required items with no photo attached.
 *
 * Counted per item, not per photo: an item asks for evidence, and one picture
 * satisfies it. An item missing from `photoCounts` has none.
 */
export function missingPhotoCount(
  items: PhotoRequirement[],
  photoCounts: Map<string, number>,
): number {
  return items.filter((item) =>
    isMissingRequiredPhoto(item, item.id ? (photoCounts.get(item.id) ?? 0) : 0),
  ).length;
}

/** Photos per item, from `listItemPhotoIds`. */
export function photoCountsOf(photoIdsByItem: Map<string, string[]>): Map<string, number> {
  return new Map([...photoIdsByItem].map(([itemId, ids]) => [itemId, ids.length]));
}

/**
 * Photos still in the outbox that will be attached to a checklist item when
 * they upload, per item.
 *
 * A photo taken in a basement is evidence the moment the shutter fires, even
 * though `checklist_item_photos` will not hear about it until there is signal.
 * Counting these keeps the "Photo needed" badge from nagging about a picture
 * the person has already taken. A failed row is not counted: it may never land.
 */
export function queuedItemPhotoCounts(
  rows: { kind: string; state: string; payload: string }[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.kind !== "photo_upload" || row.state === "failed") continue;
    let itemId: unknown = null;
    try {
      itemId = (JSON.parse(row.payload) as { attachToChecklistItemId?: unknown })
        .attachToChecklistItemId;
    } catch {
      continue;
    }
    if (typeof itemId !== "string" || !itemId) continue;
    counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
  }
  return counts;
}

/** Two per-item counts added together. */
export function addCounts(a: Map<string, number>, b: Map<string, number>): Map<string, number> {
  const out = new Map(a);
  for (const [key, value] of b) out.set(key, (out.get(key) ?? 0) + value);
  return out;
}

/**
 * The sealed copy written with completion, in the web's exact shape. It is what
 * the printed sheet and the share link render for a completed checklist, so a
 * field in a different place here would print blank.
 */
export function checklistSnapshot(
  name: string,
  completedAt: string,
  items: SnapshotItem[],
  photoIdsByItem: Map<string, string[]>,
) {
  return {
    name,
    completed_at: completedAt,
    items: [...items]
      .sort((a, b) => a.position - b.position)
      .map((item) => ({
        label: item.label,
        required: item.required,
        item_type: item.item_type,
        description: item.description,
        completed_at: item.completed_at,
        response_value: item.response_value,
        notes: item.notes,
        // Carried so a sealed Number prints with what it measured in.
        unit: item.unit ?? null,
        photo_ids: photoIdsByItem.get(item.id) ?? [],
      })),
  };
}

/** What the web says after a checklist is closed. */
export function checklistCompletedMessage(
  assignedBy: string | null,
  userId: string | null,
  assignerName: string,
): string {
  return assignedBy && assignedBy !== userId
    ? `Checklist complete - ${assignerName} has been notified`
    : "Checklist marked complete - the record is sealed";
}

/** What the web says after a workflow is closed. */
export function workflowCompletedMessage(
  name: string,
  assignedBy: string | null,
  userId: string | null,
  assignerName: string,
): string {
  return assignedBy && assignedBy !== userId
    ? `"${name}" complete - ${assignerName} has been notified`
    : `"${name}" marked complete`;
}

/**
 * Whether a workflow is ready to close: web `workflowState.canComplete`, every
 * phase unblocked (required steps done and required sign-offs given), and at
 * least one phase. `requiredLeft` and `signoffsLeft` explain a no.
 */
export function workflowReadiness(
  phases: { blocked: boolean; requiredTotal: number; requiredDone: number; signedOk: boolean }[],
): { canComplete: boolean; requiredLeft: number; signoffsLeft: number; reason: string | null } {
  const canComplete = phases.length > 0 && phases.every((phase) => !phase.blocked);
  const requiredLeft = phases.reduce(
    (sum, phase) => sum + (phase.requiredTotal - phase.requiredDone),
    0,
  );
  const signoffsLeft = phases.filter((phase) => !phase.signedOk).length;
  let reason: string | null = null;
  if (!canComplete) {
    if (phases.length === 0) reason = "This workflow has no phases to complete.";
    else if (requiredLeft > 0)
      reason = `${requiredLeft} required step${requiredLeft === 1 ? "" : "s"} left before this workflow can be closed.`;
    else
      reason = `${signoffsLeft} sign-off${signoffsLeft === 1 ? "" : "s"} left before this workflow can be closed.`;
  }
  return { canComplete, requiredLeft, signoffsLeft, reason };
}

/**
 * How many queued writes still carry answers for these items.
 *
 * The web flushes its debounced saves before sealing, so the stored rows match
 * the sealed copy. The phone's equivalent is its outbox: completion waits for
 * these to drain, and refuses while any are still waiting.
 */
export function pendingAnswerWrites(queuedRowIds: string[], itemIds: string[]): number {
  const prefixes = itemIds.map((id) => `checklist_item_patch:${id}:`);
  return queuedRowIds.filter((rowId) => prefixes.some((prefix) => rowId.startsWith(prefix))).length;
}
